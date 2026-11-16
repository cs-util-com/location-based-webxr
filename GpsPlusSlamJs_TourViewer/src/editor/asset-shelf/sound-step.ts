/**
 * The sound step of the asset optimizer's Worker: the samples the page
 * decoded (`sound-optimizer.ts`) encoded as Opus and written as an Ogg
 * Opus file (`ogg-opus.ts`) that lasts exactly as long as they do. The
 * encoder is injected, so the step's checks are unit-tested;
 * `SOUND_DEVICE` is the browser's `AudioEncoder`.
 *
 * @see sound-step.ts.md
 */

import { oggOpusPages, opusHeadOf } from "./ogg-opus.js";
import type { OptimizerSettings } from "./optimizer-settings.js";
import {
  stoppedError,
  type WorkerStepAnswer,
  type WorkerStepControl,
} from "./optimizer-protocol.js";

/** Opus works at 48 kHz; the page decodes to it. */
export const SOUND_RATE = 48_000;
/** The bitrates Opus takes (RFC 6716: 6 to 510 kbps). */
const MIN_BPS = 6_000;
const MAX_BPS = 510_000;

/** What the page hands over: one plane of samples per channel. */
export interface SoundPayload {
  readonly sampleRate: typeof SOUND_RATE;
  /** One (speech) or two (music) planes of equal, non-zero length. */
  readonly planes: readonly Float32Array[];
  readonly bitsPerSecond: number;
}

/** `payload` as a sound the step takes, or null: 48 kHz, one or two
 *  planes of one non-zero length, a whole bitrate Opus has. */
export function soundPayloadOf(payload: unknown): SoundPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Partial<Record<string, unknown>>;
  const planes = p.planes;
  if (p.sampleRate !== SOUND_RATE || !Array.isArray(planes)) return null;
  if (planes.length < 1 || planes.length > 2) return null;
  if (!planes.every((plane) => plane instanceof Float32Array)) return null;
  const frames = (planes[0] as Float32Array).length;
  if (frames === 0) return null;
  if (planes.some((plane) => plane.length !== frames)) {
    return null;
  }
  const bps = p.bitsPerSecond;
  if (!Number.isSafeInteger(bps) || (bps as number) < MIN_BPS) return null;
  if ((bps as number) > MAX_BPS) return null;
  return payload as SoundPayload;
}

/** The encoder's packets, in order, and its decoder description (an
 *  OpusHead carrying the pre-skip). */
interface OpusEncoding {
  readonly packets: readonly Uint8Array[];
  readonly description: Uint8Array | undefined;
}

export interface SoundDevice {
  encodeOpus(
    sound: SoundPayload,
    control: WorkerStepControl,
  ): Promise<OpusEncoding>;
}

/** The comment header's vendor string. */
const VENDOR = "tour editor";

function randomSerial(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** The step. Throws, with words, for samples it does not take, an
 *  encoder without a usable header, or a stop. */
export async function optimizeSound(
  payload: unknown,
  _settings: OptimizerSettings,
  control: WorkerStepControl,
  device: SoundDevice,
  serial: number = randomSerial(),
): Promise<WorkerStepAnswer> {
  const sound = soundPayloadOf(payload);
  if (sound === null) throw new Error("the sound's samples could not be used");
  const encoded = await device.encodeOpus(sound, control);
  if (control.signal.aborted) throw stoppedError();
  const head = opusHeadOf(encoded.description);
  if (head === null || head.channels !== sound.planes.length) {
    throw new Error("the encoder gave no usable Opus header");
  }
  const pages = oggOpusPages(
    { ...head, serial, vendor: VENDOR },
    encoded.packets,
    sound.planes[0]!.length,
  );
  control.progress(1);
  return {
    type: "done",
    blob: new Blob(pages as BlobPart[], { type: "audio/ogg" }),
    extension: "opus",
  };
}

/** Samples per `AudioData` handed to the encoder: one second. */
const CHUNK = SOUND_RATE;
/** Chunks waiting in the encoder before the step waits for it. */
const QUEUE = 4;

/** The real device: WebCodecs' `AudioEncoder`, available in a Worker.
 *  Not unit-tested (it needs a browser); the e2e runs it. */
export const SOUND_DEVICE: SoundDevice = {
  encodeOpus(sound, control) {
    return new Promise<OpusEncoding>((resolve, reject) => {
      const packets: Uint8Array[] = [];
      let description: Uint8Array | undefined;
      let failed = false;
      const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          packets.push(bytes);
          const d = metadata?.decoderConfig?.description;
          if (d !== undefined && description === undefined) {
            const view = ArrayBuffer.isView(d)
              ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
              : new Uint8Array(d);
            description = view.slice();
          }
        },
        error: (err) => {
          failed = true;
          reject(err);
        },
      });
      const channels = sound.planes.length;
      const frames = sound.planes[0]!.length;
      const drained = () =>
        new Promise<void>((done) => {
          encoder.addEventListener("dequeue", () => done(), { once: true });
        });
      void (async () => {
        try {
          encoder.configure({
            codec: "opus",
            sampleRate: SOUND_RATE,
            numberOfChannels: channels,
            bitrate: sound.bitsPerSecond,
          });
          for (let at = 0; at < frames && !failed; at += CHUNK) {
            if (control.signal.aborted) throw stoppedError();
            const n = Math.min(CHUNK, frames - at);
            const data = new Float32Array(n * channels);
            sound.planes.forEach((plane, c) => {
              data.set(plane.subarray(at, at + n), c * n);
            });
            const audio = new AudioData({
              format: "f32-planar",
              sampleRate: SOUND_RATE,
              numberOfFrames: n,
              numberOfChannels: channels,
              timestamp: Math.round((at * 1e6) / SOUND_RATE),
              data,
            });
            encoder.encode(audio);
            audio.close();
            if (encoder.encodeQueueSize > QUEUE) await drained();
            control.progress((0.95 * (at + n)) / frames);
          }
          await encoder.flush();
          if (!failed) resolve({ packets, description });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          if (encoder.state !== "closed") encoder.close();
        }
      })();
    });
  },
};
