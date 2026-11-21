import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fitWithin } from "./kept-look.js";

/**
 * Why these properties matter: every finished stretch's look passes
 * through `fitWithin` twice (tile and loupe). Over any picture size and
 * limit the result must stay within the limit, never enlarge, and keep
 * the shape to within the rounding of one pixel.
 */
describe("fitWithin properties", () => {
  const side = fc.integer({ min: 1, max: 20_000 });
  const limit = fc.integer({ min: 1, max: 4000 });

  it("stays within the limit, never enlarges, and keeps the aspect", () => {
    fc.assert(
      fc.property(side, side, limit, (w, h, max) => {
        const fit = fitWithin(w, h, max);
        // A picture within the limit is left alone (null), never enlarged.
        expect(fit === null).toBe(Math.max(w, h) <= max);
        if (fit === null) return;
        expect(Math.max(fit.width, fit.height)).toBe(max);
        expect(fit.width).toBeGreaterThanOrEqual(1);
        expect(fit.height).toBeGreaterThanOrEqual(1);
        expect(fit.width).toBeLessThanOrEqual(w);
        expect(fit.height).toBeLessThanOrEqual(h);
        // The shorter side is the exact one rounded (or 1 px at least).
        const scale = max / Math.max(w, h);
        expect(Math.abs(fit.width - w * scale)).toBeLessThanOrEqual(1);
        expect(Math.abs(fit.height - h * scale)).toBeLessThanOrEqual(1);
      }),
    );
  });
});
