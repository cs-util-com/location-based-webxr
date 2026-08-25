# open-remote-archive.ts

## Purpose

The conductor of range-based archive streaming: `openRemoteArchive(url, opts)`
runs normalize → cache lookup (revalidated) → probe → fallback decision →
byte-source construction, plus the background warm-download that swaps a
ranged session onto a local copy mid-flight. The one place the open policy
lives — consumers never hand-roll the dance from the building blocks. It is
archive-format-agnostic; zip.js enters only where a caller wraps
`opened.source` in a `ByteSourceReader`.

## Public API

- `openRemoteArchive(rawUrl, options?): Promise<OpenedArchive>`
- `interface OpenRemoteArchiveOptions { fetchImpl?; cacheStore?; googleDriveApiKey?; onRead?; warm?; skipCache? }`
- `interface OpenedArchive { source; size; url; origin; warmed; dispose(); evict() }`
- `class OpenRemoteArchiveError extends Error { rejectCause: RangeProbeRejectCause }`
- `type ArchiveReadOrigin = 'network' | 'cache'`,
  `interface ArchiveReadEvent { origin; offset; length }`

## Invariants & assumptions

- **Cache freshness:** a cached copy is revalidated with one HEAD — ETag when
  readable, else the CORS-safelisted Last-Modified, else a size comparison. A
  differing readable signal evicts and reopens remote (the authoring loop
  overwrites archives at a stable URL, so staleness is a real, common case).
  An unreachable HEAD serves the cache: availability over freshness.
- **Warm safety:** the warm download persists only when its
  `SwitchableByteSource.switchTo` returned true — a refused swap means the
  bytes mismatch the session's size and caching them would poison every later
  visit. `requestPersistentStorage()` is called once, at warm start (D6).
- **`dispose()`** aborts the in-flight warm fetch; `warmed` then resolves
  false and the session simply stays remote.
- **Poisoned-cache recovery is the caller's loop:** a cached copy that fails
  to parse → `evict()` → reopen with `skipCache: true`.
- A `fetch`-level rejection maps to rejectCause `'cors'` — in a browser a
  CORS block and a dead network are indistinguishable (both `TypeError`), and
  either way the link is unusable from here.
- `onRead` fires per read served through the returned source with the true
  origin (`network` before the swap, `cache` after) — the seam TourViewer's
  live counters hang on.

## Examples

```ts
const opened = await openRemoteArchive(pastedUrl, {
  cacheStore: new BoundedLocalCacheStore(new CacheApiStore(), 5),
  onRead: (e) => stats.record(e),
});
const reader = new ZipReader(new ByteSourceReader(opened.source));
try {
  const entries = await reader.getEntries();
} catch (err) {
  if (opened.origin === 'cache') {
    await opened.evict(); // poisoned copy — drop it,
    // …reopen with { skipCache: true }
  }
}
```

## Tests

`open-remote-archive.test.ts` — ranged open + instrumentation, share-link
normalization, warm switch/persist, the size-mismatch persist refusal,
dispose-aborts-warm, warm opt-out, fresh/stale/validator-less/offline cache
paths, skipCache + evict, eager-local degrade, and the missing/cors reject
causes. `zip-streaming-request-budget.test.ts` — the measured request/byte
ceilings against a real zip.
