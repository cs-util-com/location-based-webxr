# `score/affordance-index.ts`

## Purpose

The stateful owner of everything derived — merged features, converted geometry,
and per-chunk scores — plus the invalidation that keeps them honest when a tile
arrives late. Everything below it is a pure function; this is the only class in
the package that remembers anything.

## Public API

- `new AffordanceIndex({ table, categories?, maxChunks? })`
- `acceptTile(tile: OsmTileResult): readonly string[]` — merges the tile, drops
  the scores it invalidates, notifies listeners, and returns the invalidated
  chunk ids.
- `update(position: LatLng): UpdateResult` — brings the 19-chunk working set up
  to date. Returns `{ workingSet, scored, reused }`.
- `onChanged(listener): () => void` — subscribe; returns an unsubscribe.
- `chunk(id): ScoredChunk | undefined`, `scoredChunks(): readonly ScoredChunk[]`
- `cellsAbove(category, threshold): string[]`
- `scoresByCell(): Map<string, CellScore>` — the shape `region-builder` wants.
- `mergedFeatures(): ReadonlyMap<OsmFeatureKey, OsmFeature>`
- `stats` — `chunksScored`, `chunksReused`, `chunksEvicted`, `geometryBuilt`,
  `geometryReused`, `movesIgnored`.

`ScoredChunk`: `{ chunk, cells, tiles, featureCount }`, frozen.

## Invariants & assumptions

- **A move inside the current res-11 chunk does nothing at all.** This is the C#
  reference's `oldUserTile` guard and it is what makes calling `update()` on
  every GPS fix reasonable rather than reckless.
- **Geometry is converted once per feature, ever**, and survives every move. It
  is dropped only for features the merge actually replaced — a refetch of one
  tile must not throw away the conversion work for the whole map. This is
  `OsmGeoSpatialIndexer`'s `geometryLookup`/`envelopeLookup` pair, the
  reference's single best performance idea.
- **Two-stage funnel**: a cheap bbox test from RAW inline positions over every
  feature, then ring stitching, clipping and covering only for survivors. At
  res 7 a fetch tile holds ~21,800 features and a working set needs a handful,
  so converting all of them would be the cost this class exists to avoid. A
  failed conversion is cached as a failure so a broken relation is examined
  once, not once per chunk forever.
- **The whole batch of not-yet-held chunks is scored in ONE pass over the
  features** (`scoreChunks`), not one pass per chunk.
  - Measured 2026-07-29 (perf loop): **84 % of `update`'s time was
    `polygonToCellsExperimental`**, the h3 call behind `coverCells` — not the
    bbox funnel, not clipping, not scoring. It dominated through sheer
    repetition: a cold working set is 19 chunks, and a feature touching several
    of them was clipped and covered once per chunk.
  - The waste compounded with `CHUNK_MARGIN_DEG`. At ~55 m against a ~29 m
    chunk edge, each per-chunk selection box was ~135 m across — nearly the
    size of the entire 19-chunk working set. Nineteen overlapping ~135 m covers
    were computed to fill a ~150 m area, and all but the 49 cells belonging to
    the chunk under scrutiny were thrown away.
  - Measured effect, medians of 5 on devbox-win11 (cold `update`):
    park 226→54 ms (−76 %), street-corner 445→56 ms (−87 %), beach 72→28 ms
    (−61 %), building-block 742→119 ms (−84 %). `update` now lands within ~5 %
    of a single unrestricted `buildFeatureIndex` pass over the same 931 cells,
    i.e. the repetition is gone rather than merely reduced.
  - **Soundness rests on two things**, both pinned by tests: each chunk gets
    its OWN `byCell`/`kept`, and coverage is attributed through a `cellToChunk`
    partition (`childCells` of distinct res-11 chunks are disjoint, so no cell
    reaches two buckets). Clipping to the union instead of to one chunk cannot
    change a cell's coverage either — clipping is an intersection, so for any
    cell inside the rectangle the covered area is identical, and the union
    contains every per-chunk rectangle.
  - **A chunk's result must not depend on the batch it was scored in**, or
    scores would depend on the route the user walked. `affordance-index.test.ts`
    scores the same chunks in deliberately different groupings and compares.
- **Chunks are reported nearest-first.** `scored` keeps the ring-distance order,
  so a consumer still learns which chunks were computed in the order that
  matters. Same reasoning as the reference's `SortClosestTo` — though with one
  batch the ordering is now presentational rather than a work schedule.
- **Published `ScoredChunk`s are frozen**, mirroring `MakeAllTilesImmutable`. A
  late tile re-scores while a consumer may still hold the previous result, and
  an in-place update would present as a stale UI rather than an error.
- **Invalidation is spatial, not global.** A tile only invalidates chunks whose
  bbox it overlaps (plus any chunk that names it). A distant prefetch must not
  flush the cache.
  - **`ScoredChunk.tiles` therefore means CONTRIBUTORS, not "tiles held".** The
    distinction is load-bearing, not pedantic: listing every held tile makes the
    "names it" branch true for every chunk on any refetch of a known tile, so
    the whole cache drops regardless of geography — and §5.2's `maxAgeMs`
    refresh is exactly that refetch, i.e. the normal path.
  - The set is derived from `mergeTiles`'s `provenance`, which already resolves
    which tile won each record. Recomputing it here would be a second, divergable
    copy of the same rule.
  - **The field cannot simply be deleted in favour of the bbox test.** One way —
    a river, a motorway, a landuse multipolygon — can be held by one tile and
    cover ground well outside that tile's bbox, so a chunk can legitimately name
    a tile it does not overlap.
- **A late tile clears the move short-circuit.** The guard is about the user's
  position; when the world changes under a stationary user, the next `update()`
  must still do work. Without this the tile would arrive and never be scored.
- **Eviction is furthest-first, not least-recently-used.** The access pattern is
  spatial: a chunk 500 m behind the user is dead weight however recently it was
  read. The current working set is never evicted.
- **This class does not fetch.** `acceptTile` is push-only, so network policy
  (slot budget, backoff, queueing) stays in `source/` and this class stays
  synchronous and worker-safe.

## Examples

```ts
const index = new AffordanceIndex({ table });
index.onChanged((chunks) => redraw(chunks));

// A tile from the network, or from cache, or arriving late from the queue.
index.acceptTile(await source.fetchTile(tile));

// On every GPS fix — cheap unless the user crossed a chunk boundary.
const { scored, reused } = index.update(position);

const walkable = index.cellsAbove("walkable", thresholdFor(table, "walkable"));
const regions = buildRegions(
  connectedComponents(walkable),
  "walkable",
  index.scoresByCell(),
);
```

## Tests

- `affordance-index.test.ts` — the move short-circuit, chunk reuse across a
  step, geometry converted once, late-tile invalidation + notification + forced
  re-score, distant tiles invalidating nothing, frozen results, eviction, and
  the queries. Plus the batching guards: a chunk scored identically in a large
  and a small batch, every working-set chunk getting a result (including empty
  ones), and `tiles` staying per-chunk rather than per-batch.
  - Note the geometry-cache tests are pinned by a REFETCH re-scoring the same
    ground, not by a cold update. Since a cold working set consults each
    feature exactly once now, the "`geometryBuilt` did not grow" assertions
    would pass vacuously on their own — deleting the cache entirely would not
    trip them.
- `affordance-index.bench.ts` — the cold-`update` instrument the batching was
  measured against, paired with a single batched pass over the same 931 cells
  as the reference point.
- `affordance-index.property.test.ts` — the three properties that make an
  incremental cache trustworthy: the same scores however the user walked there,
  a late tile leaving the index as if it had always been present, and no chunk
  scored twice without an invalidation between.

No fixtures required; the tests build their own tiles so the inputs are known
exactly.
