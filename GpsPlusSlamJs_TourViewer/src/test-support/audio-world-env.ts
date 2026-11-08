/** A world env for the audio parts' tests: every sound it hands out is
 *  recorded, with the calls made on it. */
import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";

import type { WorldEnv, WorldMode } from "../world-part.js";
import type { SoundChannel, SoundHandle } from "../world-sound.js";

interface RecordedSound extends SoundHandle {
  readonly channel: SoundChannel;
  readonly calls: string[];
  levels: number[];
  isPlaying: boolean;
  isWanted: boolean;
}

export function recordingEnv(mode: WorldMode = "play") {
  const sounds: RecordedSound[] = [];
  const env: WorldEnv = {
    mode,
    loadAsset: () => Promise.resolve(new Blob(["x"])),
    canvasTexture: () => {
      throw new Error("no canvas in node");
    },
    sound(_id, channel) {
      const s: RecordedSound = {
        channel,
        calls: [],
        levels: [],
        isPlaying: false,
        isWanted: false,
        play() {
          s.calls.push("play");
          s.isPlaying = true;
          s.isWanted = true;
        },
        pause() {
          s.calls.push("pause");
          s.isPlaying = false;
          s.isWanted = false;
        },
        hold() {
          s.calls.push("hold");
          s.isPlaying = false;
        },
        carryOn() {
          s.calls.push("carryOn");
          if (s.isWanted) s.isPlaying = true;
        },
        wanted: () => s.isWanted,
        playing: () => s.isPlaying,
        level(gain) {
          s.levels.push(gain);
        },
        dispose() {
          s.calls.push("dispose");
        },
      };
      sounds.push(s);
      return s;
    },
  };
  return { env, sounds };
}

/** An audio block in `view` at the station's origin. */
export function audioBlock(
  view: TourAudioBlock["view"],
  fields: Partial<TourAudioBlock> = {},
): TourAudioBlock {
  return {
    id: "a1",
    kind: "audio",
    view,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    audio: "bell",
    ...fields,
  };
}
