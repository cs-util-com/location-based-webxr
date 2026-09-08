# bounded-local-cache-store.ts

## Purpose

An LRU bound around any `LocalCacheStore`, so persist()-pinned archives
(tens of megabytes each) cannot grow without limit. Also carries the enumeration a
"clear cache" action needs, which the base interface deliberately lacks.

## Public API

- `class BoundedLocalCacheStore implements LocalCacheStore`
  - `constructor(inner: LocalCacheStore, maxEntries: number)` — throws
    `TypeError` unless `maxEntries` is a positive integer.
  - `get/put/delete` — the `LocalCacheStore` contract, recency-tracked.
  - `size(): Promise<number>` — the index length at the time of the call: a
    snapshot, not a bound in either direction (an entry whose blob is
    already gone still counts; a warm download completing after the call
    adds one the caller did not see).
  - `clear(): Promise<number>` — the count is what the call itself
    removed, so a UI reporting "cleared N" while a session holds an entry
    open reads `size()` first and ignores this (PR #434 review); evicts every archive this bound knows
    about; resolves how many index entries it removed. A caller that reports
    "cleared N" around an open session must read `size()` BEFORE the
    session's `evict()`, which drops that copy from the index (Tour Viewer
    flows plan M2).

## Invariants & assumptions

- Recency is ORDER-based via a small JSON index entry (reserved key
  `/__archive-cache-index__`) updated on every get/put — deliberately not
  timestamp-based (`Date.now()` adds nothing an order cannot express).
- A `get` counts as use: a frequently-read archive survives evictions driven
  by one-off opens.
- All operations run through one internal queue — interleaved index
  read-modify-writes would lose updates.
- An unreadable/corrupt index reads as empty rather than throwing; entries it
  no longer lists are unreachable through this wrapper (the backing store may
  still hold them until a future put at the same URL overwrites).

## Examples

```ts
const store = new BoundedLocalCacheStore(new CacheApiStore(), 5);
await store.put(url, { blob, validators });
await store.clear(); // the demo's "clear cache" button
```

## Tests

`bounded-local-cache-store.test.ts` — constructor validation, round-trip,
LRU eviction incl. get-counts-as-use, delete/clear reaching the backing
store, and interleaved-put serialization.
