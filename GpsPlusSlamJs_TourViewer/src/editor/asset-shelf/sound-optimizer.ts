/**
 * The sound row of the optimizer table, its page half: the file decoded
 * on the page at 48 kHz (`decodeAudioData`; a Worker has no audio decoder
 * and no `OfflineAudioContext`), the speech or music settings chosen by
 * its channels (mono is speech, two or more channels music), the samples
 * handed to the Worker's sound step (`sound-step.ts`) by transfer, not by
 * copy. The decoder is injected; `SOUND_DECODER` is the browser's.
 *
 * @see sound-optimizer.ts.md
 */

import type { AssetOptimizer, OptimizeOutcome } from "./asset-optimizers.js";
import { SOUND_RATE, type SoundPayload } from "./sound-step.js";

/** Said when a sound has no samples to encode. */
export const NO_SAMPLES = "Kept as it is: it holds no sound.";

/** The part of an `AudioBuffer` the row reads. */
export interface DecodedSound {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface SoundDecoder {
  /** `source` decoded at `SOUND_RATE`; rejects for bytes that are no
   *  sound. */
  decode(source: Blob): Promise<DecodedSound>;
}

/** The decode's share of a run's progress (the Worker's encode follows). */
const DECODE_SHARE = 0.15;

/** `sound` as `channels` planes of its own: copied (the Worker takes them
 *  by transfer), averaged down to one, or the first two of more. */
function planesOf(sound: DecodedSound, channels: 1 | 2): Float32Array[] {
  const from = sound.numberOfChannels;
  if (channels === 2) {
    const left = sound.getChannelData(0);
    const right = from > 1 ? sound.getChannelData(1) : left;
    return [left.slice(), right.slice()];
  }
  const mono = sound.getChannelData(0).slice();
  if (from > 1) {
    for (let c = 1; c < from; c++) {
      const other = sound.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i]! += other[i]!;
    }
    for (let i = 0; i < mono.length; i++) mono[i]! /= from;
  }
  return [mono];
}

export function soundOptimizer(decoder: SoundDecoder): AssetOptimizer {
  return {
    async optimize(source, ctx): Promise<OptimizeOutcome> {
      let sound: DecodedSound;
      try {
        sound = await decoder.decode(source);
      } catch {
        throw new Error("it could not be read as a sound");
      }
      if (sound.sampleRate !== SOUND_RATE) {
        throw new Error(
          `it was decoded at ${sound.sampleRate} Hz, not ${SOUND_RATE}`,
        );
      }
      if (sound.length === 0 || sound.numberOfChannels === 0) {
        return { kind: "kept", reason: NO_SAMPLES };
      }
      const wanted =
        sound.numberOfChannels === 1 ? ctx.settings.speech : ctx.settings.music;
      const planes = planesOf(sound, wanted.channels);
      ctx.progress(DECODE_SHARE);
      const payload: SoundPayload = {
        sampleRate: SOUND_RATE,
        planes,
        bitsPerSecond: wanted.bitsPerSecond,
      };
      return ctx.host.run(
        "audio",
        payload,
        ctx.settings,
        {
          signal: ctx.signal,
          progress: (f) => ctx.progress(DECODE_SHARE + (1 - DECODE_SHARE) * f),
        },
        planes.map((plane) => plane.buffer),
      );
    },
  };
}

/** The browser's decoder: `decodeAudioData` of an `OfflineAudioContext`
 *  at 48 kHz, which resamples to it. Not unit-tested; the e2e runs it. */
export const SOUND_DECODER: SoundDecoder = {
  async decode(source) {
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: SOUND_RATE,
    });
    return context.decodeAudioData(await source.arrayBuffer());
  },
};
