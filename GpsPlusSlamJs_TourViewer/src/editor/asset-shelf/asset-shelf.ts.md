# asset-shelf.ts

**Purpose:** the asset shelf's runner for one open tour: the queue of optimization jobs and the commands the shelf's panel calls.

## Public API

- `createAssetShelf(deps)`; `deps`: `store` (holding `assetShelf` and `tourDocument`), `optimizers` (`OptimizerTable`), `host`, `settings?`, `slots?` (default a phone's 1), `bytesOf(id)`, `recordOf(id)`, `swap(id, { blob, path, width?, height?, detail? })` (the session's `swapAsset`; `detail` is a made model's level, which the draft keeps with the smaller file so a reload offers the slider again), `maxFileBytes?` (default the archive's entry cap).
- `AssetShelf`:
  - `add(asset, name, bytes, origin, look?)`: `look` is a video's minted poster id and length, kept on its entry. A file brought in is queued (kept with `NO_OPTIMIZER` when its kind has no row); an opened tour's file waits idle.
  - `retry(id)`; `useOriginal(id)` (swaps the original back, telling the session it was the creator's choice (`originalChosen`); false when not offered or refused. A re-make running for the file is stopped first, and a swap it already started is waited for, so the original always lands last; no re-make starts while it goes back); `originalKept(asset, name, bytes)` (a file brought in for which the creator chose the original before a reload: kept with the original-used words, retryable, never queued); `restored(asset, name, sizes, original?, detail?)` (a smaller file a reload put back from the draft: optimized, its original held when `original` loads, and a made model's `detail` as the draft kept it, so the slider is offered again without running the optimizer); `addAsMade(asset, name, bytes, origin)` (a file kept as made, a character's picture: kept with `CHARACTER_KEPT`, not retryable, never queued); `holdsOriginal(id)` (whether its original is held for "use the original"); `setDetail(id, share)` (re-makes a made model from its held original at `share` of its triangles, 0..1, or at the default level for null: the optimizer runs with the model settings' `detailShare`, the result is swapped in at the same path and the row's detail follows; resolves `{ kind: "applied" }`, or `{ kind: "refused", reason }` when the share is out of range, the row has no adjustable detail, one is already running, the model import converts a model (`DETAIL_WAITS_FOR_IMPORT`: no model is made meanwhile, and nothing starts), the optimizer fails or keeps the file, the result is no smaller than the original (`DETAIL_NOT_SMALLER`, the tour's file kept) or over the cap, or the swap is refused; `{ kind: "stopped" }` when the author's own later act ended it ("use the original", a delete, closing), which the panel does not toast; it takes a slot like a job and is busy in the store until settled); `remove(id)` (stops its job; returns an undo that puts it back, queued again when it was waiting or running; null for an unknown id); `optimizeTour()` (queues every idle opened file whose kind has a row; returns how many); `close()`.
- Words: `NO_OPTIMIZER`, `NOT_SMALLER`, `RESULT_TOO_LARGE`.

## Invariants

- First in, first out by arrival (`seq`), at most `slots` jobs at once; each end starts the next. No model starts while the model import converts one (an import row `converting` in the slice; `model-import-runner.ts` waits the same way for a model being optimized), so a phone never holds two large models; other kinds still run, and the end of the conversion starts the waiting model.
- A result is judged here, not by the optimizer:
  - "over the cap" means over the entry cap in bytes OR over `TOUR_MAX_IMAGE_PIXELS` (width x height, one known side counted as a square of it, neither side meaning no picture; a result that declares no size keeps the original's): the two caps a save refuses, so a file over either would block every save;
  - a result over the cap, or a "kept", for an original over the cap: failed, NOT retryable, with words telling the author to use a smaller file or remove it;
  - a result over the cap for an original that fits: kept with `RESULT_TOO_LARGE` - the original stays, nothing failed, and the words name the real reason (the result was too large, not too little smaller);
  - not at least 10 % smaller (`settings.keepAbove`): kept with `NOT_SMALLER` (an over-cap original is exempt, any fitting result is taken);
  - otherwise the session's swap to `content/<id>.<extension>`; a refusal fails, retryable, with its words.
- A job's late end (after `remove`, after `close`) changes nothing: every await is followed by an ownership check.
- A crash (`OptimizerCrashed`, from the Worker's error event or the client's silence watchdog) is passed to the state machine as `crashed`, which queues the job again while attempts remain; then the job fails with its words and Retry, so a Worker that died without a word never leaves a card running. A crash, and so a silence kill, rejects every run the Worker held, so every job running beside the silent one is charged an attempt too: with two attempts, a second kill while they run again fails them all (Retry brings them back).
- The original's record and a loader of its bytes are kept in memory for "use the original"; the row offers it only while the written file does not hold the smaller file's bytes (`selectShelfRows`). The runner subscribes to the store and frees an original (`originalFreed`) as soon as its row stops offering it; a removed card keeps its original with it, so the removal's undo and the page's Undo of a delete (the document naming the file again) both bring the card back with "use the original" still offered. Nothing uses a removed card's file, so no save writes it and its smaller file never "lands": the bound is the next landed save (the document's `written` changes), after which the original is let go and a later undo brings the card back without it. A delete nobody takes back therefore holds the bytes until the next landed save, never until the tour closes. A reload before that save loses nothing: the draft keeps the file and its original (only a save that writes the file spends them, and none writes a file nothing uses), and the reload puts the card back made smaller, its original offered (`editor-session-overcap.test.ts`). The same holds after that save, so a reload offers again an original the shelf had let go: the draft is the durable copy, the shelf only bounds what it holds in memory.
- A save never waits for a job: it writes the original until the swap.
- The keep rule: a file a character declaration names (his figure or his
  pose sheet, `CHARACTER_KEPT`) is never optimized - kept with those
  words at `add`, checked again before a queued job runs and again
  before its swap lands (a character may be declared while it runs).
  Which files a character names is read from the document's one walk
  of a file's uses (`fileUsesOf`), never a list of its own.
- The shelf keeps every file the tour uses: a removed card's entry is
  remembered, and when the document uses its file again
  (`fileUseCount` above 0: an item, a station card, a character or the
  tour's cover; the page's Undo of a delete, a redo, the file used
  again) the card comes back
  (`entryRestored`), queued again when it was waiting or running. Its
  original is not held again. A second `add` of a card already there
  changes nothing.

## Not here yet

- The shelf's panel.

## Tests

`asset-shelf.test.ts` with `test-support/fake-optimizer.ts`: order and slots, no model started while a model converts (a picture still runs), progress, the swap, the 10 % rule, refused swaps and retry, crash retry, a Worker that never answers (through the real client, fake timers) failing its card after the watchdog, over-cap failures (a half-known picture size too), no optimizer, use the original, optimize this tour, remove with undo, close, unreadable bytes; the keep
rule at add, before a run and before a swap (a fake optimizer); a card
put back when the document names its file again; a file kept as made.
`asset-shelf-detail.test.ts`: a made model's detail and when it is adjustable, none without levels, a re-make from the original at a share (busy, a second request refused, the swap), back to the default, the tour's file kept when the result is no smaller, failed, kept or refused at the swap, no offer once the original is let go or for a share out of range, the detail dropped by "use the original", the level handed to the swap for the draft to keep, and the slider offered again for a made model a reload put back.
