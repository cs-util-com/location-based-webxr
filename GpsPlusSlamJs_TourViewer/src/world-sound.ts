/**
 * The sound seam of the world parts (`WorldEnv.sound`): a part asks for a
 * sound by its asset id and its channel, and the page decides how it is
 * heard. No part knows about another.
 *
 * - **Voice** (a narration): one voice is heard, through the page's
 *   `VoiceFocus`. A tap plays it and wins; leaving holds it, keeping the
 *   place and handing the channel back; at return it carries on when the
 *   channel is free. The visitor's own pause keeps it off until a tap.
 * - **Background** (an ambient sound): loops at the level its part asks
 *   for each frame (its distance's loudness), lowered to
 *   `BACKGROUND_UNDER_VOICE` with a glide while any voice runs.
 * - **Sound off** (`soundOn`) silences both: a voice does not carry on
 *   at return (a tap still plays it), a background plays at volume 0.
 *
 * @see world-sound.ts.md
 */

import { BACKGROUND_UNDER_VOICE, glide } from "./kinds/audio/sound-reach.js";
import { clamp01 } from "./landing/clamp01.js";
import {
  createNarrationPlayer,
  type NarrationAudio,
} from "./narration-player.js";
import { focusedPlayer, type VoiceFocus } from "./voice-focus.js";

/** Which rule a sound is heard by. */
export type SoundChannel = "voice" | "background";

/** One sound a world part holds. */
export interface SoundHandle {
  /** Voice: an active tap, it plays and wins. Background: no effect (it
   *  plays by its level). */
  play(): void;
  /** Voice: the visitor's pause; it stays off until a tap. */
  pause(): void;
  /** Voice: the visitor left; it pauses, keeping its place. */
  hold(): void;
  /** Voice: the visitor is back; a held voice carries on when the channel
   *  is free. */
  carryOn(): void;
  /** Voice: it plays, or is held to carry on. */
  wanted(): boolean;
  playing(): boolean;
  /** Background: the loudness asked for, 0 to 1, at page time `seconds`;
   *  0 pauses it. Voice: no effect. */
  level(gain: number, seconds: number): void;
  /** Stops and lets the file go. */
  dispose(): void;
}

/** The slice of an audio element a background sound drives. */
export interface BackgroundAudio {
  src: string;
  loop: boolean;
  volume: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

export interface WorldSoundDeps {
  readonly focus: VoiceFocus;
  /** Defaults to `new Audio()`. */
  readonly audio?: () => NarrationAudio & BackgroundAudio;
  /** The page's sound setting; default on. */
  readonly soundOn?: () => boolean;
  /** The voice or the file could not be played (the page's error toast). */
  onError?(error: unknown): void;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
}

export interface WorldSound {
  /** A sound whose file `load` reads (once, when it first plays). */
  sound(load: () => Promise<Blob>, channel: SoundChannel): SoundHandle;
}

/** A handle that does nothing: the editor's, and a page without sound. */
export const SILENT_SOUND: SoundHandle = {
  play: () => undefined,
  pause: () => undefined,
  hold: () => undefined,
  carryOn: () => undefined,
  wanted: () => false,
  playing: () => false,
  level: () => undefined,
  dispose: () => undefined,
};

/** A seam that gives every part the silent handle. */
export const SILENT_WORLD_SOUND: WorldSound = { sound: () => SILENT_SOUND };

export function createWorldSound(deps: WorldSoundDeps): WorldSound {
  const soundOn = deps.soundOn ?? (() => true);
  const audio = deps.audio ?? (() => new Audio());
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  const report = (error: unknown): void => deps.onError?.(error);

  function voice(load: () => Promise<Blob>): SoundHandle {
    const player = focusedPlayer(
      createNarrationPlayer({
        load,
        audio,
        createUrl,
        revokeUrl,
        ...(deps.onError === undefined
          ? {}
          : { onError: (e: unknown) => deps.onError?.(e) }),
      }),
      deps.focus,
    );
    /** Held by leaving: carries on at return. */
    let away = false;
    return {
      ...SILENT_SOUND,
      play() {
        away = false;
        // A tap plays even with sound off: it is the visitor's own ask.
        player.play();
      },
      pause() {
        away = false;
        player.pause();
      },
      hold() {
        if (!player.wanted()) return;
        away = true;
        player.pause();
      },
      carryOn() {
        if (!away) return;
        away = false;
        if (soundOn()) player.carryOn();
      },
      wanted: () => away || player.wanted(),
      playing: () => player.playing(),
      dispose() {
        away = false;
        player.dispose();
      },
    };
  }

  function background(load: () => Promise<Blob>): SoundHandle {
    let element: (NarrationAudio & BackgroundAudio) | null = null;
    let url: string | null = null;
    let loading = false;
    let gone = false;
    let want = 0;
    let lower = 1;
    let lastS: number | null = null;
    const apply = (): void => {
      if (element === null) return;
      element.volume = soundOn() ? clamp01(want * lower) : 0;
      if (want > 0 && element.paused) element.play().catch(report);
      if (want <= 0 && !element.paused) element.pause();
    };
    const start = (): void => {
      if (loading || gone) return;
      loading = true;
      load()
        .then((blob) => {
          if (gone) return;
          const el = audio();
          url = createUrl(blob);
          el.src = url;
          el.loop = true;
          element = el;
          apply();
        })
        .catch(report);
    };
    return {
      ...SILENT_SOUND,
      playing: () => element !== null && !element.paused,
      level(gain, seconds) {
        want = clamp01(gain);
        const target =
          deps.focus.running() === null ? 1 : BACKGROUND_UNDER_VOICE;
        lower = lastS === null ? target : glide(lower, target, seconds - lastS);
        lastS = seconds;
        if (want > 0) start();
        apply();
      },
      dispose() {
        gone = true;
        if (element !== null) {
          element.pause();
          element.src = "";
          element = null;
        }
        if (url !== null) revokeUrl(url);
        url = null;
      },
    };
  }

  return {
    sound: (load, channel) =>
      channel === "voice" ? voice(load) : background(load),
  };
}
