/**
 * A long text's narration voice: one audio element over the tour's audio
 * file, fetched only when the visitor first presses play, and one clock
 * the reading sheet and the captions strip both follow (`nowMs`,
 * `playing`, `onChange`), so the two never drift apart.
 *
 * @see narration-player.ts.md
 */

/** What the sheet and the strip read and drive. */
export interface NarrationClock {
  /** Where the voice is, in ms from its start. */
  nowMs(): number;
  /** The voice's length in ms: the file's once it is known, else the
   *  tour's `durationMs`, else 0. */
  durationMs(): number;
  /** The visitor asked for the voice and has not paused it (true while
   *  the file is still being fetched, so the button answers at once). */
  playing(): boolean;
  play(): void;
  pause(): void;
  /** Move to `ms`, clamped to the voice; before the file is fetched the
   *  place is kept for when it is. */
  seek(ms: number): void;
  /** Called on every change of place, play state or length; returns the
   *  unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface NarrationPlayer extends NarrationClock {
  /** Pause, let the audio file go and drop every listener. */
  dispose(): void;
}

/** The audio element methods used (an `HTMLAudioElement` has them). */
export interface NarrationAudio {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface NarrationPlayerDeps {
  /** The voice's file from the open tour. */
  load(): Promise<Blob>;
  /** The tour's `narration.durationMs`, shown before the file is read. */
  readonly durationMs?: number;
  /** The voice could not be fetched or played (the page's error toast). */
  onError?(error: unknown): void;
  /** Defaults to `new Audio()`. */
  readonly audio?: () => NarrationAudio;
  /** Default to `URL.createObjectURL` / `URL.revokeObjectURL`. */
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
}

const AUDIO_EVENTS = [
  "play",
  "pause",
  "timeupdate",
  "seeked",
  "durationchange",
  "loadedmetadata",
  "ended",
];

/** Builds a player; nothing is fetched until the first `play()`. */
export function createNarrationPlayer(
  deps: NarrationPlayerDeps,
): NarrationPlayer {
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  const listeners = new Set<() => void>();
  let audio: NarrationAudio | null = null;
  let url: string | null = null;
  let loading: Promise<void> | null = null;
  let wanted = false;
  let heldMs = 0;
  let disposed = false;

  const notify = (): void => {
    for (const l of [...listeners]) l();
  };

  function fail(error: unknown): void {
    wanted = false;
    notify();
    deps.onError?.(error);
  }

  function fileMs(): number {
    const d = audio?.duration ?? Number.NaN;
    return Number.isFinite(d) && d > 0 ? d * 1000 : 0;
  }

  function durationMs(): number {
    const known = fileMs();
    if (known > 0) return known;
    const hint = deps.durationMs;
    return typeof hint === "number" && Number.isFinite(hint) && hint > 0
      ? hint
      : 0;
  }

  function clamp(ms: number): number {
    const d = durationMs();
    const at = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return d > 0 ? Math.min(d, at) : at;
  }

  function ensure(): Promise<void> {
    if (loading !== null) return loading;
    loading = deps.load().then((blob) => {
      if (disposed) return;
      const a = (deps.audio ?? (() => new Audio()))();
      a.preload = "auto";
      for (const type of AUDIO_EVENTS) {
        a.addEventListener(type, () => {
          if (type === "ended") wanted = false;
          notify();
        });
      }
      url = createUrl(blob);
      a.src = url;
      a.currentTime = heldMs / 1000;
      audio = a;
    });
    loading.catch(() => {
      // A failed fetch may be retried by the next press.
      loading = null;
    });
    return loading;
  }

  return {
    nowMs: () => (audio === null ? heldMs : audio.currentTime * 1000),
    durationMs,
    playing: () => wanted,
    play() {
      if (disposed || wanted) return;
      wanted = true;
      notify();
      ensure()
        .then(() => {
          if (!wanted || audio === null) return undefined;
          return audio.play();
        })
        .catch(fail);
    },
    pause() {
      if (!wanted) return;
      wanted = false;
      audio?.pause();
      notify();
    },
    seek(ms) {
      const at = clamp(ms);
      if (audio === null) heldMs = at;
      else audio.currentTime = at / 1000;
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wanted = false;
      listeners.clear();
      if (audio !== null) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      if (url !== null) revokeUrl(url);
      url = null;
      audio = null;
    },
  };
}
