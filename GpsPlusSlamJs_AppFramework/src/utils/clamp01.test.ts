/**
 * Why these tests matter: `clamp01` existed three times in this package with
 * three different answers for non-finite input, and nothing noticed because no
 * caller ever passed one on the paths the suites exercise. The contract is
 * therefore pinned here explicitly rather than left to be inferred from the
 * three-line body — the next person to "simplify" this into
 * `Math.min(1, Math.max(0, x))` will find out from a red test that they changed
 * what `NaN` means.
 *
 * @see clamp01.ts.md
 */

import { describe, it, expect } from 'vitest';
import { clamp01 } from './clamp01.js';

describe('clamp01', () => {
  it('passes an in-range value through untouched', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it('clamps out-of-range values to the nearest bound', () => {
    expect(clamp01(-0.001)).toBe(0);
    expect(clamp01(1.001)).toBe(1);
    expect(clamp01(-1e9)).toBe(0);
    expect(clamp01(1e9)).toBe(1);
  });

  it('collapses every non-finite input to 0, not to NaN and not to 1', () => {
    // THE ASSERTION THIS FILE EXISTS FOR — the axis the three copies disagreed
    // on. These are scores and confidences: garbage means "no confidence".
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
