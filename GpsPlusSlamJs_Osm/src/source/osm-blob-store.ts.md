# `source/osm-blob-store.ts`

## Purpose

The persistence seam: a minimal string-keyed blob store, injected by the
consumer.

## Public API

`OsmBlobStore` — `get(key)`, `put(key, value)`, `delete(key)`, `keys()`, all
promise-returning.

## Invariants & assumptions

- **Injected, never imported.** This package runs in Node (tests, the
  investigation harness), on a browser main thread, and inside a Web Worker;
  none of those share a storage API. The consumer supplies OPFS- or
  IndexedDB-backed storage, tests supply `MemoryBlobStore`.
- **Known limitation, accepted deliberately:** a blob shape has no indexes, no
  cursors, no partial reads and no transactional multi-store writes. "Every
  feature tagged X across all cached tiles" means loading and parsing whole
  tiles. That is fine for this package's access patterns, which are always
  "the tiles around the user" — and if it stops being fine, a consumer can back
  the interface with IndexedDB without this package changing.
- **Implementations may throw and callers must survive it.** Quota-exceeded and
  permission-revoked both throw on read; `CachingSource` treats a throwing store
  as a cache miss.

## Tests

`caching-source.test.ts` covers the throwing-store path and the corrupt-entry
paths through `MemoryBlobStore` plus spies.
