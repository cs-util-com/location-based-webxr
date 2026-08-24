/**
 * Why these tests matter: both callers of this helper divide by a pixel span
 * they read from the layout. A zero span is not hypothetical — a collapsed or
 * not-yet-measured section produces exactly that — and the two copies this
 * module replaces let the resulting `NaN` through into a colour interpolation
 * and a scroll-progress value. The non-finite case is therefore the assertion
 * that matters here, not the clamping.
 *
 * @see clamp01.ts.md
 */

import { describe, it, expect } from "vitest";
import { clamp01 } from "./clamp01";

describe("clamp01", () => {
  it("passes an in-range value through untouched", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it("clamps out-of-range values to the nearest bound", () => {
    expect(clamp01(-0.001)).toBe(0);
    expect(clamp01(1.001)).toBe(1);
  });

  it("collapses every non-finite input to 0", () => {
    // What a zero-height section produces: `(a - b) / 0` is ±Infinity, and
    // `0 / 0` is NaN. Both used to reach the caller.
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
