# asset-shelf.ts

**Purpose:** the asset shelf's runner for one open tour: the queue of optimization jobs and the commands the shelf's panel calls.

## Public API

- `createAssetShelf(deps)`; `deps`: `store` (holding `assetShelf` and `tourDocument`), `optimizers` (`OptimizerTable`), `host`, `settings?`, `slots?` (default a phone's 1), `bytesOf(id)`, `recordOf(id)`, `swap(id, { blob, path, width?, height? })` (the session's `swapAsset`), `maxFileBytes?` (default the archive's entry cap).
- `AssetShelf`:
  - `add(asset, name, bytes, origin)`: a file brought in is queued (kept with `NO_OPTIMIZER` when its kind has no row); an opened tour's file waits idle.
  - `retry(id)`; `useOriginal(id)` (swaps the original back; false when not offered or refused); `remove(id)` (stops its job; returns an undo that puts it back, queued again when it was waiting or running; null for an unknown id); `optimizeTour()` (queues every idle opened file whose kind has a row; returns how many); `close()`.
- Words: `NO_OPTIMIZER`, `NOT_SMALLER`.

## Invariants

- First in, first out by arrival (`seq`), at most `slots` jobs at once; each end starts the next.
- A result is judged here, not by the optimizer:
  - over the entry cap, or a "kept" for an original over the cap: failed, NOT retryable, with words telling the author to use a smaller file or remove it;
  - not at least 10 % smaller (`settings.keepAbove`): kept with `NOT_SMALLER` (an over-cap original is exempt, any fitting result is taken);
  - otherwise the session's swap to `content/<id>.<extension>`; a refusal fails, retryable, with its words.
- A job's late end (after `remove`, after `close`) changes nothing: every await is followed by an ownership check.
- A crash (`OptimizerCrashed`) is passed to the state machine as `crashed`, which queues the job again while attempts remain.
- The original's record and a loader of its bytes are kept in memory for "use the original"; the row offers it only while the written file does not hold the smaller file's bytes (`selectShelfRows`). The runner subscribes to the store and frees an original (`originalFreed`) as soon as its row stops offering it; one whose row left the shelf (a removal with undo) is kept until the shelf closes.
- A save never waits for a job: it writes the original until the swap.

## Not here yet

- Real optimizers: every row of `ASSET_OPTIMIZERS` is null in this build.
- The shelf's panel.

## Tests

`asset-shelf.test.ts` with `test-support/fake-optimizer.ts`: order and slots, progress, the swap, the 10 % rule, refused swaps and retry, crash retry, over-cap failures, no optimizer, use the original, optimize this tour, remove with undo, close, unreadable bytes.
