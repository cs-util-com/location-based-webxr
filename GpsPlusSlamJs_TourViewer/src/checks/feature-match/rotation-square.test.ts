import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { quarterTurnFits, turnQuarter, type Frame } from "./bench-image";
import { centreCrop, rotationSquare, turnOf } from "./rotation-square";

/** A frame whose pixel (x, y) holds red x, green y. */
function coords(width: number, height: number): Frame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([x, y, 7, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}
const px = (f: Frame, x: number, y: number) =>
  Array.from(f.rgba.subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4));

describe("the rotation square", () => {
  // Why: the PC rebuilds the square from the written rectangle; it must
  // be the centred one with the short edge as side.
  it("cuts the centred square", () => {
    expect(centreCrop(6, 4)).toEqual({ x: 1, y: 0, side: 4 });
    expect(centreCrop(3, 8)).toEqual({ x: 0, y: 2, side: 3 });
    expect(centreCrop(5, 5)).toEqual({ x: 0, y: 0, side: 5 });
    const { frame } = rotationSquare(coords(6, 4), 0);
    expect(frame.width).toBe(4);
    expect(px(frame, 0, 0)).toEqual([1, 0, 7, 255]);
    expect(px(frame, 3, 3)).toEqual([4, 3, 7, 255]);
  });

  // Why: the turn direction is written as "cw" in the frames JSON; a
  // quarter turn must move (x, y) to (n-1-y, x).
  it("turns a quarter clockwise", () => {
    const n = 4;
    const sq = rotationSquare(coords(n, n), 0).frame;
    const q = rotationSquare(coords(n, n), 90).frame;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        expect(px(q, n - 1 - y, x)).toEqual(px(sq, x, y));
      }
    }
  });

  // Why: a half turn must be two quarters and four quarters the identity,
  // so 180 deg is exact and no pixel is resampled.
  it("makes a half turn of two quarters and the identity of four", () => {
    const sq = rotationSquare(coords(5, 7), 0).frame;
    const half = rotationSquare(coords(5, 7), 180).frame;
    expect(half.rgba).toEqual(turnQuarter(turnQuarter(sq)).rgba);
    expect(turnQuarter(turnQuarter(half)).rgba).toEqual(sq.rgba);
  });

  // Why: a bad frame or turn must fail loudly, not give a wrong square.
  it("refuses an empty frame, a bad length and a bad turn", () => {
    expect(() =>
      rotationSquare({ width: 0, height: 3, rgba: new Uint8ClampedArray() }, 0),
    ).toThrow(RangeError);
    expect(() =>
      rotationSquare(
        { width: 2, height: 2, rgba: new Uint8ClampedArray(3) },
        0,
      ),
    ).toThrow(RangeError);
    expect(() => rotationSquare(coords(2, 2), 45 as 90)).toThrow(RangeError);
  });

  // Why: XFeat turns a frame a quarter when that fills its input better;
  // for a square it never does, so it cannot cancel the synthetic turn.
  it("is never turned again by the XFeat input rule, at any size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        (side, bw, bh) => {
          expect(quarterTurnFits(side, side, bw, bh)).toBe(false);
        },
      ),
    );
  });

  // Why (property): any frame gives a square of the short edge whose
  // pixels are the frame's, turned back by the inverse turns.
  it("keeps the crop's pixels for any size and turn", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(0 as const, 90 as const, 180 as const),
        (w, h, deg) => {
          const f = coords(w, h);
          const { frame, crop } = rotationSquare(f, deg);
          expect(frame.width).toBe(Math.min(w, h));
          let back = frame;
          for (let q = 0; q < (4 - deg / 90) % 4; q++) back = turnQuarter(back);
          for (let y = 0; y < crop.side; y++) {
            for (let x = 0; x < crop.side; x++) {
              expect(px(back, x, y)).toEqual(px(f, crop.x + x, crop.y + y));
            }
          }
        },
      ),
    );
  });
});

// Why this test matters: the zip's frames JSON and the worker must turn
// the same pair by the same angle, so both read it from one place.
describe("turnOf", () => {
  it("gives the turn of a rotation pair and null for a real pair", () => {
    expect(turnOf("turn0")).toBe(0);
    expect(turnOf("turn90")).toBe(90);
    expect(turnOf("turn180")).toBe(180);
    expect(turnOf("real")).toBeNull();
  });
});
