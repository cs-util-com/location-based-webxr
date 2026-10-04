/**
 * Tests for the whole-run frame histogram (globe zoom performance plan
 * 2026-10-03-2017, §4.1 and PERF-0).
 *
 * Why this file matters: a recorder run is 10,000-26,000 frames, which the
 * 300-frame ring cannot hold, so the run's percentiles come from these bins
 * and its hitch counts from these cumulative counters. The owner's
 * pass/fail target (DEC-PERF-3) is read from `over`, so a count off by one
 * is a different verdict; the percentile's bin error is bounded here.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  FRAME_HITCH_THRESHOLDS_MS,
  createFrameHistogram,
} from './frame-histogram.js';
import { nearestRankPercentile } from './percentile.js';

describe('createFrameHistogram', () => {
  it('declares the plan thresholds 33, 50 and 100 ms by default', () => {
    expect(FRAME_HITCH_THRESHOLDS_MS).toEqual([33, 50, 100]);
    const h = createFrameHistogram();
    h.push(16.7);
    expect(h.snapshot().over.map((o) => o.thresholdMs)).toEqual([33, 50, 100]);
  });

  it('is empty before the first frame', () => {
    const s = createFrameHistogram().snapshot();
    expect(s.count).toBe(0);
    expect(s.p50Ms).toBeNull();
    expect(s.maxMs).toBeNull();
    expect(s.meanMs).toBeNull();
    expect(s.over.every((o) => o.count === 0)).toBe(true);
  });

  // "Over" is strictly greater: a frame of exactly 50 ms is not over 50.
  it('counts intervals strictly over each threshold, cumulatively', () => {
    const h = createFrameHistogram();
    for (const ms of [16, 33, 33.01, 49.99, 50, 50.5, 99, 100, 250]) h.push(ms);
    const over = Object.fromEntries(
      h.snapshot().over.map((o) => [o.thresholdMs, o.count])
    );
    expect(over).toEqual({ 33: 7, 50: 4, 100: 1 });
    expect(h.countOver(50)).toBe(4);
  });

  // The thresholds are a declared parameter: the counts must be exact for
  // any list, not only the default one (owner rule 2026-09-13).
  it('counts exactly at any declared threshold list (swept)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 400 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.array(fc.double({ min: 0, max: 2000, noNaN: true }), {
          maxLength: 300,
        }),
        (thresholds, values) => {
          const h = createFrameHistogram({ thresholdsMs: thresholds });
          for (const v of values) h.push(v);
          for (const t of thresholds) {
            expect(h.countOver(t)).toBe(values.filter((v) => v > t).length);
          }
        }
      )
    );
  });

  it('refuses a count at a threshold it was not told to count', () => {
    const h = createFrameHistogram({ thresholdsMs: [33] });
    expect(() => h.countOver(50)).toThrow(RangeError);
  });

  it('rejects non-finite and negative intervals and counts them', () => {
    const h = createFrameHistogram();
    expect(h.push(Number.NaN)).toBe(false);
    expect(h.push(-1)).toBe(false);
    expect(h.push(Infinity)).toBe(false);
    expect(h.push(16)).toBe(true);
    const s = h.snapshot();
    expect(s.count).toBe(1);
    expect(s.rejected).toBe(3);
  });

  it('reports min, max and mean exactly', () => {
    const h = createFrameHistogram();
    for (const ms of [10, 20, 30, 1500]) h.push(ms);
    const s = h.snapshot();
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(1500);
    expect(s.meanMs).toBe(390);
    expect(s.overflowCount).toBe(1);
  });

  // The percentile is read from bins (each keeping its own max), so it is
  // an interval that happened, never below the exact nearest-rank value and
  // less than one bin above it; in the overflow bin (beyond the range) it
  // is the run's max. Swept over bin widths.
  it('bounds the bin error of every percentile against the exact one', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.1, 0.25, 1, 5),
        fc.array(fc.double({ min: 0, max: 1200, noNaN: true }), {
          minLength: 1,
          maxLength: 400,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (binMs, values, p) => {
          const h = createFrameHistogram({ binMs, rangeMs: 1000 });
          for (const v of values) h.push(v);
          const exact = nearestRankPercentile(values, p);
          const got = h.percentile(p);
          const inOverflow = exact >= 1000;
          expect(values).toContain(got);
          expect(got).toBeGreaterThanOrEqual(exact);
          expect(
            inOverflow
              ? got === Math.max(...values)
              : got <= exact + binMs + 1e-9
          ).toBe(true);
        }
      )
    );
  });

  it('returns the run max as p100 and the plan percentiles in order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1500, noNaN: true }), {
          minLength: 1,
          maxLength: 300,
        }),
        (values) => {
          const h = createFrameHistogram();
          for (const v of values) h.push(v);
          const s = h.snapshot();
          expect(h.percentile(1)).toBe(Math.max(...values));
          expect(s.p50Ms!).toBeLessThanOrEqual(s.p95Ms!);
          expect(s.p95Ms!).toBeLessThanOrEqual(s.p99Ms!);
          expect(s.p99Ms!).toBeLessThanOrEqual(s.maxMs!);
        }
      )
    );
  });

  it('holds a whole run: 26,000 frames with a few hitches', () => {
    const h = createFrameHistogram();
    for (let i = 0; i < 26_000; i++) h.push(i % 5000 === 4999 ? 70 : 16.7);
    const s = h.snapshot();
    expect(s.count).toBe(26_000);
    expect(h.countOver(50)).toBe(5);
    expect(s.p50Ms).toBe(16.7);
    expect(s.maxMs).toBe(70);
  });

  describe('dropped frames at the calibrated refresh interval', () => {
    it('is null without a refresh interval', () => {
      const h = createFrameHistogram();
      h.push(40);
      expect(h.snapshot().droppedFrames).toBeNull();
    });

    // One interval of n refresh periods hid n - 1 frames (rounded to the
    // nearest period: rAF jitter moves an interval by a fraction of one).
    it('counts the refresh periods each interval skipped', () => {
      const h = createFrameHistogram({ refreshIntervalMs: 1000 / 60 });
      for (const ms of [16.5, 17.2, 33.6, 49.8, 24.9, 25.1, 100]) h.push(ms);
      // 0 + 0 + 1 + 2 + 0 + 1 + 5
      expect(h.snapshot().droppedFrames).toBe(9);
    });

    it('swept over 60, 90 and 120 Hz, a steady run drops nothing', () => {
      for (const hz of [60, 90, 120]) {
        const period = 1000 / hz;
        const h = createFrameHistogram({ refreshIntervalMs: period });
        for (let i = 0; i < 1000; i++) h.push(period * (1 + 0.2 * Math.sin(i)));
        expect(h.snapshot().droppedFrames).toBe(0);
      }
    });
  });

  it('refuses bad options', () => {
    expect(() => createFrameHistogram({ binMs: 0 })).toThrow(RangeError);
    expect(() => createFrameHistogram({ binMs: Number.NaN })).toThrow(
      RangeError
    );
    expect(() => createFrameHistogram({ rangeMs: 0.1, binMs: 0.25 })).toThrow(
      RangeError
    );
    expect(() => createFrameHistogram({ binMs: 1e-6, rangeMs: 1e6 })).toThrow(
      RangeError
    );
    expect(() => createFrameHistogram({ thresholdsMs: [Number.NaN] })).toThrow(
      RangeError
    );
    expect(() => createFrameHistogram({ refreshIntervalMs: 0 })).toThrow(
      RangeError
    );
  });
});
