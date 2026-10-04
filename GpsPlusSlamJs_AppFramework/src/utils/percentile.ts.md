# percentile.ts

## Purpose

The framework's one nearest-rank percentile (DEC-H3), beside the median
family in `median.ts`. Created on 2026-10-03 for the globe frame recorder
(plan `GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`,
PERF-0 and review Minor 9), folding three private copies:

- `ar/sun-check.ts` (the Mark's 80th-percentile spread);
- OsmDemo's `createFrameTimes` (now `utils/frame-times.ts`);
- QrTrackingDemo's `qrperf/pipeline-timings.ts` (its p95s and tallies).

## Public API

- `nearestRank(count, p): number` - the 1-based nearest rank,
  `ceil(p * count)`, at least 1, at most `count`. The one rank rule; the
  frame histogram (`frame-histogram.ts`) uses it to walk its bins.
  - `p` is clamped into [0, 1] (every former copy clamped, one by accident).
  - `RangeError` for a non-finite `p`, or a `count` that is not a positive
    integer.
- `percentileOfSorted(sorted, p): number` - the value at that rank of an
  ascending-sorted `ArrayLike<number>`, without a copy; `NaN` when empty.
- `nearestRankPercentile(values, p): number` - the same on any order (a
  sorted `Float64Array` copy; the input is not mutated); `NaN` when empty.
  Accepts arrays and typed arrays.

## Invariants & assumptions

- **The result is always an observed sample value**, never an
  interpolation: the frame recorder reports a frame interval that happened.
- **The decimal-rank slack.** `0.07 * 100` is `7.000000000000001` in binary
  floating point; a bare `ceil` returns rank 8. The product is reduced by
  two ulps of itself before the `ceil`, which returns the exact rank for
  every `p = j / 100` at `n = 100 m` (tested for m in 1, 2, 3, 7, 100,
  1000). The error of `p * n` is at most about one ulp of the product, and
  a genuine fractional part of a rank is many orders of magnitude larger,
  so no real rank moves. The former copies were not affected at the `p`
  they used (0.5, 0.8, 0.95, 0.99 never land just above an integer for
  n up to 100,000, checked), so this is defensive, not a behaviour change
  for them. Same family of defect as `median.ts`'s weighted tie slack.
- **NaN values are not filtered** (their sort position is unspecified, as in
  `median.ts`); callers pre-filter. The frame helpers drop non-finite
  intervals at `push`.
- **-0 and 0** are equal under the sort; which one is returned for a tie is
  unspecified.

## Examples

```ts
nearestRankPercentile([5, 1, 4, 2, 3], 0.5); // 3
nearestRankPercentile([5, 1, 4, 2, 3], 0.95); // 5
nearestRank(100, 0.07); // 7, not 8
percentileOfSorted(sortedFloat64, 0.99);
```

## Tests

`percentile.test.ts`: golden ranks; the decimal-rank sweep; clamping and
refusals; fast-check properties (rank monotone in `p` and within [1, n];
the defining coverage property of the nearest rank; the result is an
element of the sample and order-independent; the sorted and unsorted
entry points agree).

Guarded by `tests/repo-config/duplicate-helpers.test.js`
(`nearestRankPercentile` shared at this file; an unqualified `percentile`
at most once per package).
