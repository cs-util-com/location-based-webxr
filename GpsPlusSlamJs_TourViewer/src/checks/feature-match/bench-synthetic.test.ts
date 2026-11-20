import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_WARP,
  countCorrect,
  syntheticPair,
  syntheticTexture,
  unwarpPoint,
  warpPoint,
} from "./bench-synthetic";

// Why these tests matter: the synthetic pair is what makes a run without a
// camera repeatable, and its known warp is the only ground truth the page
// has; a texture that changes between runs or a warp whose inverse is off
// would make "correct matches" meaningless.
describe("syntheticTexture", () => {
  it("is the same for the same seed and differs for another", () => {
    const a = syntheticTexture(64, 48, 7);
    const b = syntheticTexture(64, 48, 7);
    const c = syntheticTexture(64, 48, 8);
    expect(a.rgba).toEqual(b.rgba);
    expect(a.rgba).not.toEqual(c.rgba);
  });

  it("has contrast (not a flat image) and is opaque grey", () => {
    const f = syntheticTexture(160, 120, 1);
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < f.rgba.length; i += 4) {
      expect(f.rgba[i]).toBe(f.rgba[i + 1]);
      expect(f.rgba[i + 3]).toBe(255);
      lo = Math.min(lo, f.rgba[i]!);
      hi = Math.max(hi, f.rgba[i]!);
    }
    expect(hi - lo).toBeGreaterThan(150);
  });
});

describe("warpPoint / unwarpPoint", () => {
  it("are inverse at any frame size (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 700, noNaN: true }),
        fc.double({ min: -50, max: 500, noNaN: true }),
        fc.integer({ min: 16, max: 1280 }),
        fc.integer({ min: 16, max: 1280 }),
        (x, y, w, h) => {
          const [bx, by] = warpPoint(DEFAULT_WARP, x, y, w, h);
          const [ax, ay] = unwarpPoint(DEFAULT_WARP, bx, by, w, h);
          expect(ax).toBeCloseTo(x, 6);
          expect(ay).toBeCloseTo(y, 6);
        },
      ),
    );
  });

  it("scales with the frame: the same point at half size maps to half", () => {
    const [x1, y1] = warpPoint(DEFAULT_WARP, 100 - 0.5, 80 - 0.5, 640, 480);
    const [x2, y2] = warpPoint(DEFAULT_WARP, 50 - 0.5, 40 - 0.5, 320, 240);
    expect((x2 + 0.5) * 2).toBeCloseTo(x1 + 0.5, 6);
    expect((y2 + 0.5) * 2).toBeCloseTo(y1 + 0.5, 6);
  });
});

describe("syntheticPair", () => {
  it("draws B as A seen through the warp", () => {
    const { a, b, warp } = syntheticPair(160, 120, 3);
    // A pixel of B inside the frame takes A's value at its unwarped point.
    const [sx, sy] = unwarpPoint(warp, 80, 60, 160, 120);
    const ai = (Math.round(sy) * 160 + Math.round(sx)) * 4;
    const bi = (60 * 160 + 80) * 4;
    expect(Math.abs(b.rgba[bi]! - a.rgba[ai]!)).toBeLessThan(40);
  });
});

describe("countCorrect", () => {
  it("counts pairs whose warped A point lies within the tolerance of B", () => {
    const w = 640;
    const h = 480;
    const ax = new Float32Array([100, 200, 300]);
    const ay = new Float32Array([100, 150, 200]);
    const bx = new Float32Array(3);
    const by = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const [x, y] = warpPoint(DEFAULT_WARP, ax[i]!, ay[i]!, w, h);
      bx[i] = x;
      by[i] = y;
    }
    bx[2] = bx[2]! + 10;
    const pairs = new Int32Array([0, 0, 1, 1, 2, 2]);
    expect(
      countCorrect(
        pairs,
        { x: ax, y: ay },
        { x: bx, y: by },
        DEFAULT_WARP,
        w,
        h,
        3,
      ),
    ).toBe(2);
  });
});
