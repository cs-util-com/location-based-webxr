/**
 * Why these tests matter: the probe is the only place the phone run touches
 * zxing. It must hand zxing's corners over in SYMBOL order (TL, TR, BR, BL -
 * the order the corner-order verdict compares against), use the fast option
 * set only when asked, refuse malformed buffers without loading anything, and
 * load the WASM exactly once however many frames arrive.
 */

import { describe, expect, it, vi } from "vitest";
import { createZxingProbe, type ZxingReaderLike } from "./zxing-probe.js";

const IMAGE = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 };

function fakeReader(results: unknown[]): ZxingReaderLike {
  return {
    readBarcodes: vi.fn(() => Promise.resolve(results)),
  } as unknown as ZxingReaderLike;
}

const RESULT = {
  isValid: true,
  text: "code",
  rotation: 90,
  position: {
    topLeft: { x: 1, y: 2 },
    topRight: { x: 3, y: 4 },
    bottomRight: { x: 5, y: 6 },
    bottomLeft: { x: 7, y: 8 },
  },
};

describe("createZxingProbe", () => {
  it("maps zxing's position to TL, TR, BR, BL corners and passes the rotation", async () => {
    const probe = createZxingProbe({
      load: () => Promise.resolve(fakeReader([RESULT])),
    });
    const { result } = await probe.decode(IMAGE, "default");
    expect(result).toEqual({
      corners: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
        { x: 7, y: 8 },
      ],
      rotationDeg: 90,
    });
  });

  it("asks for QR only, and turns the extra passes off for the fast set", async () => {
    const reader = fakeReader([]);
    const probe = createZxingProbe({ load: () => Promise.resolve(reader) });
    await probe.decode(IMAGE, "default");
    await probe.decode(IMAGE, "fast");
    const calls = vi.mocked(reader.readBarcodes).mock.calls;
    expect(calls[0]![1]).toEqual({
      formats: ["QRCode"],
      maxNumberOfSymbols: 1,
    });
    expect(calls[1]![1]).toEqual({
      formats: ["QRCode"],
      maxNumberOfSymbols: 1,
      tryHarder: false,
      tryRotate: false,
      tryInvert: false,
      tryDownscale: false,
    });
  });

  it("returns no result for invalid reads", async () => {
    const probe = createZxingProbe({
      load: () => Promise.resolve(fakeReader([{ ...RESULT, isValid: false }])),
    });
    await expect(probe.decode(IMAGE, "default")).resolves.toMatchObject({
      result: null,
    });
  });

  it("skips a malformed buffer without loading the WASM", async () => {
    const load = vi.fn(() => Promise.resolve(fakeReader([RESULT])));
    const probe = createZxingProbe({ load });
    const bad = { data: new Uint8ClampedArray(0), width: 2, height: 2 };
    await expect(probe.decode(bad, "default")).resolves.toEqual({
      ms: 0,
      result: null,
      skipped: true,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once, records the load time, and exposes a warm-up", async () => {
    let t = 0;
    const load = vi.fn(() => Promise.resolve(fakeReader([])));
    const probe = createZxingProbe({ load, now: () => (t += 100) });
    expect(probe.loadMs()).toBeNull();
    await probe.warmUp();
    await probe.decode(IMAGE, "default");
    await probe.decode(IMAGE, "fast");
    expect(load).toHaveBeenCalledTimes(1);
    expect(probe.loadMs()).toBe(100);
  });
});
