/**
 * Property tests for the cloud slab's march interval and steps (plan
 * 2026-09-24-1010 §11.4, §11.7).
 *
 * Why this file matters: the interval is computed analytically for every
 * pixel from a camera anywhere between the street and above the deck. A
 * sign error for a camera inside the slab, or a NaN for a nearly level ray,
 * would march through empty air or through the ground, and no fixed case
 * list covers every such camera. Every point the march can visit must lie
 * inside the slab and inside the far fade.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CLOUD_SLAB,
  CLOUD_SLAB_STEPS,
  cloudSlabInterval,
  cloudSlabSteps,
  type Vec3,
} from './cloud-slab.js';
import { CLOUD_SHEET } from './cloud-sheet.js';

const direction = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3)
  .map(([x, y, z]): Vec3 => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });

describe('cloudSlabInterval, for any camera and direction', () => {
  it('only ever visits points inside the slab and inside the far fade', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 4000, noNaN: true }),
        direction,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (y, dir, u) => {
          const interval = cloudSlabInterval(y, dir);
          if (interval === null) return;
          expect(interval.inM).toBeGreaterThanOrEqual(0);
          expect(interval.outM).toBeGreaterThan(interval.inM);
          expect(interval.outM).toBeLessThanOrEqual(CLOUD_SLAB.maxMarchM);
          for (const t of [
            interval.inM,
            interval.outM,
            interval.inM + u * (interval.outM - interval.inM),
          ]) {
            const h = y + dir[1] * t;
            expect(h).toBeGreaterThanOrEqual(CLOUD_SLAB.baseM - 1e-6);
            expect(h).toBeLessThanOrEqual(CLOUD_SLAB.topM + 1e-6);
            expect(t * Math.hypot(dir[0], dir[2])).toBeLessThanOrEqual(
              CLOUD_SHEET.farFadeEndM + 1e-6
            );
          }
        }
      ),
      { numRuns: 10_000, seed: 20260924 }
    );
  });
});

describe('cloudSlabSteps, for any length', () => {
  it('tiles the interval without gaps or overlaps', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLOUD_SLAB_STEPS),
        fc.double({ min: 0, max: CLOUD_SLAB.maxMarchM, noNaN: true }),
        (n, L) => {
          const { starts, ends, samples } = cloudSlabSteps(n, L);
          expect(starts[0]).toBe(0);
          expect(ends[n - 1]).toBeCloseTo(L, 6);
          for (let i = 0; i < n; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(starts[i]!);
            expect(samples[i]).toBeLessThanOrEqual(ends[i]!);
          }
        }
      ),
      { numRuns: 500, seed: 20260924 }
    );
  });
});
