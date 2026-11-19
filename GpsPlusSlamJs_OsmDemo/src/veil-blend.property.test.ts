import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { blendVeils, veilBlendOf, type VeilBlend } from "./veil-blend.js";

/**
 * The veil blend feeds sky and haze uniforms each sun step; a NaN there
 * blacks out the sky with no error, so every weight vector (zero plateaus
 * included, where looks without a veil weigh everything) must give finite
 * uniforms, and the ends must equal today's fixed looks exactly.
 */

const veil = (lightness: number, riseDeg: number): VeilBlend =>
  veilBlendOf({ lightness, tint: 0, riseDeg }, 1)!;

const LOOKS: readonly (VeilBlend | null)[] = [
  null,
  veil(0.8, 4),
  null,
  veil(0.3, 12),
];

/** Normalised weights with exact zeros drawn often (the plateaus). */
const weights = fc
  .array(fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })), {
    minLength: 4,
    maxLength: 4,
  })
  .filter((w) => w.reduce((a, b) => a + b, 0) > 0)
  .map((w) => {
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  });

describe("blendVeils", () => {
  // WHY: finite uniforms over all weights, strength within [0, 1], and null
  // exactly when no look with a veil weighs anything.
  it("gives finite uniforms or no veil for every weight vector", () => {
    expect(() =>
      fc.assert(
        fc.property(weights, (w) => {
          const blend = blendVeils(LOOKS, w);
          const veiled = (w[1] ?? 0) + (w[3] ?? 0);
          if (veiled === 0) return blend === null;
          if (blend === null) return false;
          const numbers = [
            ...blend.colour,
            ...blend.display,
            blend.strength,
            blend.riseDeg,
          ];
          return (
            numbers.every(Number.isFinite) &&
            blend.strength > 0 &&
            blend.strength <= 1 &&
            // A weighted mean, so within its inputs up to rounding.
            blend.riseDeg >= 4 - 1e-9 &&
            blend.riseDeg <= 12 + 1e-9
          );
        }),
      ),
    ).not.toThrow();
  });

  // WHY: weight 1 on a look must draw that look exactly as the fixed build
  // does: its own veil at strength 1, or no veil at all.
  it("equals each look's own veil at weight 1", () => {
    for (const [k, look] of LOOKS.entries()) {
      const w = LOOKS.map((_, i) => (i === k ? 1 : 0));
      expect(blendVeils(LOOKS, w)).toEqual(look);
    }
  });

  // WHY: a half mix of a veiled and an unveiled look is the veil at half
  // strength with its colour premultiplied, never a darker veil colour.
  it("premultiplies instead of dividing", () => {
    const blend = blendVeils([null, veil(0.8, 4)], [0.5, 0.5])!;
    const full = veil(0.8, 4);
    expect(blend.strength).toBe(0.5);
    blend.colour.forEach((c, i) =>
      expect(c).toBeCloseTo((full.colour[i] ?? 0) / 2, 12),
    );
    expect(blend.riseDeg).toBe(4);
  });

  // WHY: a list mismatch or a bad weight is a wiring bug; failing loudly
  // keeps NaN out of the uniforms.
  it("refuses mismatched lists and bad weights", () => {
    expect(() => blendVeils(LOOKS, [1])).toThrow(RangeError);
    expect(() => blendVeils(LOOKS, [1, Number.NaN, 0, 0])).toThrow(RangeError);
    expect(() => blendVeils(LOOKS, [1, -0.5, 0, 0.5])).toThrow(RangeError);
  });
});
