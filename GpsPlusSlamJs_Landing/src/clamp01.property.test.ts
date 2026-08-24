/**
 * Why these properties matter: both callers divide by a pixel span read from
 * the layout, so the inputs are whatever the browser reports — including the
 * degenerate cases. The value of this guard is that NO input can get past it,
 * which is a universal claim rather than an example-based one.
 *
 * @see clamp01.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { clamp01 } from "./clamp01";

describe("clamp01 (properties)", () => {
  it("returns a finite value in [0, 1] for any double", () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        const result = clamp01(value);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        expect(clamp01(clamp01(value))).toBe(clamp01(value));
      }),
    );
  });
});
