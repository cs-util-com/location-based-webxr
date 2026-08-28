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
  - **The cross-check now exists** and lives where it had to —
    `GpsPlusSlamJs_Investigation/src/regression/weighted-median-cross-check.test.ts`,
    the only package that may reach the core's internals (this one may
    **not**, IP-protection audit §9). It runs in that project's fast
    regression gate.
  - **It found that "the two agree" is true only on well-formed input**, and
    the earlier wording here overstated it. On 500 seeded sweeps with finite
    values and positive finite weights the two are identical, including the
    tie convention. On **degenerate** input they differ in four pinned ways,
    all of them because this function is a public utility with arbitrary
    callers while the core's is private behind a caller that clamps its
    weights first:
    - empty input — the core returns `0`, this one returns `NaN` via
      `lowerMedian`;
    - a **negative** weight — the core lets it drag the total non-positive and
      falls back to an unweighted median, this one drops the sample;
    - a **NaN** weight — the core discards all weighting, this one discards
      only that sample;
    - a **NaN** value — the core can return it, this one cannot.
  - **Neither is wrong.** None of those inputs is reachable from the core's own
    caller, so the two simply defend against different things — and the
    divergence is now executable rather than assumed.
- **Zero, negative and non-finite weights are dropped**: a zero weight means
  "this sample does not count", and a NaN weight is an upstream bug that must
  not silently move the answer. Non-finite VALUES are dropped too.
- **Falls back to the unweighted `lowerMedian` when no weight survives**, so a
  caller with usable samples is never handed NaN because its weights were bad.
- Added for the session anchor mint, where the owner chose recency weighting
  (plan DEC-3 / M-C1).
