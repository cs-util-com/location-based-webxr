/**
 * The framework's one nearest-rank percentile (DEC-H3; globe zoom
 * performance plan 2026-10-03-2017, PERF-0).
 *
 * Three private copies used to carry this rule: the AR sun check's spread,
 * OsmDemo's frame-time ring and QrTrackingDemo's pipeline timings. They
 * agreed for the `p` each one used and differed at the edges (one returned
 * `undefined` at `p = 0`, one `undefined` for a NaN `p`). The rank rule is
 * a contract - the frame recorder's pass/fail target rests on it - so it
 * lives once, here, beside the median family (`median.ts`).
 *
 * @see percentile.ts.md
 */

/**
 * The 1-based nearest rank of fraction `p` in a sample of `count` values:
 * `ceil(p * count)`, at least 1. `p` is clamped into [0, 1], as every
 * former copy did.
 *
 * The product is taken with a slack of two ulps of `p * count` so that a
 * decimal `p` whose product is an integer in exact arithmetic gets that
 * integer: in binary floating point `0.07 * 100` is `7.000000000000001`,
 * and a bare `ceil` would return rank 8. A genuine fraction of a rank is
 * many orders of magnitude larger than the slack.
 *
 * @throws RangeError for a non-finite `p` or a `count` that is not a
 *   positive integer (a caller bug, never silently a rank).
 */
export function nearestRank(count: number, p: number): number {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(
      `count must be a positive integer, got ${String(count)}`
    );
  }
  if (!Number.isFinite(p)) {
    throw new RangeError(`p must be finite, got ${String(p)}`);
  }
  const q = Math.min(1, Math.max(0, p));
  const x = q * count;
  const rank = Math.ceil(x - 2 * x * Number.EPSILON);
  return Math.min(count, Math.max(1, rank));
}

/**
 * The nearest-rank percentile of an ALREADY ascending-sorted sample, without
 * copying it; `NaN` for an empty sample. For callers that read several
 * percentiles of one sort.
 */
export function percentileOfSorted(
  sorted: ArrayLike<number>,
  p: number
): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[nearestRank(sorted.length, p) - 1]!;
}

/**
 * The nearest-rank percentile of `values` (any order; not mutated): the
 * smallest sample value with at least a fraction `p` of the sample at or
 * below it. Always an observed value; `NaN` for an empty sample.
 *
 * NaN values are not filtered (their sort position is unspecified, as in
 * `median.ts`); callers pre-filter.
 */
export function nearestRankPercentile(
  values: readonly number[] | ArrayLike<number>,
  p: number
): number {
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  return percentileOfSorted(sorted, p);
}
