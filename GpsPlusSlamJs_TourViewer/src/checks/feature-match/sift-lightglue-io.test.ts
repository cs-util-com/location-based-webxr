import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  LIGHTGLUE_SIFT_INPUTS,
  lightGlueSiftFeeds,
  lightGlueSiftFrame,
  rootSiftFloat,
  wrapAngle,
  type SiftKeypoints,
} from "./sift-lightglue-io";

const DIM = 128;

/** A detector result of `n` keypoints with the given descriptor rows. */
function result(n: number, row: (i: number) => number[]): SiftKeypoints {
  const desc = new Uint8Array(n * DIM);
  for (let i = 0; i < n; i++) {
    desc.set(row(i), i * DIM);
  }
  return {
    n,
    x: Float32Array.from({ length: n }, (_, i) => i + 0.25),
    y: Float32Array.from({ length: n }, (_, i) => 2 * i),
    scale: Float32Array.from({ length: n }, (_, i) => 1.6 + i),
    angle: Float32Array.from({ length: n }, (_, i) => i),
    desc,
  };
}

const norm = (v: Float32Array, i: number): number => {
  let s = 0;
  for (let k = 0; k < DIM; k++) {
    s += v[i * DIM + k]! ** 2;
  }
  return Math.sqrt(s);
};

// Why these tests matter: the matcher was trained on unit-length RootSIFT.
// sift.js already root-normalizes before it quantizes (x 512), so the input
// must be L2-normalized once and never rooted again: a second root, or the
// raw bytes, leaves the matcher with almost no matches (the known-shift
// probe dropped from 140 correct to 4 with raw bytes).
describe("rootSiftFloat", () => {
  it("undoes the x512 quantization: a row becomes unit length, same direction", () => {
    const r = result(1, () => [3, 4]);
    const f = rootSiftFloat(r.desc, 1);
    expect(f[0]).toBeCloseTo(0.6, 6);
    expect(f[1]).toBeCloseTo(0.8, 6);
    expect(f[2]).toBe(0);
  });

  it("does not take a second square root", () => {
    // [1, 1, 0, ...] normalized is 1/sqrt(2) each; a second root would
    // weight them differently from [4, 1].
    const f = rootSiftFloat(result(1, () => [4, 1]).desc, 1);
    expect(f[0]! / f[1]!).toBeCloseTo(4, 6);
  });

  it("keeps an all-zero row at zero instead of dividing by zero", () => {
    const f = rootSiftFloat(new Uint8Array(DIM), 1);
    expect(Array.from(f).every((v) => v === 0)).toBe(true);
  });

  it("refuses a buffer shorter than n rows", () => {
    expect(() => rootSiftFloat(new Uint8Array(DIM), 2)).toThrow(RangeError);
  });

  it("property: every non-zero row is unit length and non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: DIM, maxLength: DIM }), {
          minLength: 1,
          maxLength: 6,
        }),
        (rows) => {
          const desc = new Uint8Array(rows.length * DIM);
          rows.forEach((r, i) => desc.set(r, i * DIM));
          const f = rootSiftFloat(desc, rows.length);
          expect(f.length).toBe(rows.length * DIM);
          rows.forEach((r, i) => {
            const zero = r.every((v) => v === 0);
            expect(norm(f, i)).toBeCloseTo(zero ? 0 : 1, 5);
          });
          expect(Array.from(f).every((v) => v >= 0)).toBe(true);
        },
      ),
    );
  });
});

// Why these tests matter: COLMAP feeds the matcher orientations from
// atan2, in (-pi, pi]; sift.js gives [0, 2 pi). The model's positional
// encoding reads the raw number, so the range must match its consumer.
describe("wrapAngle", () => {
  it("maps [0, 2 pi) to (-pi, pi]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it("property: stays in (-pi, pi] and keeps the direction", () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), (a) => {
        const w = wrapAngle(a);
        expect(w).toBeGreaterThan(-Math.PI - 1e-12);
        expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
        expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
        expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      }),
    );
  });

  it("refuses a non-finite angle", () => {
    expect(() => wrapAngle(Number.NaN)).toThrow(RangeError);
  });
});

describe("lightGlueSiftFrame", () => {
  it("keeps sift.js positions as they are (pixel centres at integers, as LightGlue reads them)", () => {
    const f = lightGlueSiftFrame(
      result(3, (i) => [i + 1]),
      Infinity,
      320,
      240,
    );
    expect(f.count).toBe(3);
    expect(Array.from(f.keypoints)).toEqual([0.25, 0, 1.25, 2, 2.25, 4]);
    expect(f.scales[1]).toBeCloseTo(2.6, 6);
    expect(f.oris[2]).toBeCloseTo(2, 6);
    expect(f.width).toBe(320);
    expect(f.height).toBe(240);
  });

  it("cuts to the first max keypoints (sift.js orders them strongest first)", () => {
    const f = lightGlueSiftFrame(
      result(5, (i) => [i + 1]),
      2,
      10,
      10,
    );
    expect(f.count).toBe(2);
    expect(f.descriptors.length).toBe(2 * DIM);
    expect(f.scales.length).toBe(2);
  });

  // Why: a cap of 0, a fraction or NaN would silently give an empty or
  // odd-sized input instead of an error naming the cap.
  it.each([0, -1, 1.5, Number.NaN])("refuses the cap %s", (max) => {
    const r = {
      n: 0,
      x: [],
      y: [],
      scale: [],
      angle: [],
      desc: new Uint8Array(),
    };
    expect(() => lightGlueSiftFrame(r as never, max, 10, 10)).toThrow(
      RangeError,
    );
  });

  it("refuses a result without scales or orientations, or short buffers", () => {
    const r = result(2, () => [1]);
    expect(() =>
      lightGlueSiftFrame({ ...r, scale: undefined } as never, 10, 1, 1),
    ).toThrow(/scale/);
    expect(() =>
      lightGlueSiftFrame({ ...r, angle: new Float32Array(1) }, 10, 1, 1),
    ).toThrow(/angle/);
    expect(() => lightGlueSiftFrame({ ...r, n: 3 }, 10, 1, 1)).toThrow();
    expect(() => lightGlueSiftFrame(r, 10, 0, 1)).toThrow(RangeError);
  });
});

// Why this test matters: the COLMAP export takes ten inputs by name, each
// with batch 1; a wrong layout runs without error and matches nothing.
describe("lightGlueSiftFeeds", () => {
  it("gives the ten inputs in the model's order with batch-1 shapes", () => {
    const a = lightGlueSiftFrame(
      result(3, () => [1]),
      Infinity,
      640,
      480,
    );
    const b = lightGlueSiftFrame(
      result(2, () => [2]),
      Infinity,
      320,
      240,
    );
    const feeds = lightGlueSiftFeeds(a, b);
    expect(feeds.map((f) => f.name)).toEqual([...LIGHTGLUE_SIFT_INPUTS]);
    const dims = Object.fromEntries(feeds.map((f) => [f.name, f.dims]));
    expect(dims).toEqual({
      kpts0: [1, 3, 2],
      kpts1: [1, 2, 2],
      desc0: [1, 3, 128],
      desc1: [1, 2, 128],
      image_size0: [1, 2],
      image_size1: [1, 2],
      scales0: [1, 3],
      scales1: [1, 2],
      oris0: [1, 3],
      oris1: [1, 2],
    });
    const size1 = feeds.find((f) => f.name === "image_size1")!;
    expect(Array.from(size1.data)).toEqual([320, 240]);
  });

  it("property: every feed's data holds exactly the product of its dims", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (na, nb) => {
          const feeds = lightGlueSiftFeeds(
            lightGlueSiftFrame(
              result(na, () => [1]),
              Infinity,
              8,
              8,
            ),
            lightGlueSiftFrame(
              result(nb, () => [1]),
              Infinity,
              8,
              8,
            ),
          );
          for (const f of feeds) {
            expect(f.data.length).toBe(f.dims.reduce((p, d) => p * d, 1));
          }
        },
      ),
    );
  });
});
