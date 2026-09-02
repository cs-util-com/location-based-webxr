/**
 * Why this test matters: the churn is read as a physical quantity (degrees
 * per fix), so it must stay inside its physical range whatever the store
 * feeds it, and must not depend on how the alignment happens to represent
 * the same heading (yaw + 360k is the same heading). A hand-written table
 * cannot cover the wrap corners; fast-check can.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createYawChurnTracker, YAW_CHURN_WINDOW } from './yaw-churn';

const yawArb = fc.double({ min: -720, max: 720, noNaN: true });

describe('createYawChurnTracker (properties)', () => {
  it('every summary lies in [0, 180] with steps ≤ window', () => {
    fc.assert(
      fc.property(
        fc.array(yawArb, { minLength: 0, maxLength: 80 }),
        fc.integer({ min: 1, max: 40 }),
        (yaws, window) => {
          const t = createYawChurnTracker(window);
          yaws.forEach((y, i) => t.observe(i + 1, y));
          const s = t.summary();
          expect(s.steps).toBeLessThanOrEqual(window);
          expect(s.steps).toBeLessThanOrEqual(Math.max(0, yaws.length - 1));
          // null exactly when there is no step; otherwise a physical angle.
          expect(s.medianStepDeg === null).toBe(s.steps === 0);
          const m = s.medianStepDeg ?? 0;
          expect(m).toBeGreaterThanOrEqual(0);
          expect(m).toBeLessThanOrEqual(180);
        }
      )
    );
  });

  it('adding whole turns to every yaw leaves the summary unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(yawArb, { minLength: 2, maxLength: 60 }),
        fc.array(fc.integer({ min: -3, max: 3 }), {
          minLength: 60,
          maxLength: 60,
        }),
        (yaws, turns) => {
          const a = createYawChurnTracker();
          const b = createYawChurnTracker();
          yaws.forEach((y, i) => {
            a.observe(i + 1, y);
            b.observe(i + 1, y + 360 * turns[i]!);
          });
          const sa = a.summary();
          const sb = b.summary();
          expect(sb.steps).toBe(sa.steps);
          expect(sb.medianStepDeg).toBeCloseTo(sa.medianStepDeg!, 9);
        }
      )
    );
  });

  it('a constant heading reads 0', () => {
    fc.assert(
      fc.property(yawArb, fc.integer({ min: 2, max: 50 }), (yaw, n) => {
        const t = createYawChurnTracker();
        for (let i = 1; i <= n; i++) t.observe(i, yaw);
        expect(t.summary()).toEqual({
          medianStepDeg: 0,
          steps: Math.min(n - 1, YAW_CHURN_WINDOW),
        });
      })
    );
  });
});
