/**
 * Property tests for the water polish's TS twins (round-3 stream W).
 *
 * Why this file matters: the tricks are only "cheap polish" if they can
 * never make the water worse than the unpolished water in a way nobody
 * looked at: a roughness that DROPS somewhere, a damp that brightens, a
 * lost variance larger than the waves have, gusts that change the average
 * roughness, or a rescaled ripple that slides against its own dispersion.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  waterFresnelDampFactor,
  waterGustGain,
  waterLostVariance,
  waterSunRoughness,
  waterTileBlend,
  waterTileWave,
  waterVarianceRoughness,
} from './water-polish.js';

const roughness = fc.double({ min: 0.0525, max: 1, noNaN: true });
const waves = fc.array(
  fc.record({
    k: fc.double({ min: 0.05, max: 10, noNaN: true }),
    ak: fc.double({ min: 0, max: 0.2, noNaN: true }),
  }),
  { minLength: 1, maxLength: 16 }
);

describe('water polish twins (properties)', () => {
  it('loses more variance as the pixel grows, never more than the waves have', () => {
    fc.assert(
      fc.property(
        waves,
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (set, a, b) => {
          const [small, large] = a < b ? [a, b] : [b, a];
          const total = set.reduce((s, w) => s + (w.ak * w.ak) / 2, 0);
          const lostSmall = waterLostVariance(set, small);
          const lostLarge = waterLostVariance(set, large);
          expect(lostLarge).toBeGreaterThanOrEqual(lostSmall - 1e-15);
          expect(lostLarge).toBeLessThanOrEqual(total + 1e-15);
          expect(lostSmall).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it('never lowers the roughness, and never exceeds 1', () => {
    fc.assert(
      fc.property(
        roughness,
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (r, variance, scale) => {
          const polished = waterVarianceRoughness(r, variance, scale);
          expect(polished).toBeGreaterThanOrEqual(r - 1e-12);
          expect(polished).toBeLessThanOrEqual(1);
          const sun = waterSunRoughness(r, scale);
          expect(sun).toBeGreaterThanOrEqual(r - 1e-12);
          expect(sun).toBeLessThanOrEqual(1);
        }
      )
    );
  });

  it('damps the reflection more for rougher water, never brightens it', () => {
    fc.assert(
      fc.property(
        roughness,
        roughness,
        fc.double({ min: 0, max: 20, noNaN: true }),
        (a, b, c) => {
          const [smooth, rough] = a < b ? [a, b] : [b, a];
          const f = waterFresnelDampFactor(rough, c);
          expect(f).toBeGreaterThan(0);
          expect(f).toBeLessThanOrEqual(1);
          expect(f).toBeLessThanOrEqual(
            waterFresnelDampFactor(smooth, c) + 1e-15
          );
        }
      )
    );
  });

  // Gusts move roughness around, they do not add it: over a symmetric noise
  // the gain averages 1 (no clipping at depth <= 1).
  it('keeps the gusts gain at 1 on average and never negative', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (noise, depth) => {
          const up = waterGustGain(noise, depth);
          const down = waterGustGain(-noise, depth);
          expect(up).toBeGreaterThanOrEqual(0);
          expect(up + down).toBeCloseTo(2, 12);
        }
      )
    );
  });

  // Blending two uncorrelated samples by weights that sum to 1 LOSES
  // variance (at an even mix the ripples fall to 71 %), which read on the
  // GPU as calmer water, not less repetition (exploration, 2026-09-28).
  // The weights' squares sum to 1 instead, so the ripples keep their
  // strength wherever the mask stands.
  it('blends the two samples without losing their variance', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (mask) => {
        const [a, b] = waterTileBlend(mask);
        expect(a * a + b * b).toBeCloseTo(1, 12);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
      })
    );
    expect(waterTileBlend(0)).toEqual([1, 0]);
    expect(waterTileBlend(1)).toEqual([0, 1]);
  });

  it('keeps the second sample a unit direction on the dispersion curve', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0.05, max: 10, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.3, max: 3, noNaN: true }),
        (heading, k, rotation, scale) => {
          const omega = Math.sqrt(9.81 * k);
          const tile = waterTileWave(
            [Math.cos(heading), Math.sin(heading)],
            k,
            omega,
            rotation,
            scale
          );
          expect(Math.hypot(...tile.direction)).toBeCloseTo(1, 12);
          expect(tile.omega ** 2 / tile.k).toBeCloseTo(9.81, 9);
        }
      )
    );
  });
});
