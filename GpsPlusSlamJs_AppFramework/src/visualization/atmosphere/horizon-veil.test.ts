/**
 * Why this file matters: the horizon veil is what makes a hazed city's far
 * ground meet the sky without a step, so its weight must be exactly 1 at and
 * below the horizon (the void under a ground tile's rim shows the veil, not
 * the dark sky), fall with height (the sky above keeps its own, darker
 * colour), and match its GLSL twin, which the sky shader runs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  HORIZON_VEIL_GLSL,
  horizonVeilRise,
  horizonVeilWeight,
} from './horizon-veil.js';

describe('horizonVeilWeight', () => {
  it('is 1 at and below the horizon', () => {
    const rise = horizonVeilRise(4);
    expect(horizonVeilWeight(0, rise)).toBe(1);
    expect(horizonVeilWeight(-0.3, rise)).toBe(1);
    expect(horizonVeilWeight(-1, rise)).toBe(1);
  });

  // The rise is the height where the veil has fallen to 1/e of itself: a
  // reader of a link's `rise=4` can tell what it means on screen.
  it('falls to 1/e at the rise and to about 5 % at three times it', () => {
    const rise = horizonVeilRise(4);
    const at = (deg: number) =>
      horizonVeilWeight(Math.sin((deg * Math.PI) / 180), rise);
    expect(at(4)).toBeCloseTo(Math.exp(-1), 2);
    expect(at(12)).toBeCloseTo(Math.exp(-3), 2);
  });

  it('is 0 everywhere for a rise of 0 (the sky untouched)', () => {
    expect(horizonVeilWeight(0, horizonVeilRise(0))).toBe(0);
    expect(horizonVeilWeight(-1, horizonVeilRise(0))).toBe(0);
  });

  it('lies in [0, 1] and never rises with height', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (a, b, deg) => {
          const rise = horizonVeilRise(deg);
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const wLo = horizonVeilWeight(lo, rise);
          const wHi = horizonVeilWeight(hi, rise);
          expect(wLo).toBeGreaterThanOrEqual(0);
          expect(wLo).toBeLessThanOrEqual(1);
          expect(wHi).toBeLessThanOrEqual(wLo);
        }
      ),
      { seed: 20261116, numRuns: 300 }
    );
  });

  it('refuses a rise outside 0..90 degrees or not finite', () => {
    expect(() => horizonVeilRise(-1)).toThrow(RangeError);
    expect(() => horizonVeilRise(91)).toThrow(RangeError);
    expect(() => horizonVeilRise(Number.NaN)).toThrow(RangeError);
  });

  it('refuses a direction that is not finite', () => {
    expect(() => horizonVeilWeight(Number.NaN, 0.1)).toThrow(RangeError);
  });
});

describe('HORIZON_VEIL_GLSL', () => {
  // The twin must say the same thing: off at rise 0, 1 below the horizon,
  // and the exponential fall over the sine of the elevation.
  it('states the same weight as the CPU twin', () => {
    expect(HORIZON_VEIL_GLSL).toContain(
      'float atmHorizonVeilWeight(float dirY, float rise)'
    );
    expect(HORIZON_VEIL_GLSL).toContain('if (rise <= 0.0) return 0.0;');
    expect(HORIZON_VEIL_GLSL).toContain('exp(-max(dirY, 0.0) / rise)');
  });
});
