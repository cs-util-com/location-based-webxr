# local-cache-byte-source.ts

## Purpose

The local half of range-based archive streaming: a persistent full copy that
on-demand reads switch to once a background warm-download completes.
`LocalCacheByteSource` serves ranges by slicing a held `Blob` (lazy, no heap
blow-up). `LocalCacheStore` abstracts *where* the complete copy lives.

## Public API

- `class LocalCacheByteSource implements ByteSource` — `constructor(blob: Blob)`.
- `interface LocalCacheStore { get(url): Promise<Blob | undefined>; put(url, blob): Promise<void>; delete(url): Promise<void> }`
- `class InMemoryLocalCacheStore implements LocalCacheStore` — Node/test backing.
- `class CacheApiStore implements LocalCacheStore` — browser backing (Cache API).

## Invariants & assumptions

- `CacheApiStore.put` calls `navigator.storage?.persist?.()` first so a warmed
  copy is not evicted mid-session; it is a best-effort call (optional
  chaining — absent in older browsers).
- Not exercised by a Node test suite (`caches` is browser-only); proven only
  by driving the real browser Cache API.
- Callers own cache-poisoning recovery (e.g. re-parsing a cached copy before
  trusting it, and calling `delete` on failure) — this module only stores and
  retrieves bytes.

## Examples

```ts
const store = typeof caches !== "undefined" ? new CacheApiStore() : new InMemoryLocalCacheStore();
const cached = await store.get(url);
if (cached) return new LocalCacheByteSource(cached);
```

## Tests

No dedicated unit test — `CacheApiStore` is browser-only and
`InMemoryLocalCacheStore`/`LocalCacheByteSource` are exercised through a
consumer's integration test (e.g. TourBuilder's `cloud-loader` component).
