/**
 * Why this test matters: the HUD's diamond entrance mirrors a CSS animation
 * whose timing function is `cubic-bezier(0, 0, 0.2, 1)`, and "mirrors" is
 * only true if this evaluator gives the browser's y for a given x. A wrong
 * solver would still look like an ease-out and pass every eyeball, so the
 * value is pinned numerically (bisection, entrance plan §6: at x = 0.5,
 * u = 0.746017, y = 0.839245) next to the properties a CSS timing function
 * must have exactly.
 *
 * @see cubic-bezier-easing.ts.md
 */
import { describe, expect, it } from 'vitest';
import { EASE_OUT, cubicBezierEasing } from './cubic-bezier-easing.js';

describe('cubicBezierEasing', () => {
  it('EASE_OUT is cubic-bezier(0, 0, 0.2, 1): the pinned midpoint and the exact endpoints', () => {
    expect(EASE_OUT(0)).toBe(0);
    expect(EASE_OUT(1)).toBe(1);
    expect(EASE_OUT(0.5)).toBeCloseTo(0.839245, 4);
    // An ease-out is ahead of linear everywhere inside the interval.
    expect(EASE_OUT(0.25)).toBeGreaterThan(0.25);
    expect(EASE_OUT(0.75)).toBeGreaterThan(0.75);
  });

  it('linear control points give the identity', () => {
    const linear = cubicBezierEasing(0.25, 0.25, 0.75, 0.75);
    for (const x of [0, 0.1, 0.33, 0.5, 0.9, 1]) {
      expect(linear(x)).toBeCloseTo(x, 9);
    }
  });

  it('the (0, 0) control point of EASE_OUT makes the initial slope y2 / x2 = 5', () => {
    // With the first control point on the origin, both x(u) and y(u) start
    // as 3u²·(x2, y2), so the curve leaves 0 along the SECOND control point:
    // dy/dx → y2 / x2 = 1 / 0.2 = 5. Steep at the start, flat at the end —
    // the direction the sheet calls "ease-out". Pinned as a ratio near 0
    // (the cubic term already bends it below 5 at x = 1e-3).
    const x = 1e-3;
    expect(EASE_OUT(x) / x).toBeGreaterThan(4.5);
    expect(EASE_OUT(x) / x).toBeLessThan(5);
  });

  it('clamps the input: below 0 reads as 0, above 1 as 1, non-finite as 0', () => {
    // The seam feeds it `clamp01`-ed values already; this is the belt to
    // that brace so a caller without clamp01 cannot extrapolate the curve.
    expect(EASE_OUT(-0.5)).toBe(0);
    expect(EASE_OUT(1.5)).toBe(1);
    expect(EASE_OUT(Number.NaN)).toBe(0);
    expect(EASE_OUT(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('rejects control points CSS rejects: x outside [0, 1] or anything non-finite', () => {
    expect(() => cubicBezierEasing(-0.1, 0, 0.2, 1)).toThrow(RangeError);
    expect(() => cubicBezierEasing(0, 0, 1.2, 1)).toThrow(RangeError);
    expect(() => cubicBezierEasing(0, Number.NaN, 0.2, 1)).toThrow(RangeError);
    // y outside [0, 1] is legal CSS (overshoot) and must be accepted.
    expect(() => cubicBezierEasing(0.3, -0.5, 0.7, 1.5)).not.toThrow();
  });
});
