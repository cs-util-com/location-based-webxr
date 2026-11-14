/**
 * Why these tests matter: the sound step turns the samples the page
 * decoded into the file the tour keeps. It must refuse samples it cannot
 * trust (another rate, channels of different lengths, no samples) rather
 * than write a file of the wrong length, take the encoder's own pre-skip
 * (a guessed one would shift every caption), and put exactly the input's
 * length into the Ogg file. The encoder is faked; the real one runs in
 * the e2e.
 */
import { describe, expect, it, vi } from "vitest";

import { opusHeadOf } from "./ogg-opus.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import { optimizeSound, soundPayloadOf } from "./sound-step.js";

/** The OpusHead Chromium's encoder hands over, for `channels`. */
function head(channels: number, preSkip = 312): Uint8Array {
  const out = new Uint8Array(19);
  out.set(new TextEncoder().encode("OpusHead"));
  const view = new DataView(out.buffer);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, 48000, true);
  return out;
}

/** A fake encoder: 20 ms packets covering pre-skip plus input, padded. */
function device(over: Partial<{ description: Uint8Array | undefined }> = {}) {
  const d = {
    calls: 0,
    encodeOpus: vi.fn((payload: { planes: readonly Float32Array[] }) => {
      d.calls++;
      const frames = payload.planes[0]!.length;
      const count = Math.ceil((frames + 312) / 960);
      return Promise.resolve({
        packets: Array.from({ length: count }, () => Uint8Array.of(31 << 3, 1)),
        description:
          "description" in over
            ? over.description
            : head(payload.planes.length),
      });
    }),
  };
  return d;
}

const control = () => ({
  signal: new AbortController().signal,
  progress: vi.fn(),
});

const mono = (frames: number) => ({
  sampleRate: 48000,
  planes: [new Float32Array(frames)],
  bitsPerSecond: 24000,
});

async function granuleOf(blob: Blob): Promise<bigint> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // The last page starts at the last "OggS".
  let at = bytes.length - 4;
  while (
    at >= 0 &&
    String.fromCharCode(...bytes.subarray(at, at + 4)) !== "OggS"
  )
    at--;
  return new DataView(bytes.buffer).getBigInt64(at + 6, true);
}

describe("the sound step's payload check", () => {
  it("takes 48 kHz planes of one length, mono or stereo, at a bitrate Opus has", () => {
    expect(soundPayloadOf(mono(10))).not.toBeNull();
    expect(
      soundPayloadOf({
        ...mono(10),
        planes: [new Float32Array(10), new Float32Array(10)],
      }),
    ).not.toBeNull();
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "x",
      { ...mono(10), sampleRate: 44100 },
      { ...mono(10), planes: [] },
      { ...mono(10), planes: [new Float32Array(10), new Float32Array(9)] },
      { ...mono(10), planes: [1, 2] },
      {
        ...mono(10),
        planes: [new Float32Array(1), new Float32Array(1), new Float32Array(1)],
      },
      { ...mono(10), bitsPerSecond: 1000 },
      { ...mono(10), bitsPerSecond: 24000.5 },
      mono(0),
    ]) {
      expect(soundPayloadOf(bad)).toBeNull();
    }
  });
});

describe("the sound step", () => {
  it("writes an Ogg Opus file whose last granule is the encoder's pre-skip plus every input sample", async () => {
    const d = device();
    const answer = await optimizeSound(
      mono(48_000 * 3 + 17),
      OPTIMIZER_SETTINGS,
      control(),
      d,
    );
    expect(answer.type).toBe("done");
    if (answer.type !== "done") return;
    expect(answer.extension).toBe("opus");
    expect(answer.blob.type).toBe("audio/ogg");
    expect(await granuleOf(answer.blob)).toBe(BigInt(312 + 48_000 * 3 + 17));
    const first = new Uint8Array(await answer.blob.arrayBuffer());
    // The identification page's packet is the encoder's own header.
    expect(opusHeadOf(first.subarray(28, 28 + 19))).toEqual({
      channels: 1,
      preSkip: 312,
      inputSampleRate: 48000,
    });
  });

  it("uses the pre-skip the encoder declares, not a guessed one", async () => {
    const d = device({ description: head(1, 120) });
    const answer = await optimizeSound(
      mono(4800),
      OPTIMIZER_SETTINGS,
      control(),
      d,
    );
    if (answer.type !== "done") throw new Error("not done");
    expect(await granuleOf(answer.blob)).toBe(BigInt(120 + 4800));
  });

  it("fails when the encoder gives no Opus header, or one for other channels", async () => {
    await expect(
      optimizeSound(
        mono(4800),
        OPTIMIZER_SETTINGS,
        control(),
        device({ description: undefined }),
      ),
    ).rejects.toThrow(/header/);
    await expect(
      optimizeSound(
        mono(4800),
        OPTIMIZER_SETTINGS,
        control(),
        device({ description: head(2) }),
      ),
    ).rejects.toThrow(/header/);
  });

  it("refuses samples it cannot trust, before encoding", async () => {
    const d = device();
    await expect(
      optimizeSound(
        { ...mono(10), sampleRate: 44100 },
        OPTIMIZER_SETTINGS,
        control(),
        d,
      ),
    ).rejects.toThrow(/samples/);
    expect(d.calls).toBe(0);
  });

  it("does not write a file once stopped", async () => {
    const stop = new AbortController();
    const d = device();
    d.encodeOpus.mockImplementationOnce(() => {
      stop.abort();
      return Promise.resolve({
        packets: [Uint8Array.of(31 << 3)],
        description: head(1),
      });
    });
    await expect(
      optimizeSound(
        mono(100),
        OPTIMIZER_SETTINGS,
        { signal: stop.signal, progress: vi.fn() },
        d,
      ),
    ).rejects.toThrow(/stopped/);
  });
});
