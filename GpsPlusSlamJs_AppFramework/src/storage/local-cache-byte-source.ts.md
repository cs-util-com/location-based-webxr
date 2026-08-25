# local-cache-byte-source.ts

## Purpose

The local half of range-based archive streaming: a persistent full copy that
on-demand reads switch to once a background warm-download completes.
`LocalCacheByteSource` serves ranges by slicing a held `Blob` (lazy, no heap
blow-up). `LocalCacheStore` abstracts _where_ the complete copy lives.

## Public API

- `class LocalCacheByteSource implements ByteSource` — `constructor(blob: Blob)`.
- `interface CachedArchive { blob: Blob; validators?: ArchiveValidators }` —
  the copy plus the freshness validators it was stored with (see
  `range-probe.ts`); `CacheApiStore` rides them as headers on the stored
  Response.
- `interface LocalCacheStore { get(url): Promise<CachedArchive | undefined>; put(url, entry: CachedArchive): Promise<void>; delete(url): Promise<void> }`
- `class InMemoryLocalCacheStore implements LocalCacheStore` — Node/test backing.
- `class CacheApiStore implements LocalCacheStore` — browser backing (Cache API).
- `requestPersistentStorage(): Promise<boolean>` — best-effort
  `navigator.storage.persist()`, false when absent/denied. Explicit and
  separate from `put` on purpose: in Firefox it can raise a permission
  prompt, so a caller chooses the one deliberate moment (e.g. warm-download
  start).

## Invariants & assumptions

- `CacheApiStore.put` never calls `navigator.storage.persist()` (D6):
  eviction protection is the caller's explicit move via
  `requestPersistentStorage()`, so no permission prompt can fire mid-flow on
  a cache write.
- `LocalCacheByteSource.read` resolves zero/negative-length reads empty —
  the uniform `ByteSource` invariant (a remote source would otherwise emit an
  invalid Range header).
- Callers own cache-poisoning recovery (e.g. re-parsing a cached copy before
  trusting it, and calling `delete` on failure) — this module only stores and
  retrieves bytes.

## Why this does not merge with the OSM tile cache

`GpsPlusSlamJs_Osm`'s `caching-tile-fetch` also caches bytes behind a fetch
seam, but it is a whole-response wrapper over small tiles in a string/base64
blob store — request-in/response-out, no random access. This module serves
**ranges** out of one large Blob and must slice lazily without materializing
the archive. Same instinct, different access pattern; merging them would give
the tile path Blob machinery it does not want and this path a base64 detour
it cannot afford.

## Examples

```ts
const store =
  typeof caches !== 'undefined'
    ? new CacheApiStore()
    : new InMemoryLocalCacheStore();
const cached = await store.get(url);
if (cached) return new LocalCacheByteSource(cached);
```

## Tests

`local-cache-byte-source.test.ts` — Blob-slice reads incl. the zero-length
short-circuit, the in-memory store round-trip, `CacheApiStore` against
stubbed `caches`/`navigator` globals (put stays prompt-free), and
`requestPersistentStorage`'s grant/absent paths. Real Cache API behavior is
proven by the TourViewer e2e suite.
