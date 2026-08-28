import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { interpolatingMedian, lowerMedian, weightedMedian } from './median.js';

// Why this suite matters: these helpers replaced six private copies with two
// silently different semantics (quality-review A-2). The exact odd/even/empty
// behaviours below are what the six former call sites relied on — a drift
// here would shift QR sizing, tracking-quality scoring, anchor averaging and
// pose aggregation at once.
describe('interpolatingMedian', () => {
  it('returns the middle value for odd-length input', () => {
    expect(interpolatingMedian([3, 1, 2])).toBe(2);
  });

  it('returns the mean of the two middle values for even-length input', () => {
    expect(interpolatingMedian([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns the sole value for a single-element input', () => {
    expect(interpolatingMedian([7])).toBe(7);
  });

  it('returns 0 for empty input (tracking-quality "no samples yet" neutral)', () => {
    expect(interpolatingMedian([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    interpolatingMedian(input);
    expect(input).toEqual([3, 1, 2]);
  });

  // Why this test matters: (a + b) / 2 overflows to Infinity when the two
  // middle values sum past Number.MAX_VALUE, violating the [min, max] bound
  // (found by the fast-check property below in CI, seed 1636289138; shrunk
  // counterexample pinned here so the bug stays deterministic).
  it('does not overflow to Infinity for huge finite middle values', () => {
    expect(
      interpolatingMedian([2.9937604643020797e292, 1.7976931348623155e308])
    ).toBeLessThanOrEqual(1.7976931348623155e308);
    expect(interpolatingMedian([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(
      Number.MAX_VALUE
    );
    expect(interpolatingMedian([-Number.MAX_VALUE, -Number.MAX_VALUE])).toBe(
      -Number.MAX_VALUE
    );
  });

  it('is permutation-invariant and bounded by [min, max]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (values) => {
          const m = interpolatingMedian(values);
          const shuffled = [...values].reverse();
          // `===` (not toBe/Object.is): a stable sort can order -0 and 0
          // differently for a permutation, making the median -0 vs 0 —
          // numerically identical values.
          expect(interpolatingMedian(shuffled) === m).toBe(true);
          expect(m).toBeGreaterThanOrEqual(Math.min(...values));
          expect(m).toBeLessThanOrEqual(Math.max(...values));
        }
      )
    );
  });
});

describe('lowerMedian', () => {
  it('returns the middle value for odd-length input', () => {
    expect(lowerMedian([3, 1, 2])).toBe(2);
  });

  it('returns the LOWER of the two middle values for even-length input', () => {
    expect(lowerMedian([4, 1, 3, 2])).toBe(2);
  });

  it('returns the sole value for a single-element input', () => {
    expect(lowerMedian([7])).toBe(7);
  });

  it('returns NaN for empty input (defensive; callers guarantee non-empty)', () => {
    expect(Number.isNaN(lowerMedian([]))).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    lowerMedian(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('always returns an actually-observed element (never fabricates)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (values) => {
          expect(values).toContain(lowerMedian(values));
        }
      )
    );
  });
});

// Added for the session mint (plan M-C1): the owner chose recency-weighted
// combining, so a weighted median is needed. The core library has one, private
// inside the alignment solver, and the open-source packages may not reach it
// (IP-protection audit §9) — so the CONVENTION is pinned here with golden
// values instead, and a cross-check against the core's belongs in the
// Investigation package, which may.
describe('weightedMedian', () => {
  it('matches the unweighted lower median when all weights are equal', () => {
    for (const values of [[1], [1, 2], [3, 1, 2], [4, 1, 3, 2]]) {
      const weights = values.map(() => 1);
      expect(weightedMedian(values, weights), String(values)).toBe(
        lowerMedian(values)
      );
    }
  });

  it('moves the answer toward the heavier samples', () => {
    // Why this test matters: this IS the feature. Later sightings weigh more,
    // so an answer that ignored weights would silently discard the owner's
    // decision while every other test still passed.
    const values = [0, 10];
    expect(weightedMedian(values, [1, 1])).toBe(0); // lower-median tie rule
    expect(weightedMedian(values, [1, 9])).toBe(10);
    expect(weightedMedian(values, [9, 1])).toBe(0);
  });

  it('takes the lower value on an exact half-weight tie', () => {
    // The convention the core library uses. Stated as a test because two
    // implementations that disagree here disagree by a whole sample.
    expect(weightedMedian([1, 2, 3, 4], [1, 1, 1, 1])).toBe(2);
    expect(weightedMedian([10, 20], [5, 5])).toBe(10);
  });

  it('always returns an OBSERVED sample, never an interpolation', () => {
    expect(weightedMedian([0, 100], [1, 1.0001])).toBe(100);
    expect([0, 100]).toContain(weightedMedian([0, 100], [1, 1]));
  });

  it('drops zero, negative and non-finite weights', () => {
    // A zero weight means "does not count"; a NaN weight is an upstream bug
    // that must not silently move the answer.
    expect(weightedMedian([1, 999], [1, 0])).toBe(1);
    expect(weightedMedian([1, 999], [1, -5])).toBe(1);
    expect(weightedMedian([1, 999], [1, Number.NaN])).toBe(1);
  });

  it('falls back to the unweighted median when no weight survives', () => {
    // A caller with usable samples must never be handed NaN because its
    // weights were all unusable.
    expect(weightedMedian([1, 2, 3], [0, 0, 0])).toBe(lowerMedian([1, 2, 3]));
  });

  it('ignores samples that are not finite', () => {
    expect(weightedMedian([1, Number.NaN, 3], [1, 99, 1])).toBe(1);
  });
});
