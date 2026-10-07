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
>;

export interface UnlockableAudio extends SceneAudio {
  /** Call inside the visitor's tap (synchronously): the element plays a
   *  silent clip, which lets it play later clips without a tap. */
  unlock(): void;
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

export function createSceneAudio(deps: {
  createElement(): AudioElementLike;
  readonly objectUrls: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
}): UnlockableAudio {
  let element: AudioElementLike | null = null;
  let clipUrl: string | null = null;
  /** A refused unlock may be tried again on the next tap. */
  let unlockState: "no" | "trying" | "yes" = "no";

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
    audio.pause();
    release();
  }

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
      audio.onended = () => {
        audio.onended = null;
        release();
        onEnded();
      };
      return audio.play();
    },
    stop,
  };
}
