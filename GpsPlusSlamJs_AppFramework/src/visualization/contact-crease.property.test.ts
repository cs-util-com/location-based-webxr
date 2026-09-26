/**
 * Contact crease: property tests (city shadows and contact crease plan
 * 2026-09-26-0549, M2).
 *
 * Why this test matters: the factor multiplies ambient light on every
 * building in the city, at every height; it must never brighten, never
 * darken beyond the strength, darken less the higher up, and fade to
 * nothing. A shader that squares the exponent or forgets the clamp below
 * the base breaks one of these for some k and r, not for the defaults.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { contactCreaseFactor } from './contact-crease.js';

const strength = fc.double({ min: 0, max: 1, noNaN: true });
const radius = fc.double({ min: 0.05, max: 50, noNaN: true });
const height = fc.double({ min: -100, max: 1000, noNaN: true });

describe('contactCreaseFactor for any strength, radius and height', () => {
  it('stays within [1 - k, 1]', () => {
    fc.assert(
      fc.property(height, strength, radius, (h, k, r) => {
        const f = contactCreaseFactor(h, k, r);
        expect(f).toBeGreaterThanOrEqual(1 - k - 1e-12);
        expect(f).toBeLessThanOrEqual(1);
      })
    );
  });

  it('never darkens more higher up', () => {
    fc.assert(
      fc.property(height, height, strength, radius, (a, b, k, r) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(contactCreaseFactor(hi, k, r)).toBeGreaterThanOrEqual(
          contactCreaseFactor(lo, k, r) - 1e-12
        );
      })
    );
  });

  it('is exactly 1 - k at and below the base, and within 1e-6 of 1 at 14 radii', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 0, noNaN: true }),
        strength,
        radius,
        (h, k, r) => {
          expect(contactCreaseFactor(h, k, r)).toBeCloseTo(1 - k, 12);
          expect(contactCreaseFactor(14 * r, k, r)).toBeGreaterThan(1 - 1e-6);
        }
      )
    );
  });
});
