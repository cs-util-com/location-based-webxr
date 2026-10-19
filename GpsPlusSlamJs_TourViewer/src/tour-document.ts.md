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
  one entry per id; pending while the written file, read through the
  document's frames, does not hold them by content (`unsavedEntries`): a
  station's rigid move leaves its items unchanged inside it, so only the
  frame is pending.
- `deleted: string[]` - ids of written objects deleted and not yet written.
- `needsNoGps`, `details` (`TourDetailFields`) - the setting and the details
  as set; `touched` says which were changed here since the open (live work,
  which a draft's offer never overrides - `touched.stations` for a station
  moved here); `detailsRecorded` and `stationsRecorded` say the draft's
  settings record carries the details, and the station poses (`StationPose`,
  `{ id, geo }`: set by a station move or by an open whose frames moved,
  review #1 of the tour document milestone - without them a reload after a
  station move restored its items under the file's frame, so they landed
  elsewhere).
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
- `placed` / `edited` / `moved({ object, what })` - one entry per id
  (`upsertPlaced`): a new object, a pin's text, a move on the map or in AR.
  Three names so a log reads as what happened. `placed` changes nothing
  for an id the tour carries (`canPlace`); none of the three for a spot
  beyond its station's reach (`objectFits`), nor for a pending object put
  again with the same content (`objectContentKey`): the AR settle
  re-poses every object of a visit, and an unchanged one is no step - it
  would withdraw a delete's Undo.
- `deleted({ id, what })` - `deleteObject`: the entry goes, a written
  object gets a tombstone; an unknown id changes nothing.
- `stationMoved({ stationId, geo, what })` - D17: the frame moves, and every
  object of the station becomes an edit at the spot the moved frame gives
  it (its local pose kept), as the phone's settle leaves its lists; an
  unknown station changes nothing.
- `settingsChanged({ needsNoGps, what })`, `detailsChanged({ details, what })`
  - the details as checked by `checkDetailsForm`.
- `undone()` / `redone()` - one step (none while a save is queued or runs,
  `canStep`); the document goes to the step's view
  MEASURED AGAINST THE WRITTEN FILE (`contentAt`): what the file holds as
  the view has it is not pending, the rest is. "Holds" is read through the
  VIEW's frames, as `documentObjects` reads the objects: an item the file
  keeps at a local pose under a frame the view moved stands elsewhere, so it
  stays an entry (a save under a moved frame, then an undo of the move -
  found by the "undoing everything" property). A save that lands after a
  frame moved prunes the same way.
- `restored({ objects, deleted, needsNoGps?, details?, stations?, what })` -
  a draft's work, already filtered by the page's rules: the station poses
  first (each named station's frame takes its pose, `stationsRecorded` set),
  then the objects under those frames (one beyond its station's reach is
  skipped here too, `objectFits`): one step to undo; not live work
  (`touched` unchanged).
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
- `manifestToWrite(state, captureSpots?, stationRule?)` - what a write
  would carry: `finishedManifest` (the Finish's own rule) over
  `manifestNow`, `placed`, `deleted` and the save's photo spots (the
  walk's recorded photos, which a page decides once per open; the r875
  milestone review #7). `stationRule` (`newStationId`, `radiusM`) is for
  a reader that previews the write: the creator's station HUD
  (`creator-stations.ts`) names the stations it would start its own way.
- `changeCount(state)` - each pending entry, deletion, moved frame, the
  setting and each detail field differing from the written file. A frame
  is compared by its data, never by the order its keys were built in
  (`same-json.ts`), so a station moved back is no change.
- `effectiveDetails(state)` - the cover only while its image is in the tour.
- `coverImageIds(state)` - the images the tour may show as its cover (its
  photos as they stand, its image assets).
- `detailsChange(state, form)` - a details form checked by the format's
  rules (`checkDetailsForm`), as both pages check it: `changed` with the
  details to dispatch, `unchanged`, or `refused` with the reason in words.
- `pinTextChange(state, id, text)` - a pin's new text by the shared rule
  (`pinTextEdit`: trimmed, never empty), as both pages shape the `edited`
  payload: `edited` with the object to dispatch, `unchanged` (the same
  text, or not a pin), `refused` with the phone's sentence, or `missing`
  for an id the tour does not carry.
- `objectMoveChange(state, id, lat, lon)` - a move on the map
  (`moveObjectTo`, height and facing kept): `moved` with the object
  `before` and `after`, `too-far` beyond its station's reach
  (`objectFits`), or `missing`; throws for a position nobody can draw.
  These two (with `detailsChange`) are why a page imports no rule of
  `object-edits.ts` itself (`config/.dependency-cruiser.cjs`).
- `tourFieldChanges(state)` - `changeCount` less the objects': the moved
  frames, the setting and the detail fields not written yet.
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
- The rules the reducers keep, exported so a page asks first and says why
  in its own words (`editor-session.ts`'s refusals): `objectFits(state,
object)` (within the format's `TOUR_ITEM_MAX_OFFSET_M` per axis of its
  own station, or of the one its id stands in; true for a station the
  document does not carry), `canPlace(state, object)` (an id the tour does
  not carry, within reach) and `canStep(state)` (no save queued or
  running). The per-station test under `objectFits` is module-private.

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
  is `finishedManifest`, the function `rebuildFinishedTour` itself calls,
  over the same inputs, the photo spots included (property-tested against
  real zips, with spots and without, and across a second save). It is the
  same rule computed twice, not one call: the save does not read the
  selector, so the property is what holds the two together.
- Reducers are pure: each computes from a plain snapshot (`current`) and
  returns the next state; nothing reads a clock or a random source except
  the automatic station ids `withTourContent` mints inside
  `manifestToWrite` (selectors only, never stored).
- **The reducers keep the document's rules** (the r875 milestone review
  #3): a placement of an id the tour carries, a spot beyond its station's
  reach, an undo or redo while a save runs - each changes nothing, so a
  second page dispatching the same actions cannot break them. An unknown id
  or station changes nothing either, and NO edit changes anything before a
  tour is open (`written === null`): the setting and the details included
  (PR #644 review), since a history step recorded there is one no undo can
  take back - a step is measured against a written file. The one precondition the page alone
  owns is a photo's picture for an undo (`picturesNeeded`): Blobs are not
  state.
- **The history's cost** (review #9): each step copies the view - every
  station frame and every object in the world - so the history holds up to
  200 times the tour's objects. For the tours made today (tens of objects)
  that is kilobytes; at thousands of objects it reaches tens of megabytes
  and every edit pays an O(objects) copy. The threshold to revisit it
  (steps storing only what changed) is a tour of about a thousand objects.

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

- `tour-document.test.ts` - the open, pending by content, the same
  content put again as no step, undo and redo,
  the history bound, an undo after a save (the photo needing its picture,
  the emptied station coming back in its place), a station's frame moving
  its items rigidly, the setting and details, a cover following its photo,
  a restore as one step, the save status, an edit made during a save
  staying pending, a late save of another open ignored, the rules the
  reducers keep (each confirmed to fail with its guard turned off), a note
  pending after its station moved and it moved back, and what a pin's text
  and a move on the map would change (`pinTextChange`, `objectMoveChange`).
- The save, a thunk against this slice: `tour-document-save.ts.md`.
- `tour-document.property.test.ts` - over random sequences of edits,
  moves, deletes, placements, station moves, settings, details, undos,
  redos and saves: undo then redo is identity; undoing everything gives the
  opened tour; `manifestToWrite` equals `rebuildFinishedTour`'s written
  manifest on a real zip, with the walk's photo spots and without, and
  again for a second save after the first landed.
- `tour-document-parity.test.ts` - the phone's and the desktop's paths
  write the same tour and draft (D30).
