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
- **Several features on one cell stack.** The multiplicative kernel needs every
  factor; overwriting would drop all but one and produce a plausible wrong score.
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
failures isolated and named, `restrictTo` behaviour, edge cases.
`chunk-cost.test.ts` — the per-chunk budget against the real fixtures.
`worker-boundary.test.ts` — the clone/JSON boundary distinction.
