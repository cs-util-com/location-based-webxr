import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { linearToSrgb, srgbToLinear } from "./srgb.js";

/**
 * WHY THESE TESTS MATTER. three.js shades in linear space and the city's
 * palettes are written in sRGB. A colour handed over without the conversion
 * draws lighter and greyer than chosen, and nothing fails: it only looks
 * washed out. The known values are the ones `THREE.Color` produces for the
 * same input, so the library and the renderer agree.
 */
describe("srgbToLinear and linearToSrgb", () => {
  it("map the known values of the sRGB transfer curve", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    // 0x80 / 255, the classic mid-grey: 0.2158605 linear.
    expect(srgbToLinear(128 / 255)).toBeCloseTo(0.2158605, 6);
    // Below the linear knee (0.04045) the curve is a straight line.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
    expect(linearToSrgb(0.2158605)).toBeCloseTo(128 / 255, 6);
    expect(linearToSrgb(0.001)).toBeCloseTo(0.01292, 12);
  });

  it("clamp a value outside 0 to 1 and read a non-finite one as 0", () => {
    // Defensive at the boundary: a NaN channel in a vertex buffer draws black
    // or nothing, with no error anywhere.
    expect(srgbToLinear(-1)).toBe(0);
    expect(srgbToLinear(2)).toBeCloseTo(1, 12);
    expect(srgbToLinear(Number.NaN)).toBe(0);
    expect(linearToSrgb(Number.POSITIVE_INFINITY)).toBe(0);
    expect(linearToSrgb(5)).toBeCloseTo(1, 12);
  });

  it("round-trip and stay monotonic", () => {
    // WHY: a mix done in linear and read back must return to the same sRGB
    // value, or every barrier colour drifts a little per conversion.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          expect(linearToSrgb(srgbToLinear(a))).toBeCloseTo(a, 9);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(srgbToLinear(lo)).toBeLessThanOrEqual(srgbToLinear(hi));
        },
      ),
    );
  });
});
