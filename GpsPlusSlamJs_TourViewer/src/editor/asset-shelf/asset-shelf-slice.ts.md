# asset-shelf-slice.ts

**Purpose:** the asset shelf's plain data (`assetShelf`) and the selector the shelf's panel reads. Editor-only: the editor mounts it as a page slice (`EDITOR_SESSION_SLICES` in `editor/editor-session.ts`, passed to `createTourViewerStore` by `edit-main.ts`); no other page's store carries it.

## Public API

- `ShelfEntry`: `ShelfJob` plus `{ id, kind, name, origin: "added" | "opened", originalBytes, optimizedBytes?, originalHeld, seq }`.
- `initialAssetShelfState`, `assetShelfReducer`, `assetShelfActions`:
  - `cleared` (a new open), `entryAdded` (queued, idle, or kept with `keptReason`; a second add of an id is no change), `entryRemoved`, `entryRestored` (an undo);
  - job transitions by id: `jobQueued`, `jobStarted`, `jobProgress`, `jobOptimized { optimizedBytes, originalHeld }`, `jobKept`, `jobFailed`, `jobRetried`, `originalUsed` (drops `optimizedBytes`, clears `originalHeld`). An id the shelf does not hold is no change.
- `selectShelfRows({ assetShelf, tourDocument })`: `ShelfRow[]` in arrival order, each `{ id, kind, name, origin, status, progress, reason?, retryable, originalBytes, optimizedBytes?, estimatedBytes, queuePosition, placesInUse, swaps, canUseOriginal }`. Memoized on both slices.

## Invariants

- Blobs are never state; the runner keeps them (`editor/asset-shelf/asset-shelf.ts`). Commands live on the runner.
- `placesInUse`: the document's objects and story blocks that name the id, plus station steps and station pictures, counted by `assetUsesOf` (`tour-document.ts`), since no page module reads `tour-content.ts` itself.
- `swaps`: the document's `assetSwaps[id]`; a preview built from the old bytes reloads when it changes.
- `canUseOriginal` is DERIVED, never a stored flag: the entry is optimized, the runner holds the original, and the written file does not yet list the asset at its current path. Once a save that wrote the smaller file landed, the original is no longer offered (the same rule the draft uses for a landed save).

## Tests

`asset-shelf-slice.test.ts`: phases and queue positions, idle opened entries, kept without an optimizer, places and swaps, the derived "use the original", remove, restore and clear, unknown ids.
