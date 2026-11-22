# asset-shelf-slice.ts

**Purpose:** the asset shelf's plain data (`assetShelf`) and the selector the shelf's panel reads. Editor-only: the editor mounts it as a page slice (`EDITOR_SESSION_SLICES` in `editor/editor-session.ts`, passed to `createTourViewerStore` by `edit-main.ts`); no other page's store carries it.

## Public API

- `ShelfEntry`: `ShelfJob` plus `{ id, kind, name, origin: "added" | "opened", originalBytes, optimizedBytes?, originalHeld, seq, madeFrom? }` (`madeFrom { from, notes }`: a converted model's source file and what the conversion left out, this session only).
- `ShelfImport`: a model being converted (`model-import-runner.ts`): `{ id, name, format: "gltf" | "zip", status: "queued" | "converting" | "failed", progress, reason?, retryable, bytes, seq }`, in `AssetShelfState.imports`, sharing `nextSeq` with the entries.
- `initialAssetShelfState`, `assetShelfReducer`, `assetShelfActions`:
  - `cleared` (a new open), `entryAdded` (queued, idle, or kept with `keptReason`, retryable with `keptRetryable`; a second add of an id is no change), `entryRemoved`, `entryRestored` (an undo; never busy with a re-make, which the removal stopped), `optimizedRestored` (a smaller file a reload put back, with an optional `detail`);
  - imports: `importQueued` (a second queue of an id is no change), `importStarted` (only from queued), `importProgress` (only while converting, clamped to 0..1), `importFailed { reason, retryable }`, `importRetried` (only from failed: waiting again, its words gone), `importRemoved` (delivered or removed), and `madeFromSet { id, from, notes }` on the delivered entry. An import never adds an entry: only the runner's delivery does, through `entryAdded`.
  - job transitions by id: `jobQueued`, `jobStarted`, `jobProgress`, `jobOptimized { optimizedBytes, originalHeld }`, `jobKept`, `jobFailed`, `jobRetried`, `originalUsed` (drops `optimizedBytes`, `originalHeld` and the detail). `jobOptimized` takes an optional `detail` (`ShelfDetail`: the author's `share` or null, the level's `triangles` of `trianglesBefore`, its `deviation` as a share of the model's box diagonal `size`, and the measured `choices`). The slider's request: `detailAsked` (an optimized entry with a detail; marks it busy), `detailApplied { optimizedBytes, detail }` and `detailSettled` (both only while busy). An id the shelf does not hold is no change.
- `shelfDetailOf(value)`: a stored detail checked field by field (a share of null or 0..1, whole triangle counts, finite non-negative numbers, each choice the same) and copied; undefined when any field is off. The draft reads a detail back through it.
- `selectShelfRows({ assetShelf, tourDocument })`: `ShelfRow[]` in arrival order, each `{ id, kind, name, origin, status, progress, reason?, retryable, originalBytes, optimizedBytes?, estimatedBytes, queuePosition, placesInUse, swaps, canUseOriginal, posterId?, seconds?, detail? }; `posterId`and`seconds`are a video's minted poster and length, as`entryAdded`'s `look` (`ShelfVideoLook`) gave them`. Memoized on both slices. A declared character's files (his figure, his pose sheet; the first character naming a file holds it) fold into ONE row at his first file's place: id his first file's, name his name, the sizes summed, the job of a file still waiting or running else the first's, `canUseOriginal` false, `character: { id, files: [{ id, name, bytes }] }`.
- Import rows stand among the file rows by arrival (`seq`): `kind` model, `origin` added, `status` queued, running (converting) or failed, `originalBytes` and `estimatedBytes` the files' bytes, `queuePosition` among the waiting imports, no places, no swaps, `canUseOriginal` false, and `import: { format }`, which tells the panel to offer only Retry and Remove. A delivered entry's row carries its `madeFrom`.
- `shelfRowUses(root, id)`: the uses a row's places come from: a character's files together (`characterFileUses`), else the file's own.

## Invariants

- Blobs are never state; the runner keeps them (`editor/asset-shelf/asset-shelf.ts`). Commands live on the runner.
- `placesInUse`: the places `fileUsesAll` (`tour-document.ts`) finds for the id (objects, story blocks, station cards, characters, the cover), counted by `fileUseCount`, since no page module reads `tour-content.ts` itself. A character's row counts where his files are used, never his own declaration.
- `swaps`: the document's `assetSwaps[id]`; a preview built from the old bytes reloads when it changes.
- A row's `detail` shows only while the entry is optimized, with `adjustable` (the same as `canUseOriginal`: a re-make needs the original) and `busy`.
- `canUseOriginal` is DERIVED, never a stored flag: the entry is optimized, the runner holds the original, and the asset's bytes are not the written file's yet (`assetBytesPending` in `tour-document.ts`: another path, or a swap no save wrote). Once a save that wrote the smaller file landed, the original is no longer offered (the same rule the draft uses for a landed save).

## Tests

`asset-shelf-slice.test.ts`: phases and queue positions, idle opened entries, kept without an optimizer, places and swaps, the derived "use the original", remove, restore and clear, unknown ids; a character's files folding into one row, counting items and not his declaration, unfolding after his removal. `asset-shelf-imports.test.ts`: an import's row through waiting, converting, failed and Retry, its place among the files, removal, `madeFrom`, unknown ids and a repeated queue, and a property that rows stay in arrival order and no import adds an entry.
