/**
 * Why these tests matter: the picture step decides what a dropped photo
 * becomes - its new size, its format, and when it stays as it is. A
 * picture must never be enlarged, an animation must not lose its frames
 * (a canvas keeps only the first), a browser that silently writes PNG for
 * WebP must not hand a PNG named `.webp` to the tour, and a decoded
 * picture's memory is given back on every path. The device (decode,
 * resize, encode) is faked; the real one runs in the e2e.
 */
import { describe, expect, it, vi } from "vitest";

import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";
import { fitWithin, GIF_KEPT, optimizePicture } from "./picture-step.js";

function device(width: number, height: number, encodedType = "image/webp") {
  const d = {
    closed: 0,
    asked: [] as unknown[],
    decode: vi.fn(() =>
      Promise.resolve({
        width,
        height,
        close: () => {
          d.closed++;
        },
      }),
    ),
    encode: vi.fn((_picture, w: number, h: number, quality: number) => {
      d.asked.push({ w, h, quality });
      return Promise.resolve(
        new Blob([new Uint8Array(10)], { type: encodedType }),
      );
    }),
  };
  return d;
}

const control = () => ({
  signal: new AbortController().signal,
  progress: vi.fn(),
});

const jpeg = () =>
  new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3)], {
    type: "image/jpeg",
  });

describe("fitWithin", () => {
  it("shrinks the longest side to the limit and keeps the proportions", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("never enlarges, and never makes a side of zero", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });

  it("refuses sizes that are no positive whole numbers", () => {
    expect(() => fitWithin(0, 10, 1600)).toThrow();
    expect(() => fitWithin(10, 10.5, 1600)).toThrow();
    expect(() => fitWithin(10, 10, 0)).toThrow();
  });
});

describe("the picture step", () => {
  it("makes a large photo a WebP of the chosen size and quality", async () => {
    const d = device(4032, 3024);
    const c = control();
    const answer = await optimizePicture(jpeg(), OPTIMIZER_SETTINGS, c, d);
    expect(answer).toMatchObject({
      type: "done",
      extension: "webp",
      width: 1600,
      height: 1200,
    });
    expect(d.asked).toEqual([{ w: 1600, h: 1200, quality: 0.75 }]);
    expect(d.closed).toBe(1);
    expect(c.progress).toHaveBeenLastCalledWith(1);
  });

  it("re-encodes a small picture at its own size (the runner judges whether it is smaller)", async () => {
    const d = device(640, 480);
    const answer = await optimizePicture(
      jpeg(),
      OPTIMIZER_SETTINGS,
      control(),
      d,
    );
    expect(answer).toMatchObject({ type: "done", width: 640, height: 480 });
  });

  it("keeps a GIF as it is, without decoding it", async () => {
    const d = device(100, 100);
    const gif = new Blob([new TextEncoder().encode("GIF89a....")]);
    const answer = await optimizePicture(gif, OPTIMIZER_SETTINGS, control(), d);
    expect(answer).toEqual({ type: "kept", reason: GIF_KEPT });
    expect(d.decode).not.toHaveBeenCalled();
  });

  it("fails when the browser wrote another format than WebP, and still frees the picture", async () => {
    const d = device(4000, 3000, "image/png");
    await expect(
      optimizePicture(jpeg(), OPTIMIZER_SETTINGS, control(), d),
    ).rejects.toThrow(/WebP/);
    expect(d.closed).toBe(1);
  });

  it("fails with words for bytes it cannot read as a picture", async () => {
    const d = device(1, 1);
    d.decode.mockRejectedValueOnce(new Error("InvalidStateError"));
    await expect(
      optimizePicture(jpeg(), OPTIMIZER_SETTINGS, control(), d),
    ).rejects.toThrow(/could not be read as a picture/);
  });

  it("refuses a payload that is no file", async () => {
    await expect(
      optimizePicture("nope", OPTIMIZER_SETTINGS, control(), device(1, 1)),
    ).rejects.toThrow();
  });

  it("stops before encoding once stopped, and frees the picture", async () => {
    const d = device(4000, 3000);
    const stop = new AbortController();
    d.decode.mockImplementationOnce(() => {
      stop.abort();
      return Promise.resolve({
        width: 4000,
        height: 3000,
        close: () => d.closed++,
      });
    });
    await expect(
      optimizePicture(
        jpeg(),
        OPTIMIZER_SETTINGS,
        { signal: stop.signal, progress: vi.fn() },
        d,
      ),
    ).rejects.toThrow(/stopped/);
    expect(d.encode).not.toHaveBeenCalled();
    expect(d.closed).toBe(1);
  });
});
