/**
 * Why these tests matter: the churn number is what the tester reads to judge
 * a preset switch in the field, so a tracker that counted the store's
 * non-GPS updates as zero-length steps (diluting the median to 0), or that
 * read a wrap from 359° to 1° as a 358° step, would tell them the opposite of
 * what the overlay does. These pin the one-sample-per-fix rule, the wrap, the
 * non-finite skip, the window and the boundary guard.
 */

import { describe, expect, it } from 'vitest';
import { createYawChurnTracker, YAW_CHURN_WINDOW } from './yaw-churn';

describe('createYawChurnTracker', () => {
  it('is null before two samples and records one step per fix', () => {
    const t = createYawChurnTracker();
    expect(t.summary()).toEqual({ medianStepDeg: null, steps: 0 });
    t.observe(1, 10);
    expect(t.summary()).toEqual({ medianStepDeg: null, steps: 0 });
    t.observe(2, 12);
    expect(t.summary()).toEqual({ medianStepDeg: 2, steps: 1 });
    t.observe(3, 11);
    expect(t.summary()).toEqual({ medianStepDeg: 1.5, steps: 2 });
  });

  it('ignores updates whose fix count did not grow (frames, compass ticks)', () => {
    const t = createYawChurnTracker();
    t.observe(1, 10);
    t.observe(2, 12);
    for (let i = 0; i < 50; i++) t.observe(2, 12 + i); // same fix, yaw drifting
    expect(t.summary()).toEqual({ medianStepDeg: 2, steps: 1 });
    t.observe(1, 0); // a smaller count (stale read) is ignored too
    expect(t.summary()).toEqual({ medianStepDeg: 2, steps: 1 });
  });

  it('measures a wrap-around as the short step', () => {
    const t = createYawChurnTracker();
    t.observe(1, 359);
    t.observe(2, 1);
    expect(t.summary().medianStepDeg).toBe(2);
  });

  it('skips a non-finite yaw without breaking the chain', () => {
    const t = createYawChurnTracker();
    t.observe(1, 10);
    t.observe(2, NaN);
    t.observe(3, 13);
    expect(t.summary()).toEqual({ medianStepDeg: 3, steps: 1 });
  });

  it('keeps only the last window of steps', () => {
    const t = createYawChurnTracker();
    // 40 steps of 10°, then 30 steps of 1°: the window sees only the 1° steps.
    let yaw = 0;
    let fix = 0;
    t.observe(++fix, yaw);
    for (let i = 0; i < 40; i++) t.observe(++fix, (yaw += 10));
    for (let i = 0; i < YAW_CHURN_WINDOW; i++) t.observe(++fix, (yaw += 1));
    expect(t.summary()).toEqual({ medianStepDeg: 1, steps: YAW_CHURN_WINDOW });
  });

  it('refuses a window that is not an integer ≥ 1', () => {
    expect(() => createYawChurnTracker(0)).toThrow(RangeError);
    expect(() => createYawChurnTracker(2.5)).toThrow(RangeError);
    expect(() => createYawChurnTracker(NaN)).toThrow(RangeError);
  });
});
