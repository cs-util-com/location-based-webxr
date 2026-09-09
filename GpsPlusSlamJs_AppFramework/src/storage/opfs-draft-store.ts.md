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
- `createDraftFileStore(directory, parent?, ownName?) -> DraftFileStore` -
  the store over an already-resolved handle. Exported so tests pass a fake
  and stay in node, as the OSM tile store's do.
- `DraftFileStore`: `put(key, data) -> Promise<boolean>`, `getText(key)`,
  `getBlob(key)`, `keys()`, `clear()`.
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
- `clear()` removes the whole directory when the store owns one, and falls
  back to file-by-file otherwise - one call rather than one per placement.

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
files, and both `clear()` paths.
