/**
 * Why these tests matter: the sound row is the page half of a sound's
 * optimization. It decodes on the page (Workers have no audio decoder),
 * picks speech or music settings from the sound's channels, hands the
 * samples to the Worker without copying them (a 3-minute memo is tens of
 * MB), and maps the Worker's progress after its own decode share. A
 * failed decode must fail with words, and a silent file of no samples is
 * kept, not encoded.
 */
import { describe, expect, it, vi } from "vitest";

import type { OptimizerHost } from "./asset-optimizers.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import {
  NO_SAMPLES,
  soundOptimizer,
  type DecodedSound,
} from "./sound-optimizer.js";
import type { SoundPayload } from "./sound-step.js";

function decoded(channels: number, frames: number): DecodedSound {
  const planes = Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: frames }, (_, i) => (c + 1) * 0.1 + i * 1e-6),
  );
  return {
    numberOfChannels: channels,
    length: frames,
    sampleRate: 48000,
    getChannelData: (c) => planes[c]!,
  };
}

/** A decoder that hands back `sound`. */
const decoderOf = (sound: DecodedSound) => ({
  decode: () => Promise.resolve(sound),
});

interface Run {
  readonly kind: string;
  readonly payload: SoundPayload;
  readonly transfer: readonly Transferable[] | undefined;
}

function host() {
  const runs: Run[] = [];
  const h: OptimizerHost & { runs: Run[] } = {
    runs,
    run: vi.fn<OptimizerHost["run"]>(
      (kind, payload, _settings, control, transfer) => {
        runs.push({ kind, payload: payload as SoundPayload, transfer });
        control.progress(0.5);
        return Promise.resolve({
          kind: "optimized" as const,
          blob: new Blob(["x"]),
          extension: "opus",
        });
      },
    ),
    close: vi.fn(),
  };
  return h;
}

function context(h: OptimizerHost) {
  return {
    signal: new AbortController().signal,
    progress: vi.fn(),
    settings: OPTIMIZER_SETTINGS,
    host: h,
  };
}

describe("the sound row", () => {
  it("treats a mono sound as speech: one plane at the speech bitrate", async () => {
    const h = host();
    const row = soundOptimizer(decoderOf(decoded(1, 1000)));
    await row.optimize(new Blob(["a"]), context(h));
    const { payload, transfer, kind } = h.runs[0]!;
    expect(kind).toBe("audio");
    expect(payload.sampleRate).toBe(48000);
    expect(payload.planes).toHaveLength(1);
    expect(payload.bitsPerSecond).toBe(24000);
    // The planes' buffers move to the Worker instead of being copied.
    expect(transfer).toEqual(payload.planes.map((p) => p.buffer));
  });

  it("treats a stereo or wider sound as music: its first two channels at the music bitrate", async () => {
    const h = host();
    const row = soundOptimizer(decoderOf(decoded(6, 500)));
    await row.optimize(new Blob(["a"]), context(h));
    const { payload } = h.runs[0]!;
    expect(payload.planes).toHaveLength(2);
    expect(payload.planes[1]![0]).toBeCloseTo(0.2);
    expect(payload.bitsPerSecond).toBe(64000);
  });

  it("copies the samples, so the decoded sound is never detached under the page", async () => {
    const sound = decoded(1, 100);
    const h = host();
    await soundOptimizer(decoderOf(sound)).optimize(
      new Blob(["a"]),
      context(h),
    );
    expect(h.runs[0]!.payload.planes[0]).not.toBe(sound.getChannelData(0));
  });

  it("downmixes to mono when the music settings ask for one channel of a stereo sound", async () => {
    const h = host();
    const settings = {
      ...OPTIMIZER_SETTINGS,
      music: { ...OPTIMIZER_SETTINGS.music, channels: 1 as const },
    };
    await soundOptimizer(decoderOf(decoded(2, 10))).optimize(new Blob(["a"]), {
      ...context(h),
      settings,
    });
    const planes = h.runs[0]!.payload.planes;
    expect(planes).toHaveLength(1);
    expect(planes[0]![0]).toBeCloseTo(0.15);
  });

  it("reports its decode, then the Worker's progress after it", async () => {
    const h = host();
    const ctx = context(h);
    await soundOptimizer(decoderOf(decoded(1, 10))).optimize(
      new Blob(["a"]),
      ctx,
    );
    const seen = ctx.progress.mock.calls.map((c) => c[0] as number);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]!);
    expect(seen.every((f) => f <= 1)).toBe(true);
  });

  it("fails with words when the bytes cannot be decoded", async () => {
    const row = soundOptimizer({
      decode: () => Promise.reject(new Error("EncodingError")),
    });
    await expect(
      row.optimize(new Blob(["a"]), context(host())),
    ).rejects.toThrow(/could not be read as a sound/);
  });

  it("keeps a sound of no samples, without starting the Worker", async () => {
    const h = host();
    const outcome = await soundOptimizer(decoderOf(decoded(1, 0))).optimize(
      new Blob(["a"]),
      context(h),
    );
    expect(outcome).toEqual({ kind: "kept", reason: NO_SAMPLES });
    expect(h.runs).toHaveLength(0);
  });

  it("refuses a decode at another rate than the encoder's", async () => {
    const h = host();
    const wrong = { ...decoded(1, 10), sampleRate: 44100 };
    await expect(
      soundOptimizer(decoderOf(wrong)).optimize(new Blob(["a"]), context(h)),
    ).rejects.toThrow(/44100 Hz/);
    expect(h.runs).toHaveLength(0);
  });
});
