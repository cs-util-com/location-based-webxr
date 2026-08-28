# median.ts

## Purpose

The project's two median semantics as named helpers (2026-07-10 quality-review A-2 — consolidates six private copies that had two silently different behaviours under near-identical names).

## Public API

- `interpolatingMedian(values: readonly number[]): number` — mean of the two middle values for even n; empty → `0`. For continuous measurements where an in-between value is meaningful.
- `lowerMedian(values: readonly number[]): number` — lower of the two middle values for even n (always an actually-observed sample); empty → `NaN` (defensive, callers guarantee non-empty). For selecting a representative real observation.

## Invariants & assumptions

- Neither helper mutates its input (both sort a copy).
- `interpolatingMedian` never overflows for finite inputs: the even-length mean falls back to `lo / 2 + hi / 2` when `lo + hi` exceeds `Number.MAX_VALUE`, so the result always stays within `[min, max]` (found by the fast-check bound property in CI on 2026-07-10).
- `NaN` inputs are not filtered — the comparator leaves their order unspecified, matching the former private copies; callers pre-filter.
- Choosing between the two variants is semantic, not stylistic: interpolating fabricates values, lower-middle never does.

## Examples

```ts
interpolatingMedian([1, 2, 3, 4]); // 2.5
lowerMedian([1, 2, 3, 4]); // 2
```

## Tests

`median.test.ts` — odd/even/single/empty cases for both variants, no-mutation pin, and fast-check properties (permutation invariance; lower median is always an element of the input; interpolating median lies within [min, max]).

## weightedMedian (added 2026-08-28)

- `weightedMedian(values, weights): number` — the value where half the
  **weight** lies on either side.
- **Lower-median convention, matching `lowerMedian`**: the result is always an
  observed sample, and an exact half-weight tie takes the LOWER of the two
  straddling values. That convention is shared with the core library's
  private weighted median inside the alignment solver, and two implementations
  that disagree here disagree by a whole sample — so it is pinned with golden
  values.
  - An executable cross-check against the core's own implementation belongs
    in `GpsPlusSlamJs_Investigation`, which may reach the core internals —
    this package may **not** (IP-protection audit §9). **It is not written
    yet**; the convention is pinned with golden values in the meantime, and
    the gap is recorded rather than implied.
- **Zero, negative and non-finite weights are dropped**: a zero weight means
  "this sample does not count", and a NaN weight is an upstream bug that must
  not silently move the answer. Non-finite VALUES are dropped too.
- **Falls back to the unweighted `lowerMedian` when no weight survives**, so a
  caller with usable samples is never handed NaN because its weights were bad.
- Added for the session anchor mint, where the owner chose recency weighting
  (plan DEC-3 / M-C1).
