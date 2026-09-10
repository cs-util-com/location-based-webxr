# opfs-draft-store.ts

## Purpose

A flat, key-addressed file store in one OPFS directory, namespaced per
caller. Built for the Tour Viewer's crash-safe authoring (M5), and shaped
so the recorder can use it when it grows authoring of its own.

## Public API

- `openDraftNamespace(root, namespace) -> Promise<DraftFileStore | undefined>`
  - Creates `drafts/<escaped namespace>/` under `root`.
  - **`undefined` means "no persistence"**, never an error: a browser
    without OPFS, blocked site data, a quota wall. The caller carries on
    with the work in memory.
- `createDraftFileStore(directory) -> DraftFileStore` -
  the store over an already-resolved handle. Exported so tests pass a fake
  and stay in node, as the OSM tile store's do.
- `DraftFileStore`: `put(key, data) -> Promise<boolean>`, `getText(key)`,
  `getBlob(key)`, `keys()`, `remove(key)`, `clear()`.
  - **`remove(key)` is how a caller throws away exactly what it is
    rejecting.** It exists because `clear` forces "delete everything, then
    write back what should have stayed", and the gap between those two is a
    window in which the survivors live only in memory. That shape produced
    four silent data-loss defects in the Tour Viewer's authoring before it
    was replaced. Removing a key that is not there is not a failure.
  - **`clear()` has NO production caller since 2026-09-10.** Both former
    callers delete the ids they read instead. It is kept as working, tested
    API - its tests encode a real OPFS hazard - but nothing depends on its
    ordering guarantee today.
- `DRAFT_STORE_DIR`.

## Invariants & assumptions

- **Nothing throws into the caller.** A draft is a safety net; a store that
  throws turns "your work is also saved" into "your tap failed", which is
  worse than no net. `put` REPORTS whether it persisted - the one signal a
  caller needs to say "persistence is off" once - and every other method
  degrades to `undefined` / `[]` / a no-op.
- **A failed write leaves the previous content intact.** It uses
  `writeFileOrAbort` rather than a hand-rolled `createWritable`/`write`/
  `close`: `close()` is what COMMITS, so closing on a failure path swaps a
  truncated file over a good one - and a draft that reads back corrupt is
  indistinguishable from lost work.
- **Keys are escaped flat, never nested** (`opfs-file-names.ts`), and so is
  the namespace: both come from strings a caller controls.
- **Foreign files are ignored.** `keys()` returns only names that
  round-trip through the escaping, so a directory shared with anything else
  yields no keys that a `get` could not resolve.
- **`clear(firstKey?)` EMPTIES the directory in place, never removes it.**
  Removing it invalidates the handle the store closed over, so every later
  `put` throws, is swallowed and returns `false` - persistence silently off
  for the rest of the session. The cost is an empty directory left behind,
  which the next `openDraftNamespace` for that namespace reuses.
  - The names are collected BEFORE any removal: deleting while iterating
    the directory mutates what the enumerator is walking, and entries
    survive it.
  - `firstKey` is deleted first and on its own, for a caller whose clear is
    fire-and-forget: deleting the file that decides whether a draft EXISTS
    before anything else means a reload racing the clear finds no draft
    rather than the one just discarded. Ordering rather than
    synchronisation, because a reload takes any in-memory guard with it.

## Why not `opfs-storage.ts`

That module is recording-session shaped: sessions, actions, frames, a
metadata schema. A draft needs a namespace and a handful of named files
appended one at a time, which is a different thing wearing the same API.

## Examples

```ts
const root = await navigator.storage.getDirectory();
const store = await openDraftNamespace(root, tourUrl);
if (store !== undefined) await store.put('object:abc', JSON.stringify(pin));
```

## Tests

`opfs-draft-store.test.ts`, against a fake directory handle. The two that
carry the module are the failure ones: a write that fails reports `false`
and leaves the earlier value readable, and a refused `getDirectoryHandle`
yields no store rather than an exception. Plus the round trip for text and
bytes, the traversal case, a missing key, a listing that throws, foreign
files, and `clear()`: that it empties EVERY entry (the fake's enumerator
models a real directory's, where removing during iteration skips the next
name), and that the store still works afterwards.
