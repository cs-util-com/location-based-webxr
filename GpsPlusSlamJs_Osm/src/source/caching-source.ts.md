# `source/caching-source.ts`

## Purpose

Cache-first decorator around any `OsmDataSource`, backed by an injected
`OsmBlobStore`.

## Public API

- `CachingSource` implementing `OsmDataSource`.
- `cacheKey(tile)` → `osm/v{schemaVersion}/{tile}`.
- `ensureTile(tile, { signal?, maxAgeMs? })`.
- `listCachedTiles()` → `FETCH_RES` (res-7) cell ids.
- `evictTile(tile)`.
- `stats` — `{ hits, misses, staleRefetches, deduplicated, staleOnRateLimit }`.

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
- **A refused slot is answered from the stale copy, not propagated** — counted
  as `staleOnRateLimit`. This is the one failure where the cache holds the
  better answer: nothing is wrong upstream and the data returns shortly, so
  rethrowing would make `loadTiles` file the tile as `deferred` and the caller
  render nothing while a usable copy sits in the store.
  - Narrow on both axes, and each half has its own test. Any error that is not
    a `RateLimitedError` still propagates, because a broken source must not
    hide behind a stale render. A rate limit with an EMPTY cache still rejects,
    because "not fetched yet" is a real answer a caller must be able to tell
    apart from "no data here".
- **A corrupt entry is a miss, never a throw.** Truncated writes, quota eviction
  mid-write and lying backends all happen. The cost of being wrong is one
  refetch; the cost of throwing is a permanently poisoned tile.
- **A throwing store is also a miss** — quota-exceeded and permission-revoked
  both throw on read.
- **Concurrent misses for one tile make one downstream call.** The inner
  source's own dedup only helps if the inner source has one; a `FixtureSource`
  or a future PMTiles source may not.
  - Via [`InFlightRequests`](./in-flight-requests.ts.md), so joined callers do
    not share an `AbortSignal`. The inner source therefore receives an internal
    signal rather than the caller's — the tests assert cancellation still
    reaches it, and that one caller's abort leaves the other's tile alone.
- **Eviction is never automatic.** Only the host app knows its storage budget
  and which areas the user cares about, so the library exposes
  `listCachedTiles`/`evictTile` and nothing more.

## Tests

`caching-source.test.ts` — the cache key (including the 25-request walking-user
regression and both schema-version guards), cache-first behaviour, staleness
policy, the rate-limit fallback and its two negative cases, five corrupt-entry
shapes plus a throwing store, eviction, and decorator transparency.
