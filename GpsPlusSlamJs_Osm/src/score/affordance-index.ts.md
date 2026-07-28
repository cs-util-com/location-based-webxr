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
- **Two-stage funnel per chunk**: a cheap bbox test from RAW inline positions
  over every feature, then ring stitching, clipping and covering only for
  survivors. At res 7 a fetch tile holds ~21,800 features and a chunk needs a
  handful, so converting all of them would be the cost this class exists to
  avoid. A failed conversion is cached as a failure so a broken relation is
  examined once, not once per chunk forever.
- **Chunks are scored nearest-first.** Changes no result; means an interrupted
  run did the most useful work first. Same reasoning as the reference's
  `SortClosestTo`.
- **Published `ScoredChunk`s are frozen**, mirroring `MakeAllTilesImmutable`. A
  late tile re-scores while a consumer may still hold the previous result, and
  an in-place update would present as a stale UI rather than an error.
- **Invalidation is spatial, not global.** A tile only invalidates chunks whose
  bbox it overlaps (plus any chunk that names it). A distant prefetch must not
  flush the cache.
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
  the queries.
- `affordance-index.property.test.ts` — the three properties that make an
  incremental cache trustworthy: the same scores however the user walked there,
  a late tile leaving the index as if it had always been present, and no chunk
  scored twice without an invalidation between.

No fixtures required; the tests build their own tiles so the inputs are known
exactly.
