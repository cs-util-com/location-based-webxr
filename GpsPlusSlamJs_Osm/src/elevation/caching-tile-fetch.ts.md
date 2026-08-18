# `elevation/caching-tile-fetch.ts`

## Purpose

A `fetch`-compatible wrapper that persists successfully fetched GET-tile bytes
in an injected blob store and replays them thereafter — so elevation survives
an offline restart.

## Public API

- `createCachingTileFetch({ store, fetchImpl? }): CachingTileFetch` — returns a
  `typeof fetch`-compatible function with a `stats` property.
- `CachingTileFetchOptions` — `store: OsmBlobStore` (the package's one
  persistence seam, reused rather than redefined), `fetchImpl?: typeof fetch`
  (defaults to the global `fetch`).
- `CachingTileFetchStats` — `{ hits, misses, storeFailures }`, live counters on
  the returned function.

## Composition

```ts
const provider = new TerrariumProvider({
  decodePng: browserPngDecoder(),
  fetchImpl: createCachingTileFetch({ store }),
});
```

The provider's `fetchImpl` option is the seam. Caching here rather than in the
provider needs no new provider API, works for any URL template (AWS Terrarium,
Mapterhorn, a self-hosted mirror), and stores the ENCODED tile — a PNG/WebP is
a fraction of the decoded `Float32Array`'s size, and decode-on-hit is the
provider's existing job.

## Invariants & assumptions

- **Motivation: the offline cold start.** `TerrariumProvider`'s only cache is a
  64-tile in-memory Map, so without this wrapper a restart with no network has
  no terrain — and the AR failure mode is a silently wrong flat datum, not an
  error.
- **Cache invalidation is deliberately none (v1).** Terrain tiles are
  effectively static — the underlying DEMs change on a timescale of years, and
  a stale hill is still the hill. The store's own eviction policy is the bound;
  the wrapper never expires, revalidates, or evicts.
- **Key = the full request URL string**, however the caller spelled it
  (string, `URL`, or `Request` all key identically). URL-shaped keys cannot
  collide with the OSM cache's `osm/v{n}/…` keys in a shared store.
- **Hits are synthetic 200s marked `x-tile-cache: hit`**, carrying only the
  stored bytes — original network headers are not persisted. Consumers decode
  by content sniffing, not by header, so nothing downstream reads them.
- **The caller's body is never consumed.** The persisted copy is snapshotted
  from `response.clone()`; the returned response's body is readable in full.
- **Only a 200 is persisted.** Non-200s and network errors pass through
  untouched and store nothing — caching a transient 404 in a store that never
  invalidates would poison that URL forever.
- **A failed store WRITE must not lose the paid-for tile** (the same bug was
  fixed once for OSM tiles in `source/caching-source.ts`): the response is
  returned anyway and `storeFailures` is incremented. A storage problem must
  never become a data problem.
- **A failed store READ degrades to a network fetch**, and a corrupt stored
  entry (not valid base64) is a miss, never a throw and never served.
- **Non-GET requests bypass the cache entirely** — the wrapper is
  fetch-compatible, and serving a POST's answer from a byte cache would be
  wrong in every way.
- **A pre-aborted signal rejects with `AbortError` even on a hit** — the
  synthetic path must not be more alive than the network it stands in for.
- **Bytes are stored as base64** (`btoa`/`atob`, chunked), because
  `OsmBlobStore` is string-valued; the ~33% overhead is accepted to reuse the
  existing seam unchanged. Works in window, Worker and Node — nothing touches
  `window`.
- **No in-flight dedup here**: `TerrariumProvider` already dedups concurrent
  requests per tile above this seam.

## Tests

`caching-tile-fetch.test.ts` — hit without network (across a wrapper restart),
the hit marker header, miss persist-and-replay with the body readable in full,
string/`URL`/`Request` keying, 404 and network-error pass-through, failing
store write/read, corrupt entry, non-GET bypass, pre-aborted signal.
`caching-tile-fetch.property.test.ts` — for any interleaving of hit/miss over
random URL sequences: every returned body equals the canonical bytes for its
URL, and the network is called exactly once per distinct URL.
