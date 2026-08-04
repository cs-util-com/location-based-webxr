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

### `cellState(cell)` — the tri-state read (round 9 §3)

Returns `{state:"scored", score}`, `{state:"empty"}` or `{state:"unknown"}`.

- **Three states because two were a bug.** Every other read answers an unscored
  cell with the multiplicative identity — the same answer a genuinely empty cell
  gives — so "nothing is mapped here" and "nobody has looked yet" were
  indistinguishable. Tolerable while scoring only ever happened in a disc around
  the user; load-bearing the moment an algorithm reads outside it.
- **It surfaces a distinction that already existed**, one level up: `chunk()`
  returns `undefined` for unscored against a `ScoredChunk` whose `featureCount`
  may be 0. What was missing was a path from a CELL to that fact.
- **`empty` is a chunk-membership check, not a lookup with a default.**
  `distribute` only records a cell some feature covered, so a scored-but-empty
  chunk publishes no cell records at all. Materialising them would mean ~2 989
  records of pure absence per working set crossing the worker boundary.
- **It goes straight to the chunk, never through `scoresByCell()`.** That map
  rebuilds over EVERY retained chunk (~24 000 cells) whenever `chunkVersion`
  moves, and the geo-event climb interleaves single-cell reads with scoring that
  bumps it — so routing through it would rebuild everything after every ensure,
  for an algorithm whose whole point is a bounded neighbourhood. A cell's res-11
  parent names its chunk directly, so the lookup is O(49) over one chunk and
  cannot be invalidated.
- **Read-only.** Never scores, never fetches, never awaits.

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
- **The cap is DERIVED from the working set, not a written-down number (W7).**
  `maxChunks` defaults to eight working sets at `SCORE_DISK_MAX_RADIUS`. It was a
  hard-coded 256 chosen when a working set was 19 chunks — "~13 working sets" —
  and DEC-R2-20 then widened the scored disk to 61 without revisiting it, leaving
  ~4 moves of headroom. Past that the LRU evicts chunks the next click needs, so
  a click re-scores ground it has just scored: invisible to every functional test
  (the answers stay correct, they are only recomputed) and visible to a user as
  the app feeling non-deterministic. Deriving it means widening the disk again
  cannot silently reintroduce that.
- **`scoresByCell()` is cached against a chunk-version counter (W9), and the
  INVALIDATION is the point.** The map walks every retained chunk — up to eight
  working sets of 49 cells — and the demo asks for it once per scoring pass
  (three per click) plus once per `explain`. A stale map here is a map that stops
  updating, which is far worse than the cost it removes, so the counter is bumped
  by every path that adds, replaces or drops a chunk. The returned map is the
  cached INSTANCE, not a copy: it is invalidated rather than mutated, so a caller
  holding one across a mutation keeps a consistent old snapshot rather than a
  half-updated one.
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
