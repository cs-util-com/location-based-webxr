import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { labToRgb, rgbToLab } from "./cielab.js";

/**
 * WHY: the jitter converts a tone to Lab and back. With no shift the round
 * trip must give the exact same byte colour, or a zero jitter would still
 * move colours, and the default's byte identity would rest on luck.
 */
describe("cielab (properties)", () => {
  it("round-trips every sRGB colour exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), (rgb) => {
        expect(labToRgb(rgbToLab(rgb))).toBe(rgb);
      }),
      { numRuns: 2000 },
    );
  });
});
