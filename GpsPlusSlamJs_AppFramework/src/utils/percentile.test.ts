/**
 * Tests for the framework's one nearest-rank percentile.
 *
 * Why this file matters: the rank rule is a CONTRACT. Before this file the
 * framework (sun check), OsmDemo (frame times) and QrTrackingDemo (pipeline
 * timings) each carried a private copy, two of which crashed or returned
 * `undefined` for an edge `p`, and all of which turned `ceil(0.07 * 100)`
 * into rank 8. The frame-time recorder (globe zoom performance plan,
 * PERF-0) reports p50 / p95 / p99 and a pass/fail target from it, so one
 * rank off is a different verdict.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  nearestRank,
  nearestRankPercentile,
  percentileOfSorted,
} from './percentile.js';

describe('nearestRank', () => {
  it('is the 1-based rank ceil(p * n), at least 1', () => {
    expect(nearestRank(100, 0.5)).toBe(50);
    expect(nearestRank(100, 0.95)).toBe(95);
    expect(nearestRank(100, 0.99)).toBe(99);
    expect(nearestRank(100, 1)).toBe(100);
    expect(nearestRank(100, 0)).toBe(1);
    expect(nearestRank(3, 0.5)).toBe(2);
    expect(nearestRank(1, 0.99)).toBe(1);
  });

  // Why this test matters: 0.07 * 100 is 7.000000000000001 in binary
  // floating point, so a bare ceil returns rank 8. The rule must give the
  // rank of the DECIMAL fraction the caller wrote. Swept over every
  // hundredth and several sample sizes.
  it('gives the exact rank for every decimal p = j / 100 at n = 100 m', () => {
    for (const m of [1, 2, 3, 7, 100, 1000]) {
      for (let j = 0; j <= 100; j++) {
        expect(nearestRank(100 * m, j / 100)).toBe(Math.max(1, j * m));
      }
    }
  });

  it('clamps p into [0, 1], as every former copy did', () => {
    expect(nearestRank(10, -0.5)).toBe(1);
    expect(nearestRank(10, 1.5)).toBe(10);
  });

  it('refuses a non-finite p or a count that is not a positive integer', () => {
    expect(() => nearestRank(10, Number.NaN)).toThrow(RangeError);
    expect(() => nearestRank(10, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => nearestRank(0, 0.5)).toThrow(RangeError);
    expect(() => nearestRank(2.5, 0.5)).toThrow(RangeError);
  });

  it('is monotone in p and stays within [1, n]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const rLo = nearestRank(n, lo);
          const rHi = nearestRank(n, hi);
          expect(rLo).toBeGreaterThanOrEqual(1);
          expect(rHi).toBeLessThanOrEqual(n);
          expect(rLo).toBeLessThanOrEqual(rHi);
        }
      )
    );
  });

  // The defining property of the nearest rank: at least a fraction p of
  // the sample lies at or below it, and fewer than that below the rank
  // before it. Allowed a slack of one rank only where p * n sits within
  // floating-point noise of an integer, which is exactly the case the
  // decimal-rank test above decides.
  it('covers a fraction of at least p of the sample, and is the smallest such rank', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, p) => {
          const r = nearestRank(n, p);
          const x = p * n;
          const nearInteger = Math.abs(x - Math.round(x)) <= 1e-9 * n;
          const covers = nearInteger
            ? Math.abs(r - Math.max(1, Math.round(x))) <= 1
            : r >= x && (r === 1 || r - 1 < x);
          expect(covers, `n ${n}, p ${p}, rank ${r}`).toBe(true);
        }
      )
    );
  });
});

describe('nearestRankPercentile', () => {
  it('returns the nearest-rank value of a sorted copy', () => {
    const xs = [5, 1, 4, 2, 3];
    expect(nearestRankPercentile(xs, 0.5)).toBe(3);
    expect(nearestRankPercentile(xs, 0.95)).toBe(5);
    expect(nearestRankPercentile(xs, 0)).toBe(1);
    expect(nearestRankPercentile(xs, 1)).toBe(5);
    expect(xs).toEqual([5, 1, 4, 2, 3]);
  });

  it('is NaN for an empty sample', () => {
    expect(nearestRankPercentile([], 0.5)).toBeNaN();
  });

  it('accepts typed arrays', () => {
    expect(nearestRankPercentile(new Float64Array([3, 1, 2]), 0.5)).toBe(2);
  });

  it('is always an element of the sample and order-independent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (xs, p) => {
          const v = nearestRankPercentile(xs, p);
          const reversed = nearestRankPercentile([...xs].reverse(), p);
          expect(xs.some((x) => Object.is(x, v))).toBe(true);
          // === so that -0 and 0 (equal under the sort) count as one value.
          expect(v === reversed).toBe(true);
        }
      )
    );
  });

  it('agrees with percentileOfSorted on the sorted sample', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true }), { minLength: 0, maxLength: 200 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (xs, p) => {
          const sorted = [...xs].sort((a, b) => a - b);
          const a = nearestRankPercentile(xs, p);
          const b = percentileOfSorted(sorted, p);
          // === so that -0 and 0 (equal under the sort) count as one value.
          expect(a === b || (Number.isNaN(a) && Number.isNaN(b))).toBe(true);
        }
      )
    );
  });
});
