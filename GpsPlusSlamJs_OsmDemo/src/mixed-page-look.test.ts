import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { colourSchemeOf } from "./colour-schemes.js";
import { TIME_OF_DAY_LOOKS } from "./look-choice.js";
import { mixedPageLook } from "./mixed-page-look.js";

/**
 * The page's colours between the time-of-day looks. At weight 1 on a look
 * they must be EXACTLY that look's (the frame-equality rule with its fixed
 * build), and between looks a mix in linear light.
 */

const linear = (hex: number): number[] =>
  new THREE.Color().setHex(hex, THREE.SRGBColorSpace).toArray();

describe("mixedPageLook", () => {
  // WHY: weight 1 is the fixed build of that look; any rounding there would
  // break frame equality between the blend and the fixed scheme.
  it("equals each look exactly at weight 1, its trim folded into the weights", () => {
    for (const [k, name] of TIME_OF_DAY_LOOKS.entries()) {
      const look = colourSchemeOf(name);
      const weights = TIME_OF_DAY_LOOKS.map((_, i) => (i === k ? 1 : 0));
      const mixed = mixedPageLook(weights);
      expect(mixed.ground).toBe(look.city.ground);
      expect(mixed.plates).toBe(look.ground.plates);
      expect(mixed.slope).toEqual(look.ground.slope);
      expect(mixed.trimWeights[k]).toBe(look.brightnessTrim);
      expect(mixed.trimWeights.filter((w) => w !== 0)).toHaveLength(1);
    }
  });

  // WHY: sRGB values do not add; a half mix must be the mean of the
  // LINEAR colours, as the trees and the mesh shader mix them.
  it("mixes the ground and the slope in linear light", () => {
    const [a, b] = TIME_OF_DAY_LOOKS.map((n) => colourSchemeOf(n));
    const mixed = mixedPageLook([0.5, 0.5, 0, 0]);
    const mean = linear(a!.city.ground).map(
      (c, i) => (c + (linear(b!.city.ground)[i] ?? 0)) / 2,
    );
    linear(mixed.ground).forEach((c, i) =>
      expect(c).toBeCloseTo(mean[i] ?? 0, 2),
    );
    mixed.slope.cool.forEach((c, i) =>
      expect(c).toBeCloseTo(
        ((a!.ground.slope.cool[i] ?? 0) + (b!.ground.slope.cool[i] ?? 0)) / 2,
        12,
      ),
    );
    expect(mixed.trimWeights).toEqual([
      0.5 * a!.brightnessTrim,
      0.5 * b!.brightnessTrim,
      0,
      0,
    ]);
  });

  it("refuses weights of another length or a bad value", () => {
    expect(() => mixedPageLook([1, 0])).toThrow(RangeError);
    expect(() => mixedPageLook([1, Number.NaN, 0, 0])).toThrow(RangeError);
    expect(() => mixedPageLook([1, -1, 0, 1])).toThrow(RangeError);
  });
});
