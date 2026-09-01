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
  - **Two paths, and which one runs depends on whether the tile is new.**
    A tile never held before can only ADD or OUTRANK records, never remove
    one, so it is OVERLAID onto the current merge. A REFETCH can remove them —
    absence inside the bbox of one tile means deletion (`mergeTiles`) — so it
    re-merges every held tile.
  - **Why the overlay is equivalent.** `mergeTiles` sorts by `compareTiles`, a
    TOTAL order on (`fetchedAt`, tile id), and lets the last write win, so the
    owner of a key after a full merge is the greatest tile containing it.
    Adding a tile leaves the relative order of the others untouched, so the
    new owner is `max(current owner, incoming tile)` — one comparison against
    the recorded provenance, rather than a rebuild that visits every key no
    tile touched.
  - **Measured 2026-08-30** (perf loop, OSM iteration 13; devbox-win11,
    i7-1185G7, Node 24.14.1, median of 5), AFTER the same-tile-repeat fix.
    Accepting 24 tiles of 2 259 features each:
    - **session 821 → 168 ms (−79.5 %)** — baseline runs 742/743/821/892/897,
      optimized 149/165/168/172/203. The spreads do not overlap.
    - **24th accept 66.2 → 12.4 ms (−81.3 %)** — optimized runs
      10.2/11.9/12.4/19.8/25.1. This one is noisy at the top end; the session
      total is the figure to trust.
    - The old cost grew with the whole working set on every accept, so a walk
      paid quadratically for tiles it had already merged.
    - **This is ONE run, quoted identically in `affordance-index.ts`** (PR
      #388 review). Three different figures for this benchmark were in the
      tree simultaneously — this sidecar, the docstring, and a commit message
      — and the first two described the pre-fix code. `retracted-osm-figures`
      exists because this repo treats a stale number as a defect, not a typo.
  - **The merged map is still REPLACED, not mutated.** `mergedFeatures()`
    promises a snapshot whose identity changes; mutating in place would save
    the copy and hand a holder a TORN view instead of the stale one that
    contract already names.
- `update(position: LatLng): UpdateResult` — brings the 19-chunk working set up
  to date. Returns `{ workingSet, scored, reused }`.
- `onChanged(listener): () => void` — subscribe; returns an unsubscribe.
- `chunk(id): ScoredChunk | undefined`, `scoredChunks(): readonly ScoredChunk[]`
- `cellsAbove(category, threshold): string[]`
- `scoresByCell(): Map<string, CellScore>` — the shape `region-builder` wants.
- `mergedFeatures(): ReadonlyMap<OsmFeatureKey, OsmFeature>`
- `stats` — `chunksScored`, `chunksReused`, `chunksEvicted`, `geometryBuilt`,
  `geometryReused`, `movesIgnored`, `chunksPinned`, `chunksPinnedPeak`,
  `pinnedOverCap`, `scoresByCellBuilds`.
  - **`chunksPinned` is LIVE and `chunksPinnedPeak` is a SESSION maximum.** The
    live count is reset in `withPinned`'s `finally`, so anyone asking after the
    fact reads zero. The peak is never reset: the worst case across a session is
    what a cap is judged against, not whatever the last call happened to need.
  - **Neither is a per-call figure, and a consumer that wants one must take it
    itself.** The OSM demo's geo-event benchmark reads `chunksPinned` from
    INSIDE its `withPinned` callback for exactly this reason — it briefly read
    the session peak instead, and every search after the first then reported the
    largest one so far.
  - **`pinnedOverCap` can only ever describe an `update()`.** It is assigned in
    `evictBeyond`, which nothing else calls, so it never observes pins held by
    `withPinned` — those are released before the next eviction runs. It is also
    sticky (never cleared), so it reports the last non-zero reading rather than
    the current state.

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

### `ensureScored(cells)` and `withPinned(cells, body)` — the lazy path (round 9 §4)

- `ensureScored` scores the chunks those cells fall in and **nothing else**, and
  returns `{ missingTiles }` — the fetch tiles it could not cover. **It does not
  fetch**: this class is push-only and synchronous by design, which is what keeps
  it worker-safe and testable with no network (DEC-R9-10). The caller fetches and
  calls again, and reporting what was actually missing cannot drift from what was
  actually needed.
  - **It does not evict.** Eviction belongs to `update`, the only call that knows
    where the user is and therefore what "far away" means.
  - **It does not write `lastChunk` / `lastRadius`.** Those mean how far the
    USER's position has been scored; writing them would make the next `update`
    short-circuit past real work.
  - **It bumps `chunkVersion`.** `scoreChunks` does not — `update` does — so a
    second write path that forgets it hands back the stale `scoresByCell` map and
    every newly scored cell is invisible, presenting as "the map stopped
    updating". This is the highest-risk line in the lazy path, and its test is
    mutation-checked because the first version of that test passed with the bump
    deleted.
- `withPinned` exempts those chunks from eviction for the duration of `body`,
  releasing them in a `finally` so a throwing algorithm cannot leave the cap
  permanently unenforceable.
  - **Pinning is not an optimisation here.** `update` calls `evictBeyond`
    unconditionally and the demo issues three `update`s per user action, so a
    chunk scored far from the user would otherwise be scored, evicted and
    re-scored on every ring.
  - **Pins win over `maxChunks`, and the overrun is counted** in
    `stats.pinnedOverCap` (DEC-R9-11). Losing data mid-algorithm is the failure
    pinning exists to prevent; exceeding the cap requires several batches held at
    once without releasing, which is a bug, and counting makes it visible rather
    than silent.

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
  res 7 a fetch tile is estimated at ~40,000–116,000 features and a working set
  needs a handful, so converting all of them would be the cost this class exists
  to avoid. (The ~21,800 previously quoted here is retracted — see
  `resolutions.ts` FETCH_RES; the replacement is a bracket, not a count, because
  no fixture holds a full res-7 tile.) A
  failed conversion is cached as a failure so a broken relation is examined
  once, not once per chunk forever.
  - ⚠️ **It is a LINEAR SWEEP, not a tree.** Every merged feature of every held
    tile is bbox-tested on every scoring pass, and tiles are never evicted, so
    the sweep grows for the whole session. `scoreChunks` used to describe this
    as working "exactly as the reference queries its quadtree", which is wrong
    in the one way that matters — a quadtree does not visit every feature.
    - Defensible on **cost**: the whole sweep measures ~1.1 ms across a res-7
      tile's features, so a tree saves ~1 ms per move
      ([design §1](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-31-1005-osm-spatial-index-design.md)).
    - Not defensible on **capability**: AR frame-loop queries ("what is in the
      direction the user is looking") need real geometry-based overlap lookups,
      which this shape cannot answer at all. A `flatbush` index was planned to
      ship as the package's first runtime dependency; the supporting modules
      (`geometry-overlap`, `bbox-overlap`, `ring-overlap`, the bench) landed and
      the index did not. See
      [the 2026-08-13 review findings](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-13-2305-osm-spatial-structure-review-findings.md).
  - **No oversize guard, unlike `buildFeatureIndex`.** What keeps a
    continental-extent feature finite here is the clip to the batch's selection
    box, not a budget. Measured on the `beach` fixture (the entire North Sea as
    one relation): a radius-4 batch's box is **1.812×** the chunks' own area and
    holds 5 417 res-13 cells, the clipped cover produces **4 409** of which
    2 177 are kept, and `update` takes ~93 ms. The bound is a consequence of the
    scored disc's size and nothing states it — see
    `oversize-feature-guard.test.ts`.
  - **`selectionBoxFor` is exported for that test** (r514 review). It had a
    private copy of the union loop and of `CHUNK_MARGIN_DEG`, so the one
    production knob its ratio assertion guards was invisible to it — raising the
    margin would grow the real box while the test kept measuring the old
    constant and passing.
  - **`stats.cellsCovered` counts the INPUT side of the per-chunk filter.**
    Everything else here counts kept cells, which are capped at `chunks × 49` by
    construction, so the cost of covering against the whole box was
    unobservable: deleting the clip left every assertion passing and the suite
    grinding as the only signal.
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
