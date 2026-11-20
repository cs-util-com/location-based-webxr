import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  fitInside,
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
          for (let i = 0; i < out.rgba.length; i += 4) {
            expect(out.rgba[i]).toBe(v);
          }
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
