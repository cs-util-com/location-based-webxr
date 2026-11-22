import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { makeFrame } from "./bench-image";
import {
  clsVector,
  cosine,
  DINO_CROP,
  DINO_MEAN,
  DINO_STD,
  dinoInput,
  floatValues,
} from "./dino-io";

const solid = (w: number, h: number, rgb: [number, number, number]) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px.set([...rgb, 255], i * 4);
  }
  return makeFrame(w, h, px);
};

const N = DINO_CROP * DINO_CROP;

// Why these tests matter: the timing arm must feed the model what its
// preprocessor config says (shortest edge 256, centre crop 224, ImageNet
// mean and std, channels first); a wrong layout still runs and times the
// same, but its cosine sanity value would mean nothing.
describe("dinoInput", () => {
  it("normalizes each channel with the ImageNet mean and std, channels first", () => {
    const x = dinoInput(solid(320, 240, [255, 0, 128]));
    expect(x.length).toBe(3 * N);
    expect(x[0]).toBeCloseTo((1 - DINO_MEAN[0]) / DINO_STD[0], 5);
    expect(x[N]).toBeCloseTo((0 - DINO_MEAN[1]) / DINO_STD[1], 5);
    expect(x[2 * N + N - 1]).toBeCloseTo(
      (128 / 255 - DINO_MEAN[2]) / DINO_STD[2],
      5,
    );
  });

  it("crops the centre: the outer thirds of a wide frame are left out", () => {
    // 768 x 256: resized as is, the crop is the middle 224 of 768 columns.
    const w = 768;
    const px = new Uint8ClampedArray(w * 256 * 4);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < 256 || x >= 512 ? 0 : 255;
        px.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    const red = dinoInput(makeFrame(w, 256, px)).subarray(0, N);
    const white = (1 - DINO_MEAN[0]) / DINO_STD[0];
    expect(red.every((v) => Math.abs(v - white) < 1e-5)).toBe(true);
  });

  it("property: any frame size gives the fixed 3 x 224 x 224 input", () => {
    fc.assert(
      // Aspect ratios up to 1:4 cover every camera frame; a 1:50 strip
      // resizes to 256 x 12800 and timed the test out under load.
      fc.property(
        fc.integer({ min: 8, max: 400 }),
        fc.integer({ min: 25, max: 400 }),
        (w, hPercent) => {
          const h = Math.max(8, Math.round((w * hPercent) / 100));
          expect(dinoInput(solid(w, h, [10, 20, 30])).length).toBe(3 * N);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("clsVector", () => {
  it("takes the first token of [1, tokens, dim]", () => {
    const data = Float32Array.from({ length: 3 * 4 }, (_, i) => i);
    expect(Array.from(clsVector(data, [1, 3, 4]))).toEqual([0, 1, 2, 3]);
  });

  it("refuses a shape it cannot read", () => {
    expect(() => clsVector(new Float32Array(4), [1, 3, 4])).toThrow(/shape/);
    expect(() => clsVector(new Float32Array(4), [4])).toThrow(/shape/);
  });
});

// Why this test matters: the pair's cosine is the arm's only sanity value
// on the phone; NaN for a zero vector must not read as a similarity.
describe("cosine", () => {
  it("is 1 for the same direction, 0 for orthogonal, NaN for a zero vector", () => {
    expect(cosine(Float32Array.of(1, 2), Float32Array.of(2, 4))).toBeCloseTo(
      1,
      9,
    );
    expect(cosine(Float32Array.of(1, 0), Float32Array.of(0, 3))).toBe(0);
    expect(cosine(Float32Array.of(0, 0), Float32Array.of(1, 1))).toBeNaN();
  });

  it("refuses vectors of different length", () => {
    expect(() => cosine(new Float32Array(2), new Float32Array(3))).toThrow(
      RangeError,
    );
  });

  it("property: stays within [-1, 1] and is symmetric", () => {
    const vec = fc.array(fc.float({ min: -10, max: 10, noNaN: true }), {
      minLength: 4,
      maxLength: 4,
    });
    fc.assert(
      fc.property(vec, vec, (a, b) => {
        const c = cosine(Float32Array.from(a), Float32Array.from(b));
        if (Number.isNaN(c)) {
          return;
        }
        expect(Math.abs(c)).toBeLessThanOrEqual(1 + 1e-6);
        expect(cosine(Float32Array.from(b), Float32Array.from(a))).toBe(c);
      }),
    );
  });
});

// Why this test matters: the q4f16 export may hand back float16 values;
// reading their raw 16-bit codes as numbers would make the cosine garbage.
describe("floatValues", () => {
  it("keeps float32 and widens raw float16 bits", () => {
    const f = Float32Array.of(1.5);
    expect(floatValues(f)).toBe(f);
    // 0x3c00 = 1, 0xc000 = -2, 0x3555 ~ 0.33325, 0x0001 = 2^-24.
    const w = floatValues(Uint16Array.of(0x3c00, 0xc000, 0x3555, 0x0001));
    expect(w[0]).toBe(1);
    expect(w[1]).toBe(-2);
    expect(w[2]).toBeCloseTo(0.33325, 5);
    expect(w[3]).toBe(2 ** -24);
    expect(() => floatValues([1, 2])).toThrow(/float32 or float16/);
  });
});
