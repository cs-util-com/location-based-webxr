/**
 * The stories' one sound channel (tour kit plan K4, §8 G4: "audio unlock and
 * battery"): ONE audio element for the whole page, unlocked by the
 * visitor's "Start the tour" tap, then reused for every clip, so a clip that
 * starts later - a found station, minutes into the walk, with no tap of its
 * own - is allowed to play. Mobile browsers allow sound only from an element
 * that has played inside a user gesture once; a new element per clip would
 * be refused outside a tap.
 *
 * The unlock plays a tiny silent WAV built here (no network, no file). A
 * new clip stops the previous one; `stop` releases the clip's object URL.
 */

import type { SceneAudio } from "./scene-view.js";

/** The slice of `HTMLAudioElement` this module drives. */
export type AudioElementLike = Pick<
  HTMLAudioElement,
  "src" | "onended" | "play" | "pause"
> &
  Partial<Pick<HTMLAudioElement, "duration" | "currentTime">>;

export interface UnlockableAudio extends SceneAudio {
  /** Call inside the visitor's tap (synchronously): the element plays a
   *  silent clip, which lets it play later clips without a tap. */
  unlock(): void;
  /** The clip stops where it is, keeping its file and its end. */
  pause(): void;
  /** The paused clip carries on; one the browser refuses ends instead, so
   *  a step waiting for its end does not wait for good. */
  resume(): void;
}

/** 8 kHz, 8-bit mono, one sample of silence: the smallest valid WAV. */
export function silentWav(): Uint8Array {
  const bytes = new Uint8Array(45);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 37, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, 1, true);
  bytes[44] = 128; // silence in unsigned 8-bit
  return bytes;
}

/** A play() a pause cut short: the browser rejects it with AbortError, and
 *  the clip is held, not refused. */
export function isPlayAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createSceneAudio(deps: {
  createElement(): AudioElementLike;
  readonly objectUrls: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
}): UnlockableAudio {
  let element: AudioElementLike | null = null;
  let clipUrl: string | null = null;
  /** The clip's end: the element's `onended`, or a refused resume's. */
  let clipEnded: (() => void) | null = null;
  /** A refused unlock may be tried again on the next tap. */
  let unlockState: "no" | "trying" | "yes" = "no";
  /** How often `pause` held a clip: a resume's AbortError counts as held
   *  only when a pause came after that resume. */
  let holds = 0;

  const el = (): AudioElementLike => (element ??= deps.createElement());

  function release(): void {
    if (clipUrl !== null) {
      deps.objectUrls.revoke(clipUrl);
      clipUrl = null;
    }
  }

  function stop(): void {
    const audio = el();
    audio.onended = null;
    clipEnded = null;
    audio.pause();
    release();
  }

  /** NaN before the metadata, Infinity for a stream: no length then. */
  const lengthMs = (): number | null => {
    const s = element?.duration;
    return s !== undefined && Number.isFinite(s) && s > 0 ? s * 1000 : null;
  };

  return {
    unlock() {
      if (unlockState !== "no") return;
      unlockState = "trying";
      const audio = el();
      const url = deps.objectUrls.create(
        new Blob([silentWav().slice().buffer], { type: "audio/wav" }),
      );
      audio.src = url;
      // play() must be CALLED inside the tap; its promise may settle later.
      audio
        .play()
        .then(() => {
          unlockState = "yes";
        })
        .catch(() => {
          unlockState = "no";
        })
        .finally(() => {
          deps.objectUrls.revoke(url);
        });
    },
    play(blob, onEnded) {
      stop();
      const audio = el();
      clipUrl = deps.objectUrls.create(blob);
      audio.src = clipUrl;
      const ended = (): void => {
        audio.onended = null;
        clipEnded = null;
        release();
        onEnded();
      };
      clipEnded = ended;
      audio.onended = ended;
      return audio.play();
    },
    stop,
    pause() {
      if (clipEnded === null) return;
      holds += 1;
      el().pause();
    },
    resume() {
      if (clipEnded === null) return;
      const ended = clipEnded;
      const heldBefore = holds;
      el()
        .play()
        .catch((error: unknown) => {
          // Our own pause cut it short: the clip is held, not refused. Any
          // other AbortError leaves nothing to carry it on, so it ends.
          const held = isPlayAbort(error) && holds !== heldBefore;
          if (!held && clipEnded === ended) ended();
        });
    },
    durationMs: lengthMs,
    leftMs() {
      const whole = lengthMs();
      const at = element?.currentTime;
      if (whole === null || at === undefined || !Number.isFinite(at)) {
        return null;
      }
      return Math.max(0, whole - at * 1000);
    },
  };
}
