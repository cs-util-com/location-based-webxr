/**
 * Why these properties matter: `clamp01` is used as a boundary guard — the last
 * thing that runs before a score reaches a percentage, a colour interpolation
 * or a progress bar. Its value is precisely that NO input can get past it, so
 * the claim worth checking is universal rather than example-based.
 *
 * @see clamp01.ts.md
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { clamp01 } from './clamp01.js';

describe('clamp01 (properties)', () => {
  it('returns a finite value in [0, 1] for any double', () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        const result = clamp01(value);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      })
    );
  });

  it('is idempotent', () => {
    // Clamping an already-clamped value must be a no-op, or a caller that
    // defensively clamps twice would quietly change the number.
    fc.assert(
      fc.property(fc.double(), (value) => {
        expect(clamp01(clamp01(value))).toBe(clamp01(value));
      })
    );
  });

  it('preserves order', () => {
    // Monotonicity is what makes it safe on a value that is compared against a
    // threshold: clamping cannot swap two scores around.
    fc.assert(
      fc.property(fc.double(), fc.double(), (a, b) => {
        fc.pre(Number.isFinite(a) && Number.isFinite(b) && a <= b);
        expect(clamp01(a)).toBeLessThanOrEqual(clamp01(b));
      })
    );
  });
});
