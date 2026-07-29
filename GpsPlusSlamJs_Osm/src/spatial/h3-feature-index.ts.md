# `spatial/h3-feature-index.ts`

## Purpose

`cell → the features that touch it` — the queryable form of a merged tile set.

## Public API

- `buildFeatureIndex(features, { resolution?, restrictTo? }): H3FeatureIndex`
- `featuresAt(index, cell): readonly CellFeature[]` — `[]` for unknown cells.
- `indexEntryCount(index): number`

`H3FeatureIndex`: `byCell`, `byFeature`, `features`, `failed`, `resolution`.

## Invariants & assumptions

- **A broken feature costs itself and nothing else.** Geometry failures are
  collected in `failed`, never thrown. The C# reference throws here; the planet
  contains relations that cannot be closed, and one of them must not blank a
  5 km² working set.
- **`restrictTo` CLIPS the geometry, it does not merely filter the output.** This
  is the difference between working and hanging. Covering costs time
  proportional to the FEATURE's extent, and OSM contains features of continental
  extent — the `beach` fixture is one element holding the entire North Sea, whose
  res-13 coverage is on the order of 10^10 cells. Filtering afterwards is not
  slow, it is non-terminating in practice. See `clip.ts`.
  - Found by the per-chunk cost test hanging, not by review.
- **Without `restrictTo` there is a hard per-feature cell budget**
  (`MAX_CELLS_PER_FEATURE`, 1,000,000), and exceeding it records a
  `coverage-too-large` entry in `failed` rather than covering. Nothing bounds
  the work otherwise, and unbounded covering has two distinct failure modes on
  real data, both measured 2026-07-29:
  - **Merely huge grinds.** An unrestricted index over the building-block
    fixture did not finish in ten minutes, against 113 ms with `restrictTo`.
    With the budget the same call takes 119 ms and names the 2 elements it
    refused.
  - **Genuinely continental throws.** h3 raises `Array length out of bounds`
    from inside `polygonToCellsExperimental` (57 billion cells for a 10-degree
    square), and that escaped `buildFeatureIndex` — breaking this file's own
    "recorded in `failed`, not thrown" contract, which is exactly the case
    `failed` exists for.
  - The estimate is bbox-area over average hexagon area: crude on purpose,
    since it only separates "normal" from "absurd" and those differ by five
    orders of magnitude. It over-estimates sparse shapes, which is the safe
    direction — a false refusal is an actionable `failed` entry, a false
    acceptance is the hang.
- **Several features on one cell stack.** The multiplicative kernel needs every
  factor; overwriting would drop all but one and produce a plausible wrong score.
- **A multipolygon's outer member is suppressed when it adds nothing.** Under
  old-style tagging an outer way repeats its relation's tags, and Overpass
  returns both as top-level elements — so the shared tags multiply in twice and
  a factor of 10 becomes 100, silently and only ever upward.
  - Suppression is **conditional on the member's tags being a subset of the
    parent's**, which is narrower than the C# reference's unconditional removal
    of every `role=outer` member. A `barrier=fence` bounding a `natural=wood`
    relation is a real feature the relation does not describe, and the reference
    loses it.
  - `role=inner` members, members of non-areal relations, and members whose
    parent is absent from the input are all **kept** — see
    `relation-member-doublecount.test.ts` for why each case matters.
  - Requires materialising the input, because a relation is not guaranteed to
    precede its own members.
  - **Measured: this fires on zero elements across all four fixtures.** It is a
    preventive guard, not a correction — an outer way usually carries no tags,
    so the key filter never selects it. One fixture does return an _inner_
    member independently, which is the evidence that the outer case is one tag
    away rather than impossible.
  - Known residual: a member sharing _some_ tags with its parent and adding
    others is kept whole, so the shared subset is still double-counted. Scoring
    only its unique tags would mean synthesising a feature that never existed.
- A feature touching nothing in the restriction is dropped entirely — keeping it
  in `features` would grow memory with something no lookup can reach.
- `indexEntryCount` (pairs) is the size that predicts scoring cost;
  `byCell.size` undercounts wherever features overlap, i.e. everywhere in a city.
- **The index is worker-cloneable but NOT JSON-serialisable** (it holds `Map`s).
  It is a derived, rebuildable artefact — the raw tiles are what gets persisted,
  exactly as the C# reference rebuilds its index per session. Pinned by
  `worker-boundary.test.ts`.

## Examples

```ts
const { features } = mergeTiles(tiles);
const cells = cellsOfChunks(scoreWorkingSet(chunk));
const index = buildFeatureIndex(features.values(), { restrictTo: cells });
```

## Tests

`h3-feature-index.test.ts` — forward/reverse agreement, stacking, geometry
failures isolated and named, `restrictTo` behaviour, edge cases, and the
oversize guard: a continental feature skipped with a `restrictTo`-naming
message, the same feature indexed normally once a restriction bounds it, and
ordinary features untouched by the budget.
`chunk-cost.test.ts` — the per-chunk budget against the real fixtures.
`worker-boundary.test.ts` — the clone/JSON boundary distinction.
