import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  describeGrey,
  fitInside,
  greyStats,
  makeFrame,
  resizeFrame,
  sizeForLongEdge,
  toGray,
  toFramePoint,
} from "./bench-image";

function solid(width: number, height: number, v: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set([v, v, v, 255], i * 4);
  }
  return makeFrame(width, height, rgba);
}

// Why these tests matter: every method is timed on the SAME resized frame
// per size; a wrong long edge or a rounding to the model's stride that
// drifts would compare methods at different pixel counts.
describe("sizeForLongEdge", () => {
  it("scales the long edge to the target and keeps the aspect", () => {
    expect(sizeForLongEdge(1280, 720, 640)).toEqual({
      width: 640,
      height: 360,
    });
    expect(sizeForLongEdge(720, 1280, 320)).toEqual({
      width: 180,
      height: 320,
    });
  });

  it("rounds both sides to a multiple when the model needs one", () => {
    expect(sizeForLongEdge(640, 480, 320, 32)).toEqual({
      width: 320,
      height: 256,
    });
    expect(sizeForLongEdge(1280, 720, 480, 32)).toEqual({
      width: 480,
      height: 256,
    });
  });

  it("never returns a side below one multiple", () => {
    expect(sizeForLongEdge(4000, 10, 320, 32)).toEqual({
      width: 320,
      height: 32,
    });
  });

  it("refuses a non-positive or non-finite size", () => {
    expect(() => sizeForLongEdge(0, 10, 320)).toThrow(RangeError);
    expect(() => sizeForLongEdge(10, 10, Number.NaN)).toThrow(RangeError);
  });
});

describe("makeFrame", () => {
  it("refuses a buffer that does not match the size", () => {
    expect(() => makeFrame(2, 2, new Uint8ClampedArray(15))).toThrow(
      RangeError,
    );
  });
});

describe("resizeFrame", () => {
  it("keeps a flat image flat at any size (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 255 }),
        (w, h, dw, dh, v) => {
          const out = resizeFrame(solid(w, h, v), dw, dh);
          expect(out.width).toBe(dw);
          expect(out.height).toBe(dh);
          // One assertion per case, not per pixel: an expect per pixel made
          // this property slow enough to time out under load.
          const off = out.rgba.findIndex((p, i) => i % 4 === 0 && p !== v);
          expect(off).toBe(-1);
        },
      ),
    );
  });

  it("averages a fine checkerboard to grey when it shrinks a lot", () => {
    const w = 64;
    const rgba = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const v = (x + y) % 2 === 0 ? 0 : 255;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    const out = resizeFrame(makeFrame(w, w, rgba), 8, 8);
    for (let i = 0; i < out.rgba.length; i += 4) {
      expect(Math.abs(out.rgba[i]! - 128)).toBeLessThanOrEqual(2);
    }
  });
});

describe("toGray", () => {
  it("maps white to 1 and black to 0 with Rec. 601 weights", () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255,
    ]);
    const g = toGray(makeFrame(3, 1, rgba));
    expect(g[0]).toBeCloseTo(1, 5);
    expect(g[1]).toBe(0);
    expect(g[2]).toBeCloseTo(0.299, 3);
  });
});

describe("fitInside", () => {
  it("never upscales and keeps the aspect inside a fixed model input", () => {
    expect(fitInside(320, 240, 640, 480)).toEqual({
      width: 320,
      height: 240,
      scale: 1,
    });
    expect(fitInside(480, 640, 640, 480)).toEqual({
      width: 360,
      height: 480,
      scale: 0.75,
    });
  });
});

describe("toFramePoint", () => {
  it("maps pixel centres between two sizes of one image", () => {
    // Pixel 0 of a 4 px row lies in the left half of pixel 0 of its 2 px
    // copy; the boundary between its pixels 0 and 1 is the copy's pixel 0 centre.
    expect(toFramePoint(0.5, 4, 2)).toBeCloseTo(0, 9);
    expect(toFramePoint(2.5, 4, 2)).toBeCloseTo(1, 9);
    expect(toFramePoint(0, 4, 2)).toBeCloseTo(-0.25, 9);
  });
});

// Why these tests matter: a dark or flat camera frame yields few
// keypoints whatever the detector does; the copied log must show the
// frame's brightness and contrast so a low count can be read as the
// image, not a threshold.
describe("greyStats", () => {
  const solid = (w: number, h: number, v: number) =>
    makeFrame(w, h, new Uint8ClampedArray(w * h * 4).fill(v));

  it("gives the mean and a zero spread for a flat frame", () => {
    const s = greyStats(solid(3, 2, 80));
    expect(s.mean).toBeCloseTo(80, 4); // grey is Float32
    expect(s.sd).toBeCloseTo(0, 4);
  });

  it("gives 127.5 and 127.5 for half black, half white", () => {
    const f = makeFrame(
      2,
      1,
      new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    );
    const s = greyStats(f);
    expect(s.mean).toBeCloseTo(127.5, 4);
    expect(s.sd).toBeCloseTo(127.5, 4);
  });

  it("weights the channels as Rec. 601 luma", () => {
    const f = makeFrame(1, 1, new Uint8ClampedArray([255, 0, 0, 255]));
    expect(greyStats(f).mean).toBeCloseTo(0.299 * 255, 3);
  });

  it("stays inside 0..255 and 0..127.5 for any frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (w, h, values) => {
          const it = values[Symbol.iterator]();
          const rgba = new Uint8ClampedArray(w * h * 4).map(
            () => it.next().value as number,
          );
          const s = greyStats(makeFrame(w, h, rgba));
          // Tolerances cover the Float32 grey values.
          expect(s.mean).toBeGreaterThanOrEqual(-1e-3);
          expect(s.mean).toBeLessThanOrEqual(255 + 1e-3);
          expect(s.sd).toBeGreaterThanOrEqual(0);
          expect(s.sd).toBeLessThanOrEqual(127.5 + 1e-3);
        },
      ),
    );
  });

  it("reads as one short phrase for the log", () => {
    expect(describeGrey({ mean: 107.26, sd: 46.04 })).toBe(
      "grey mean 107.3 sd 46.0 (0-255)",
    );
  });
});
