# tour-document.ts

**Purpose:** the ONE Redux slice for the tour a creator edits (decisions
D29-D31 of the tour editor plan, and the root rule "App state lives in the
Redux store"): the tour as opened and as last written, the edits not yet
written, the station frames, the tour-level setting and details, an undo
history over the whole document, and the save status. Shared by every
page that edits a tour: the desktop editor (`editor/editor-session.ts`)
today, the phone's creator in a later milestone. Mounted in the Tour
Viewer's store (`createTourViewerStore`, `tour-viewer-session.ts`) as
`tourDocument`; its actions are not written into the phone's recordings.

It lives at the top of `src/` so both pages may import it; the shared pure
rules it composes (`object-edits.ts`, `finish-rebuild.ts`,
`tour-content.ts`, `authoring-draft.ts`, `tour-details-form.ts`) are its
reducers' building blocks, so a page cannot apply them differently.

## State (`TourDocumentState`)

- `generation` - counts the opens; a late answer (a save of a tour closed
  meanwhile) names the generation it began on and is ignored for another.
- `opened`, `written` - the tour as opened, and as last written (the
  opened one until a save landed); null before an open.
- `stations: StationFrame[]` - every station without its items (`geo`,
  radii, title, steps): the frames as they stand, moved by `stationMoved`.
- `placed: EditEntry[]` - objects placed, edited or moved, in the world,
  one entry per id; pending while the written file does not hold them by
  content (`unsavedEntries`).
- `deleted: string[]` - ids of written objects deleted and not yet written.
- `needsNoGps`, `details` (`TourDetailFields`) - the setting and the details
  as set; `touched` says which were changed here since the open (live work,
  which a draft's offer never overrides); `detailsRecorded` says the draft's
  settings record carries the details.
- `past` / `future: TourHistoryStep[]` - the history: each step a
  `TourDocumentView` (`stations`, the world `objects`, `needsNoGps`,
  `details`) and the edit in words. At most `TOUR_HISTORY_LIMIT` (200).
- `revision` - counts every edit, undo and redo.
- `save: TourSaveStatus` - what used to be the desktop page's module-scope
  save flags: `status` (`idle` / `saving` / `error`, derived: saving while
  the page's slot is held or a rebuild runs), `error` (the last failure's
  words), `by` (who holds the page's one save slot: `explicit`, `auto`,
  `walk`), `rebuilds` (the session's queued rebuilds: an undo waits),
  `queued` (a Save waiting for the autosave), `built`, `delivered`
  (in place or downloaded, under which name), `largeTour`, `cannotSave`.

Blobs are never state: a photo's picture lives in the page's side table
keyed by id (`editor-session.ts` `pictures`), handed to the draft by the
listener (`tour-document-draft.ts`) and to the rebuild by the page.

## Actions (`tourDocumentActions`)

- `opened({ manifest })` - everything before it is gone; `generation` + 1.
  Only who holds the page's save slot (`save.by`) is kept: the slot is
  the page's, and the save holding it lets it go once it sees its tour
  gone (as the page's own flag behaved).
- `placed` / `edited` / `moved({ object, what })` - one case reducer
  (`upsertPlaced`): a new object, a pin's text, a move on the map or in AR.
  Three names so a log reads as what happened.
- `deleted({ id, what })` - `deleteObject`: the entry goes, a written
  object gets a tombstone; an unknown id changes nothing.
- `stationMoved({ stationId, geo, what })` - D17: the frame moves, and every
  object of the station becomes an edit at the spot the moved frame gives
  it (its local pose kept), as the phone's settle leaves its lists; an
  unknown station changes nothing.
- `settingsChanged({ needsNoGps, what })`, `detailsChanged({ details, what })`
  - the details as checked by `checkDetailsForm`.
- `undone()` / `redone()` - one step; the document goes to the step's view
  MEASURED AGAINST THE WRITTEN FILE (`contentAt`): what the file holds as
  the view has it is not pending, the rest is. "Holds" is read through the
  VIEW's frames, as `documentObjects` reads the objects: an item the file
  keeps at a local pose under a frame the view moved stands elsewhere, so it
  stays an entry (a save under a moved frame, then an undo of the move -
  found by the "undoing everything" property). A save that lands after a
  frame moved prunes the same way.
- `restored({ objects, deleted, needsNoGps?, details?, what })` - a draft's
  work, already filtered by the page's rules: one step to undo; not live
  work (`touched` unchanged).
- `saveStarted({ generation })`, `saved({ generation, written,
appliedDeletions, stationsAtStart })`, `saveEnded({ generation, error? })`
  - a rebuild queued, landed (the written file replaced; `pendingAfterRebuild` keeps what the
    write did not carry; the written frames replace the document's unless one
    moved while it ran), and ended. Each names the open it began on and is
    ignored for another.
- The page's save slot (the desktop page, `editor/edit-main.ts`):
  `saveClaimed({ by })`, `saveReleased({ error? })`, `saveQueued({ queued })`,
  `saveBuilt()`, `saveDelivered({ inPlace, name })`, `saveLimited({
largeTour?, cannotSave? })`.
- `closed()` - the tour is gone without another opening: back to the
  initial state, `generation` + 1, the save slot kept as for `opened`.

Names adjusted from the coordinator's list: `deleteUndone` is not an
action - an undo of a delete is `undone` (the whole document's history),
and the phone's toast-only undo is the phone adoption's decision; the
save is three actions because a write is queued, lands, and ends at
different times (a walk's move lands only after the page wrote both files).

## Selectors and pure rules

- `selectTourDocument(root)` - the slice in a store's state.
- `documentObjects(state)` - the objects now (`authoringObjects` over the
  written tour with the frames), each with its entry.
- `manifestNow(state)` - the manifest the next write starts from: the
  written tour with the frames (`withFrames`), the setting
  (`withNeedsNoGps`) and the details (`effectiveDetails`).
- `manifestToWrite(state)` - what a write would carry: `finishedManifest`
  (the Finish's own rule) over `manifestNow`, `placed` and `deleted`.
- `changeCount(state)` - each pending entry, deletion, moved frame, the
  setting and each detail field differing from the written file.
- `effectiveDetails(state)` - the cover only while its image is in the tour.
- `viewOf(state)`, `picturesNeeded(state, view)` - for a page's undo: a
  step that brings back a photo the written file has no picture for needs
  the page's picture.
- `framesOf(manifest)`.
- Module-internal (not exported: nothing outside the slice needs them, and
  the root dead-code check holds exports to their importers):
  `contentAt(written, view)`, `withFrames(written, frames, placed)`,
  `withNeedsNoGps(manifest, on)`, and the payload and history types
  (`TourHistoryStep`, `TourRestore`, `TourSaved`).
- `nextStep(state, which)` - the step an undo or a redo would go to (the
  desktop session checks its pictures before dispatching); the save status
  types `TourSaveStatus` and `TourSaveHolder` (the desktop page's save slot).
- `isDocumentEdit(action)` - the actions a draft follows (not `saved`, not
  `opened`).

## Invariants & assumptions

- **One copy of the tour.** A page reads the document through selectors and
  changes it only by these actions; it keeps no copy of its own (D29).
- **Undo is over the whole document**, station frames included, and is
  measured against the file as written now: an undo after a save puts back
  what that save wrote as a pending change (property-tested: an undo then a
  redo changes nothing; any sequence followed by undoing everything gives
  the tour back as opened, station order included - which also settles the
  M5a review M2 order deviation for the desktop: the frames in the history
  bring an emptied, pruned station back where it stood).
- **What the state writes is what the rebuild writes**: `manifestToWrite`
  is `finishedManifest`, the function `rebuildFinishedTour` itself calls
  (property-tested against real zips).
- Reducers are pure: each computes from a plain snapshot (`current`) and
  returns the next state; nothing reads a clock or a random source except
  the automatic station ids `withTourContent` mints inside
  `manifestToWrite` (selectors only, never stored).
- Preconditions the page owns, checked before it dispatches: a photo's
  picture for an undo (`picturesNeeded`), a move within a station's reach
  (`TOO_FAR_FROM_STATION`), an id the tour carries. The reducers stay
  defensive: an unknown id or station changes nothing.

## Examples

```ts
const store = createTourViewerStore();
store.dispatch(tourDocumentActions.opened({ manifest }));
store.dispatch(
  tourDocumentActions.edited({
    object: { ...pin, label: "New" },
    what: "the text",
  }),
);
changeCount(selectTourDocument(store.getState())); // 1
store.dispatch(tourDocumentActions.undone());
```

## Tests

- `tour-document.test.ts` - the open, pending by content, undo and redo,
  the history bound, an undo after a save (the photo needing its picture,
  the emptied station coming back in its place), a station's frame moving
  its items rigidly, the setting and details, a cover following its photo,
  a restore as one step, the save status, an edit made during a save
  staying pending, a late save of another open ignored.
- `tour-document.property.test.ts` - over random sequences of edits,
  moves, deletes, placements, station moves, settings, details, undos,
  redos and saves: undo then redo is identity; undoing everything gives the
  opened tour; `manifestToWrite` equals `rebuildFinishedTour`'s written
  manifest on a real zip.
- `tour-document-parity.test.ts` - the phone's and the desktop's paths
  write the same tour and draft (D30).
