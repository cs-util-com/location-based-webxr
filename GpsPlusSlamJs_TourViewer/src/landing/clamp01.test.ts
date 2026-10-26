/**
 * Why these tests matter: the landing feeds this the share of a picture in
 * view, read from the browser, and a timeline's fraction. A share the
 * browser could not compute must read as "not in view" (0): read as "fully
 * in view" it would start a picture nobody can see. The contract is the
 * framework's `utils/clamp01.ts` (not reachable from here: that module is
 * no entry of the framework's build), restated as fixed cases and a
 * property.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { clamp01 } from "./clamp01.js";

describe("clamp01", () => {
  it("passes a value in range, clamps the rest, and reads non-finite input as 0", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(-0.001)).toBe(0);
    expect(clamp01(1.001)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("lands in [0, 1], keeps a value in range and moves one outside to its bound (property)", () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        const expected = Number.isFinite(value)
          ? Math.min(1, Math.max(0, value))
          : 0;
        // `===`, not `toBe`: -0 in may come out as -0, which is in range.
        expect(clamp01(value) === expected).toBe(true);
      }),
    );
  });
});
