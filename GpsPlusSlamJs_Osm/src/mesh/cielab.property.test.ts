import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { labToRgb, rgbToLab } from "./cielab.js";

/**
 * WHY: the jitter converts a tone to Lab and back, so a shifted tone must
 * come back as the nearest byte colour and an unshifted one as itself. A
 * jitter of 0 never takes this round trip (the palette returns the tone as
 * it is), so the default's byte identity does not rest on it; this holds the
 * conversion honest for every jitter above 0. Sampled over 2000 colours, not
 * proven for all 16.7 million.
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
