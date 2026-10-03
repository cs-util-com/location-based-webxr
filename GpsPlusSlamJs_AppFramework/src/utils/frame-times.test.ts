/**
 * Tests for the frame-time ring (moved from OsmDemo's `ar-sun-shadow.ts`,
 * 2026-10-03, DEC-H3).
 *
 * Why this file matters: a window MEAN (the HUD's fps) is blind to the one
 * frame that renders a shadow map or compiles a shader; the ring's p95, p99
 * and max are what show it. The AR sun shadow status line and, later, the
 * globe lab's live overlay read these numbers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createFrameTimes } from './frame-times.js';
import { nearestRankPercentile } from './percentile.js';

describe('createFrameTimes', () => {
  // The one slow frame a window mean hides must show in p95 and max.
  it('reports nearest-rank percentiles and the max over the last frames', () => {
    const times = createFrameTimes(100);
    expect(times.summary()).toBeNull();
    for (let i = 0; i < 99; i++) times.push(16);
    times.push(80);
    expect(times.summary()).toEqual({
      p50: 16,
      p95: 16,
      p99: 16,
      max: 80,
      count: 100,
    });
    for (let i = 0; i < 10; i++) times.push(40);
    const s = times.summary()!;
    expect(s.count).toBe(100);
    expect(s.p95).toBe(40);
    // 89 x 16, 10 x 40, 1 x 80: rank 99 of 100 is the last 40.
    expect(s.p99).toBe(40);
    expect(s.max).toBe(80);
  });

  it('drops the oldest frames and ignores bad values', () => {
    const times = createFrameTimes(3);
    for (const ms of [100, 1, 2, 3, Number.NaN, -5, Infinity]) times.push(ms);
    expect(times.summary()).toEqual({
      p50: 2,
      p95: 3,
      p99: 3,
      max: 3,
      count: 3,
    });
  });

  it('refuses a capacity that is not a positive integer', () => {
    expect(() => createFrameTimes(0)).toThrow(RangeError);
    expect(() => createFrameTimes(2.5)).toThrow(RangeError);
    expect(() => createFrameTimes(Number.NaN)).toThrow(RangeError);
  });

  // The ring must agree with the shared percentile over exactly the last
  // `capacity` accepted values, whatever the order and the overflow.
  it('equals the shared percentile of the last `capacity` values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), {
          maxLength: 200,
        }),
        (capacity, values) => {
          const times = createFrameTimes(capacity);
          for (const v of values) times.push(v);
          const kept = values.slice(-capacity);
          const s = times.summary();
          expect(s).toEqual(
            kept.length === 0
              ? null
              : {
                  p50: nearestRankPercentile(kept, 0.5),
                  p95: nearestRankPercentile(kept, 0.95),
                  p99: nearestRankPercentile(kept, 0.99),
                  max: Math.max(...kept),
                  count: kept.length,
                }
          );
          const t = s ?? { p50: 0, p95: 0, p99: 0, max: 0 };
          expect(t.p50).toBeLessThanOrEqual(t.p95);
          expect(t.p95).toBeLessThanOrEqual(t.p99);
          expect(t.p99).toBeLessThanOrEqual(t.max);
        }
      )
    );
  });
});
