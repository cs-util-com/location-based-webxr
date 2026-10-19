# tour-document-save.ts

## Purpose

The tour document's save (the follow-up of D30, root rule "App state lives
in the Redux store"): a page's Save of the open tour as thunks against the
store. The snapshot is the document's, the file is rebuilt by the Finish's
rules (`finish-rebuild.ts`) from the newest bytes, and what it wrote lands
in the document (`saved`). The slice's save status (`tour-document.ts`,
`save.rebuilds` / `save.status` / `save.error`) is the one place that says
a save runs, landed or failed; an undo waits for it (`canStep`).

The desktop editor saves through it (`editor/editor-session.ts`). The
phone's Finish does not yet: see "Not here yet" below.

## Public API

- `createTourSaves({ tour, generation, pictureOf, picturesRead }): TourSaves`
  - one handle per open; it keeps the imperative resources only - the
    newest bytes (a Blob), the photo spots' decision, the queue's tail.
  - `tour` - the open `TourSession` (the rebuild's and the bake's reads,
    the file's name).
  - `generation` - the open the saves belong to
    (`TourDocumentState.generation`).
  - `pictureOf(id)` - a photo's picture the page keeps (an undo brought
    the photo back after a save took it out of the file); a snapshot
    carries it for a photo the written file has no picture for.
  - `picturesRead()` - settles once the pictures being read are read: the
    photo spots wait for it, so a picture is read before a rebuild
    replaces the bytes it may be read from.
- `TourSaves`
  - `fileName` - the name every save of this open is written under
    (`finishedFileName`: the opened file's, made safe).
  - `newest()` - the newest bytes this open's saves wrote; null before
    one landed (a rebuild then reads the opened file, under its budget).
  - `save({ keepScan })` - thunk; resolves with `{ finished, photos }`
    (`TourSaveBuilt`). Queued behind the saves before it; when it starts,
    the snapshot (`TourSaveSnapshot`: the entries with their kept
    pictures, the deletions, `manifestNow`, the frames) is taken before
    any await, then the photo spots, the rebuild, the landing. Rejects
    with `TOUR_REPLACED` when another open replaced this one before it
    started, and with the rebuild's own error; either way the slice says
    it (`saveEnded`'s `error`, status `error`).
  - `queued(start)` - thunk; runs `start` after the saves queued before it
    (at once, inside the dispatch, when none of this open runs), counted
    by the document: `saveStarted` at the call, `saveEnded` (with the
    error message on a failure) BEFORE the caller hears the end, so an
    undo asked for right after an awaited save is not refused. The
    desktop's move of the walk out runs in the same queue.
  - `snapshot()` - thunk; the document as a save reads it now.
  - `photoSpots(manifest)` - the recorded photos' spots
    (`captureSpotsForRebuild`), decided once per open (a decline is not
    re-baked on every save), after `picturesRead()`.
  - `rebuild(snap, photos, keepScan, whole?)` - `rebuildFinishedTour`
    from the newest bytes, or from `whole` (the opened file as the caller
    already read it, so it is not read twice); `levels: []`. Throws what
    the rebuild throws, and "the save was stopped" for a stopped one.
  - `land(finished, snap)` - thunk; `finished` becomes the newest bytes
    and the document's written file (`saved` with the snapshot's
    deletions and frames; nowhere for a tour opened since).
- `dispatchThunk(store, thunk)` - dispatches a document thunk into the
  store, through its middleware. The framework's store runs Redux
  Toolkit's default middleware (the thunk middleware among it) but its
  type names only plain actions; this is the one cast that says
  otherwise. A store without the middleware refuses the function (Redux:
  "Actions must be plain objects").
- `TOUR_REPLACED` - "Another tour was opened since: this one is no longer
  open here." (also the desktop's refusal of a move of the walk).
- Types: `TourSaveBuilt` (the module-private `TourDocumentThunk<R>`,
  `TourSaveSnapshot` and `TourSaves` are read through the handle).

## Invariants & assumptions

- **The status is the slice's.** The handle keeps no flag of its own: the
  queue's "a save of this open runs" is the slice's `save.rebuilds` for
  this generation.
- **The snapshot is taken before the first await**: an edit made from then
  on stays pending for the next save (`pendingAfterRebuild`, by content).
- **Saves run one after another**; the second starts from the first one's
  bytes (`newest()`), so a deleted photo's file stays gone.
- A save of an open another replaced, begun before, keeps its own
  snapshot and lands nowhere (`saved` checks the generation); one asked
  for after builds nothing (`TOUR_REPLACED`).
- Blobs are never state: the newest bytes and the pictures stay outside
  the store.

## Not here yet: the phone's Finish

`creator-finish.ts` still calls the rebuild itself (its TEMPORARY entry in
`config/.dependency-cruiser.cjs`), and its save status stays in the
session object (the named deviation MEDIUM-1, `creator-finish.ts.md`).
Moving it onto this thunk would change the phone's behaviour, which a
refactor must not: its Finish snapshots the entries AFTER the photo bake
(here, before the first await), it ends the document's save
(`saveEnded`) only after the AR session's end and the wizard's step (so
an undo stays refused through them), and it rebuilds with the code
levels, a progress line and a stop check this handle does not take.

## Examples

```ts
const saves = createTourSaves({
  tour: session,
  generation: selectTourDocument(store.getState()).generation,
  pictureOf: (id) => pictures.get(id),
  picturesRead: () => Promise.all(pictureReads),
});
const { finished, photos } = await dispatchThunk(
  store,
  saves.save({ keepScan: false }),
);
```

## Tests

`tour-document-save.test.ts` on real zips: a save that lands (saving while
it runs, then the written file, nothing pending, idle), one that fails
(the reason in the slice, nothing written, the edit still pending), a save
asked for while another runs (it waits; the edit made between them is the
second's, which starts from the first's bytes), an undo asked for while a
save runs (refused, then taken once it ended), and a save of a replaced
open (one begun before lands nowhere, one asked for after rejects). The
desktop's whole save and walk move are covered through the session
(`editor/editor-session.test.ts`), and both pages' writes by the parity
contract (`tour-document-parity.test.ts`).
