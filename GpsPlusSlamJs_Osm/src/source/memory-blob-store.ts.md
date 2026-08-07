# `source/memory-blob-store.ts`

## Purpose

In-memory `OsmBlobStore` for tests and for consumers that do not want
persistence.

## Public API

- `MemoryBlobStore` implementing `OsmBlobStore`.
- `stats` — `{ gets, puts, deletes }`, so tests can assert cache behaviour
  precisely rather than inferring it.
- `size` — entry count. A test helper, deliberately **not** part of
  `OsmBlobStore`.

## Invariants & assumptions

- Everything resolves synchronously via `Promise.resolve`. That makes tests fast
  and deterministic, but means it will not surface ordering bugs that a real
  async store would — the caching tests therefore also exercise the
  concurrent-miss path explicitly rather than relying on this store's timing.
- Values are stored as given. No serialisation, no cloning: `CachingSource`
  already stringifies, and double-encoding here would hide bugs in that.

## Tests

Used throughout `caching-source.test.ts` and `fixture-source.test.ts`.
