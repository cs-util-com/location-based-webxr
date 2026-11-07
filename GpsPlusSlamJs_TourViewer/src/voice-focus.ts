/**
 * The visitor's voice channel: one voice is heard. An active tap wins: the
 * voice running pauses and carries on when the tapped one ends, a story's
 * too. One paused voice is remembered, there is no waiting line, and a voice
 * that would start by itself while another runs does not start.
 *
 * Pure: a voice is three callbacks, and the wrappers here make one of a
 * narration player, of the story's sound channel and of the story's video.
 *
 * @see voice-focus.ts.md
 */

import type { ItemVideo } from "./item-card.js";
import type { NarrationPlayer } from "./narration-player.js";
import type { SceneAudio } from "./scene-view.js";

/** One source of sound, as the focus drives it. */
export interface Voice {
  /** Pause, keeping the place: it carries on later. */
  hold(): void;
  carryOn(): void;
  /** Out for good: a tap starts it again. */
  stop(): void;
  /** A story's voice: its step waits for its end, so it is held, never
   *  stopped. */
  readonly story?: boolean;
}

export interface VoiceFocus {
  /** An active tap started `voice`: it runs from now on. */
  tapped(voice: Voice): void;
  /** `voice` would start by itself: true when it may, which runs it. */
  selfStart(voice: Voice): boolean;
  /** `voice` is over (it ended, or the visitor stopped it): what it paused
   *  carries on. */
  ended(voice: Voice): void;
  running(): Voice | null;
}

export function createVoiceFocus(): VoiceFocus {
  let running: Voice | null = null;
  let paused: Voice | null = null;
  return {
    // The state moves before any voice is touched: a voice may call back
    // (`ended`) from inside its own `hold` or `stop`.
    tapped(voice) {
      if (running === voice) return;
      if (paused === voice) paused = null;
      const before = running;
      running = voice;
      if (before === null) return;
      if (paused === null) {
        paused = before;
        before.hold();
      } else if (before.story === true) {
        const gone = paused;
        paused = before;
        gone.stop();
        before.hold();
      } else {
        before.stop();
      }
    },
    selfStart(voice) {
      if (running !== null) return false;
      if (paused === voice) paused = null;
      running = voice;
      return true;
    },
    ended(voice) {
      if (paused === voice) {
        paused = null;
        return;
      }
      if (running !== voice) return;
      running = paused;
      paused = null;
      running?.carryOn();
    },
    running: () => running,
  };
}

/** A narration player in the focus. */
export interface FocusedPlayer extends NarrationPlayer {
  /** It plays, or the focus holds it to carry on: it counts as left behind
   *  when the visitor walks off. */
  wanted(): boolean;
  /** Carry on without a tap: only while nothing else runs. True when it
   *  does; otherwise it stays paused, and a tap continues it. */
  carryOn(): boolean;
  /** Off and back to its start, until a tap. */
  stop(): void;
}

/**
 * `inner` as a voice: `play` is an active tap, `pause` and the file's end
 * hand the sound back. Reading its clock stays `inner`'s.
 */
export function focusedPlayer(
  inner: NarrationPlayer,
  focus: VoiceFocus,
): FocusedPlayer {
  let held = false;
  const voice: Voice = {
    hold() {
      held = true;
      inner.pause();
    },
    carryOn() {
      held = false;
      inner.play();
    },
    stop() {
      held = false;
      inner.pause();
      inner.seek(0);
    },
  };
  inner.onChange(() => {
    if (!inner.playing() && !held) focus.ended(voice);
  });
  return {
    nowMs: () => inner.nowMs(),
    durationMs: () => inner.durationMs(),
    playing: () => inner.playing(),
    seek: (ms) => {
      inner.seek(ms);
    },
    onChange: (listener) => inner.onChange(listener),
    play() {
      held = false;
      focus.tapped(voice);
      inner.play();
    },
    pause() {
      held = false;
      inner.pause();
      focus.ended(voice);
    },
    wanted: () => held || inner.playing(),
    carryOn() {
      if (!focus.selfStart(voice)) return false;
      held = false;
      inner.play();
      return true;
    },
    stop() {
      voice.stop();
      focus.ended(voice);
    },
    dispose() {
      held = false;
      inner.dispose();
      focus.ended(voice);
    },
  };
}

/**
 * The story's sound channel as a voice: its clip is a story's voice. It
 * starts as a tap does, since the story's own start is the visitor's doing,
 * and it hands the sound back when it ends, stops or is refused.
 */
export function focusedSceneAudio(
  audio: SceneAudio & { pause(): void; resume(): void },
  focus: VoiceFocus,
): SceneAudio {
  const voice: Voice = {
    story: true,
    hold: () => {
      audio.pause();
    },
    carryOn: () => {
      audio.resume();
    },
    stop: () => {
      audio.stop();
    },
  };
  return {
    ...audio,
    play(blob, onEnded) {
      focus.tapped(voice);
      return audio
        .play(blob, () => {
          focus.ended(voice);
          onEnded();
        })
        .catch((error: unknown) => {
          focus.ended(voice);
          throw error;
        });
    },
    stop() {
      audio.stop();
      focus.ended(voice);
    },
  };
}

/**
 * The story's clip as a voice. A clip the visitor paused himself stays
 * paused when the sound comes back; a muted one is no voice at all.
 */
export function storyVideoVoice(
  video: Pick<ItemVideo, "pause" | "paused" | "muted" | "play">,
  focus: VoiceFocus,
): { started(): void; ended(): void } {
  let wasPlaying = false;
  const voice: Voice = {
    story: true,
    hold() {
      wasPlaying = video.paused !== true;
      video.pause();
    },
    carryOn() {
      if (wasPlaying) void video.play?.();
    },
    stop() {
      video.pause();
    },
  };
  return {
    started() {
      if (video.muted !== true) focus.tapped(voice);
    },
    ended() {
      focus.ended(voice);
    },
  };
}
