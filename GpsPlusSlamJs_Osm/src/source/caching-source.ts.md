# `source/caching-source.ts`

## Purpose

Cache-first decorator around any `OsmDataSource`, backed by an injected
`OsmBlobStore`.

## Public API

- `CachingSource` implementing `OsmDataSource`.
- `cacheKey(tile)` → `osm/v{schemaVersion}/{tile}`.
- `ensureTile(tile, { signal?, maxAgeMs? })`.
- `listCachedTiles()` → res-8 cell ids.
- `evictTile(tile)`.
- `stats` — `{ hits, misses, staleRefetches, deduplicated }`.

## Invariants & assumptions

- **Keyed by the fixed H3 grid cell, never by the query bbox.** This is the
  single most consequential decision in the package's caching: a walking user
  generates a slightly different bbox every second, so a bbox-keyed cache hits
  zero percent of the time _while looking entirely healthy_ — unbounded network
  cost with no error to notice. A test drives 25 requests through one tile and
  asserts exactly one downstream call.
- **The schema version is in the key AND checked in the payload.** Belt and
  braces: a store shared between package versions could return a v1 blob under a
  v2 key after a manual migration.
- **Cache-first, stale-is-fine, but expiry is the consumer's policy.** The
  library never expires anything on its own. `maxAgeMs` is per call, because
  "indefinitely" is too strong for a UI — an AR overlay showing a building
  demolished two years ago is a bug, not acceptable staleness.
- **`fetchedAt` is preserved through the cache**, so provenance describes when
  the data was retrieved rather than when it was last read.
- **A corrupt entry is a miss, never a throw.** Truncated writes, quota eviction
  mid-write and lying backends all happen. The cost of being wrong is one
  refetch; the cost of throwing is a permanently poisoned tile.
- **A throwing store is also a miss** — quota-exceeded and permission-revoked
  both throw on read.
- **Concurrent misses for one tile make one downstream call.** The inner
  source's own dedup only helps if the inner source has one; a `FixtureSource`
  or a future PMTiles source may not.
- **Eviction is never automatic.** Only the host app knows its storage budget
  and which areas the user cares about, so the library exposes
  `listCachedTiles`/`evictTile` and nothing more.

## Tests

`caching-source.test.ts` — 24 tests across five groups: the cache key
(including the 25-request walking-user regression and both schema-version
guards), cache-first behaviour, staleness policy, five corrupt-entry shapes plus
a throwing store, eviction, and decorator transparency.
