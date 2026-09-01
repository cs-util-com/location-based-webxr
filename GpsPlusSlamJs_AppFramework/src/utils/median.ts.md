# median.ts

## Purpose

The project's two median semantics as named helpers (2026-07-10 quality-review A-2 — consolidates six private copies that had two silently different behaviours under near-identical names).

## Public API

- `interpolatingMedian(values: readonly number[]): number` — mean of the two middle values for even n; empty → `0`. For continuous measurements where an in-between value is meaningful.
- `lowerMedian(values: readonly number[]): number` — lower of the two middle values for even n (always an actually-observed sample); empty → `NaN` (defensive, callers guarantee non-empty). For selecting a representative real observation.
  - **"Callers guarantee non-empty" is a real precondition, and the one caller that could not guarantee it wrote its own copy instead.** `ar/elevation-offset-estimator.ts` needed an empty case and had a private `lowerMedian` returning `null` for a year; it now length-checks before calling. If a future caller wants that shape again, give this function an explicit empty-returning sibling rather than letting a seventh copy appear — the empty encoding is caller policy, the selection rule is the contract.
  - **These three names are now guarded.** `tests/repo-config/duplicate-helpers.test.js` holds `lowerMedian`, `interpolatingMedian` and `weightedMedian` to this file as `shared`, and the unqualified `median` to one-per-package (for packages like `GpsPlusSlamJs_Osm` that cannot reach the framework). The 2026-07 consolidation was undone once before the guard learned these names.

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

`median.property.test.ts` — `weightedMedian`'s four invariants, added because
two consumers now turn its output into real-world coordinates and examples
cannot reach these (PR #391 review): membership (the result is an observed
value, never a fabricated average); **flat weights agree with `lowerMedian`**,
which is the one `combinePlacements` subtracts to report how far the weighting
moved an anchor; order-independence, since the caller's sightings arrive in a
contract-defined order a median must not care about; and at least half the
weight sitting at or below the result. The second of those failed on its first
run and is what surfaced the tie-slack defect above.

## weightedMedian (added 2026-08-28)

- `weightedMedian(values, weights): number` — the value where half the
  **weight** lies on either side.
- **Lower-median convention, matching `lowerMedian`**: the result is always an
  observed sample, and an exact half-weight tie takes the LOWER of the two
  straddling values. That convention is shared with the core library's
  private weighted median inside the alignment solver, and two implementations
  that disagree here disagree by a whole sample — so it is pinned with golden
  values.
  - ⚠️ **The tie convention needed a SLACK term to actually hold, and the
    original code silently inverted it** (PR #391 review, found by
    `median.property.test.ts` on its first run). `total` sums every weight
    while `cumulative` sums a prefix, so the two accumulate rounding
    differently and an exact tie can miss by a fraction of an ULP — handing
    back the UPPER straddling value.
    - Measured counterexample: six equal weights of `331.0968672709313`,
      whose prefix sum of three lands **0.52 ULP** below `total / 2`.
    - **Flat weights are not an exotic input**: `qr-anchor-mint`'s
      `combinePlacements` uses them to build the unweighted comparison, so any
      even number of sightings could hit it. The symptom would have been the
      session summary reporting "recency weighting moved the anchor N m" for a
      mint whose weighting changed nothing — a plausible-looking number that
      nothing downstream could contradict.
    - The slack is `|total| * Number.EPSILON * pairs.length`, scaled to where
      the error actually comes from, and far too small to move a genuine
      decision.
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
