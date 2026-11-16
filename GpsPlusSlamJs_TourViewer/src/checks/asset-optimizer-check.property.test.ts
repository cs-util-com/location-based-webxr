/**
 * Why this test matters: the common-colour share is the measure the check
 * page shows for "how flat is this picture", and its threshold is swept in
 * the optimizer e2e. A threshold sweep only means something if the measure
 * behaves: for any pixels it lies in (0, 1], it never falls when more
 * colours are counted, and it never falls when colours are read coarser
 * (fewer bits merge near colours, they never split one).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { commonColourShare } from "./asset-optimizer-check.js";

const pixels = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 400 })
  .map((v) => Uint8ClampedArray.from(v.slice(0, v.length - (v.length % 4))))
  .filter((v) => v.length >= 4);

describe("commonColourShare, for any pixels", () => {
  it("lies in (0, 1] and never falls with more colours or fewer bits", () => {
    fc.assert(
      fc.property(
        pixels,
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 2, max: 8 }),
        (rgba, top, bits) => {
          const share = commonColourShare(rgba, top, bits);
          expect(share).toBeGreaterThan(0);
          expect(share).toBeLessThanOrEqual(1);
          expect(commonColourShare(rgba, top + 1, bits)).toBeGreaterThanOrEqual(
            share,
          );
          expect(commonColourShare(rgba, top, bits - 1)).toBeGreaterThanOrEqual(
            share - 1e-12,
          );
        },
      ),
    );
  });
});
