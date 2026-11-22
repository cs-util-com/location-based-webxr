# key-value-db.ts

## Purpose

A string-keyed store in the browser's IndexedDB: one database with one object store, for pages that keep a few values across reloads. The editor's scan memory keeps file handles in it (`editor/scan-memory.ts`), the feature matching check its run plan's photos (`checks/feature-match/feature-match-store.ts`). It lives outside `editor/` so a page other than the editor reaches no editor-only module.

## Public API

- `interface KeyValueStore` - `get`, `put`, `delete` by string key and `keys()`; every call may reject.
- `indexedDbKeyValueStore(factory: IDBFactory | undefined, name, storeName): KeyValueStore | null`
  - database `name` (version 1) with one object store `storeName` (out-of-line keys), created at the upgrade;
  - opened on first use; a failed or blocked open rejects and is tried again at the next call;
  - one transaction per call, resolved at `complete`, rejected at `error` or `abort`;
  - `keys()` is `getAllKeys` as strings;
  - null where the browser has no IndexedDB.

## Invariants and assumptions

- Values go in by structured clone, so a `FileSystemFileHandle`, a `Blob` or typed arrays are stored as they are.
- The adapter never swallows a failure; each caller decides what a rejection means (the scan memory: nothing remembered; the feature match check: a lost photo and a logged error).

## Example

```ts
const db = indexedDbKeyValueStore(indexedDB, "my-db", "items");
await db?.put("a", { n: 1 });
await db?.keys(); // ["a"]
```

## Tests

`editor/scan-memory.test.ts`, `indexedDbHandleStore` - on a small hand-written IndexedDB stand-in: the database and one-time upgrade, one open for many calls, a failed open tried again, a blocked open and a failed transaction rejecting, and a named database listing its keys.
