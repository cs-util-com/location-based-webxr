/**
 * Why this test matters: `fitWithin` sets the size of every optimized
 * picture. For any picture and limit it must never enlarge, never exceed
 * the limit, never make a side of zero, and keep the proportions to
 * within one pixel of rounding - a stretched photo would be a visible
 * defect in every tour.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fitWithin } from "./picture-step.js";

const side = fc.integer({ min: 1, max: 20_000 });
const limit = fc.integer({ min: 1, max: 8192 });

describe("fitWithin, for any picture", () => {
  it("keeps a picture within the limit at its own size", () => {
    fc.assert(
      fc.property(side, side, fc.nat(1000), (w, h, spare) => {
        const max = Math.max(w, h) + spare;
        expect(fitWithin(w, h, max)).toEqual({ width: w, height: h });
      }),
    );
  });

  it("brings a larger picture's longest side to the limit, with its proportions and no side under 1", () => {
    fc.assert(
      fc.property(side, side, limit, (w, h, max) => {
        fc.pre(Math.max(w, h) > max);
        const out = fitWithin(w, h, max);
        expect(Number.isInteger(out.width)).toBe(true);
        expect(Number.isInteger(out.height)).toBe(true);
        expect(Math.min(out.width, out.height)).toBeGreaterThanOrEqual(1);
        expect(out.width).toBeLessThanOrEqual(w);
        expect(out.height).toBeLessThanOrEqual(h);
        expect(Math.max(out.width, out.height)).toBe(max);
        const exact = (Math.min(w, h) * max) / Math.max(w, h);
        expect(
          Math.abs(Math.min(out.width, out.height) - Math.max(1, exact)),
        ).toBeLessThanOrEqual(1);
      }),
    );
  });
});
