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
  radii, title, steps): the frames as they stand, moved by `stationMoved`,
  started by the station rule (below) and dropped with the last object of
  an automatic one, in the order they were made.
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
- `position` - where the document stands in its history: 0 at the open,
  one more for an edit or a redo, one less for an undo. Absolute (the
  history's bound drops old steps, never renumbers them), so a save names
  the view it wrote (`save.inPlaceAt`).
- `save: TourSaveStatus` - what used to be the desktop page's module-scope
  save flags: `status` (`idle` / `saving` / `error`, derived: saving while
  the page's slot is held or a rebuild runs), `error` (the last failure's
  words), `by` (who holds the page's one save slot: `explicit`, `auto`,
  `walk`), `rebuilds` (the session's queued rebuilds: an undo waits),
  `queued` (a Save waiting for the autosave), `built`, `delivered`
  (in place or downloaded, under which name), `largeTour`, `cannotSave`,
  `inPlaceAt` and `resave` (D33, below).

- `newStationArmed` - the phone's "New station here" is armed (owner
  decision D8 of `GpsPlusSlamJs_Docs/docs/2026-10-18-2210-editor3d-prototypes-round-2-plan.md`): the next placement starts its own station. An
  authoring flag of the page, kept here because this is the slice that
  holds the page's authoring state (the save slot too); `tourAuthoring/*`
  has no reducer by design. Not an edit: no history, no revision, no draft
  write. The initial state, so `opened` and `closed` disarm it. The
  phone's handle mints the station id and consumes the flag
  (`creator-document.ts`).

Blobs are never state: a photo's picture lives in the page's side table
keyed by id (`editor-session.ts` `pictures`), handed to the draft by the
listener (`tour-document-draft.ts`) and to the rebuild by the page.

## Actions (`tourDocumentActions`)

- `opened({ manifest })` - everything before it is gone; `generation` + 1.
  Only who holds the page's save slot (`save.by`) is kept: the slot is
  the page's, and the save holding it lets it go once it sees its tour
  gone (as the page's own flag behaved).
- `placed` / `edited` / `moved({ object, what, newStationId?, newStation? })`
  - one entry per id (`upsertPlaced`): a new object, a pin's text, a move
    on the map or in AR. Three names so a log reads as what happened. None
    changes anything for a pending object put again with the same content
    and the same stations (`objectContentKey`): the AR settle re-poses
    every object of a visit, and an unchanged one is no step - it would
    withdraw a delete's Undo.
- **Every object belongs to a station from the moment it is placed** (the
  station rule, `seatByRule`). It reads the stations of `manifestNow` (a
  written station no frame names still counts) and seats an object naming
  no station in the NEAREST station whose OWN `foundRadiusM` holds it
  (`station-assign.ts` `stationHolding`: horizontal, the radius itself
  inside, a tie to the earlier station), or starts a new automatic station
  anchored at it (`tour-content.ts` `automaticStationFrame`: found 25 m,
  activates 50 m, turned like north, arrow hint, no story), appended to
  `stations`. The new station's id is minted OUTSIDE the reducer: the
  caller passes `newStationId`, or the action's `prepare` mints one
  (`newObjectId`), so the reducer stays pure and a test can pin it; a
  taken id changes nothing.
  - `placed`: refused for an id the document carries or deleted (its
    tombstone would hide the placement), or naming a station it lacks or
    too far from it (`canPlace`). An object naming a station keeps it;
    one naming none is seated by the rule; "New station here"
    (`newStation: true`) always starts a new station, even within
    another's radius.
  - `edited`: keeps the object's station (`objectFits`); an object naming
    none, of an id the document lacks, changes nothing.
  - `moved`: within its station's own found radius the object keeps its
    station (whose anchor stays put); beyond it the rule runs again - the
    station holding the new spot, or a new one there - so no move is ever
    too far. The station it left goes in the same step when that leaves
    it an EMPTY AUTOMATIC station: no object names it, and no title,
    story step, route to it (`next`, a quiz's routes) or recorded photo
    keeps it. An unknown id changes nothing.
  - One step each: an undo gives the stations back exactly as they were.
- `deleted({ id, what })` - `deleteObject`: the entry goes, a written
  object gets a tombstone, and its station goes too when that leaves it an
  empty automatic station (as for a move); an unknown id changes nothing.
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
  frame moved prunes the same way. A step marks the station poses as the
  draft's to keep (`stationsRecorded`, `touched.stations`) only when a
  frame both views carry differs: a station the rule started or dropped
  is no moved station.
- `restored({ objects, deleted, needsNoGps?, details?, stations?,
createdStations?, rerun?, what, newStationIds? })` - a draft's work,
  already filtered by the page's rules, as one step to undo; not live work
  (`touched` unchanged). In order: the station poses (each named
  station's frame takes its pose, `stationsRecorded` set); the CREATED
  stations' whole frames the document lacks (a draft keeps them, so a
  reload brings a pin's station back with it); then each object - in its
  own station when the document carries it and it fits there, else seated
  by the station rule under its minted id (`newStationIds[i]`, one per
  object, minted by `prepare`). `rerun` (work carried into a tour just
  opened) seats every object afresh by the rule: the stations they named
  were another document's. The stations left emptied go as for a move.
- `saveStarted({ generation })`, `saved({ generation, written,
appliedDeletions, stationsAtStart, inPlaceAt? })`, `saveEnded({ generation, error? })`
  - a rebuild queued, landed (the written file replaced; `pendingAfterRebuild` keeps what the
    write did not carry; the written frames replace the document's unless one
    moved while it ran), and ended. Each names the open it began on and is
    ignored for another. `inPlaceAt` (the desktop's in-place write: the
    history position of the view the save's snapshot took) becomes
    `save.inPlaceAt`; without it (a download, the phone's Finish) that is
    null.
- The page's save slot (the desktop page, `editor/edit-main.ts`):
  `saveClaimed({ by })` (it also takes a due `resave` on: a save claimed
  after a step writes the document as it stands then, or says why it could
  not - so a refusal never loops), `saveReleased({ error? })`, `saveQueued({ queued })`,
  `saveBuilt()`, `saveDelivered({ inPlace, name })`, `saveLimited({
largeTour?, cannotSave? })`.
- `newStationArmed({ armed })` - "New station here" armed or disarmed
  (D8); no edit.
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
- `manifestToWrite(state)` - what a write would carry:
  `finishedManifest` (the Finish's own rule) over `manifestNow`, `placed`
  and `deleted`. The stations are the document's as they are: the walk's
  photos were baked into them at the open (`walkAtOpen`), and a write
  assigns nothing. The creator's station HUD (`creator-stations.ts`)
  reads its stations from it.
- `createdStationFrames(state)` - the frames of the stations this page
  created (those the tour as opened lacks): what the draft's settings
  record keeps whole (`tour-document-draft.ts`).
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
  `before` and `after` (however far: the `moved` action seats it by the
  station rule), or `missing`; throws for a position nobody can draw.
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
  own station, or of the one its id stands in; FALSE for a station the
  document does not carry, a dangling id; true for an object no station
  holds yet, which the rule seats), `canPlace(state, object)` (an id the
  tour neither carries nor deleted, fitting) and `canStep(state)` (no save
  queued or running). The per-station test under `objectFits` is
  module-private.

## A step across an in-place save (D33)

The desktop's open drops every draft record of an id the file on disk
lacks, so a delete written in place and then undone was lost on a reload
(the tour editor plan's §28/§29 "P2"). The owner's fix (D33, §32): an undo
or a redo that crosses an in-place save writes the file in place again at
once. The slice says when; the page writes (`editor/edit-main.ts`
`resaveIfDue`).

- **The rule** (module-private `stepCrossesInPlaceSave(state, which)`): with
  `w = save.inPlaceAt` and `p = position` before the step,
  - an undo crosses when `w >= p` - it undoes an edit the in-place file
    holds;
  - a redo crosses when `w <= p` - it redoes an edit that file lacks;
  - with `w = "elsewhere"` every step crosses; with `w = null` (no in-place
    save of this open, or the last save a download) none does; a step that
    does not happen (nothing to undo, a save running) crosses nothing.
- **`elsewhere`**: a new edit made below `w` drops the redo that led back to
  the file's view (the file was undone across and its resave had not yet
  landed, or failed). No view on the history is the file's then, so every
  step crosses until a save lands.
- **Positions, not times.** A redo of an edit made after the in-place save
  and undone since crosses it too (the file lacks the edit): it writes at
  once where the autosave would have written a few seconds later.
- **`resave`** is set by the step that crossed and taken on by the next
  `saveClaimed`. A step during the write of an in-place save (after its
  rebuild, which an undo waits for) is measured against the view that write
  holds (`inPlaceWriting`, named by `saved`) as well as against
  `inPlaceAt` - the disk holds one of the two once the write ends - and is
  written once that save ends.
- **A download is no in-place save.** `inPlaceAt` is null after one, so no
  step crosses: a download cannot be rewritten silently. A tour whose saves
  turned into downloads ("Download instead") keeps the earlier in-place file
  on disk as it was; this page no longer writes it.
- **The file's view is named when the write ARRIVES**, not when the save is
  built: `saved` names it `inPlaceWriting`, `saveDelivered` (in place)
  makes it `inPlaceAt`, and a build whose write never arrived keeps its
  view in `inPlaceWriting` (counted only while a save holds the slot) so
  that "tap Save again", which re-delivers the same build, names it when
  it arrives. A refused or failed in-place write therefore leaves
  `inPlaceAt` at the view the disk still holds, and later steps are measured against
  the real file (the disk at view 1, an undo to 0 whose resave fails: a
  redo back to 1 writes nothing, and the undo after it crosses the file
  again; a new edit at 1 drops the disk's view, so its undo crosses too).
  The page also says a failed write: the status line's "Not saved yet -
  tap Save again" (the save built, not delivered), the in-place refusal
  toast, autosave paused, and leaving asks first (`beforeunload`).
- **The walk's move** names its position from its snapshot, taken when the
  move was built; no step can come between that and its commit (the Done
  dialog is modal).

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
  over the same inputs (property-tested against real zips, for a tour
  opened with its walk baked and without, and across a second save). It is the
  same rule computed twice, not one call: the save does not read the
  selector, so the property is what holds the two together.
- Reducers are pure: each computes from a plain snapshot (`current`) and
  returns the next state; nothing reads a clock or a random source. A
  station id the rule may need is minted by the caller or the action's
  `prepare`, before the reducer.
- **Every object names one of the document's stations**, and no empty
  automatic station stays (property-tested over placements inside, on the
  edge of and beyond the radius, "New station here", moves, deletes,
  station moves, restored drafts, carried work, saves, undos and redos).
  The rule's values: each station's own found radius (25 m for the ones
  it starts; the radius itself is inside, a tie goes to the earlier
  station); a new station activates at 50 m. A radius that is not a
  positive finite number holds nothing. What would change a verdict: a
  different automatic radius moves the line between joining and starting
  a station by exactly that much, and nothing else.
- **The reducers keep the document's rules** (the r875 milestone review
  #3): a placement of an id the tour carries or deleted, a spot beyond the
  reach of a station it names, a station it names that the document
  lacks, an undo or redo while a save runs - each changes nothing, so a
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

- `tour-document.test.ts` - the step across an in-place save (D33: an undo
  of a written delete, an undo of an edit no save wrote or made after it,
  the second undo below the save, a download, a redo across and not, the
  file off the history, the claim taking it on, the position count), the
  open, pending by content, the same
  content put again as no step, undo and redo,
  the history bound, an undo after a save (the photo needing its picture,
  the emptied station coming back in its place), a station's frame moving
  its items rigidly, the setting and details, a cover following its photo,
  a restore as one step, the save status, an edit made during a save
  staying pending, a late save of another open ignored, the rules the
  reducers keep (each confirmed to fail with its guard turned off), a note
  pending after its station moved and it moved back, and what a pin's text
  and a move on the map would change (`pinTextChange`, `objectMoveChange`).
  "Every object belongs to a station": the found radius itself inside (and
  a micrometre beyond it outside), a station's own radius (5 m and 40 m),
  a tie to the earlier station and two that hold to the nearer, the new
  station's frame, "New station here" within a radius, a taken id and a
  dangling station refused, a move within, out of and back into a radius,
  the station it left dropped, a delete dropping an emptied automatic
  station and its undo bringing it back exactly, the stations a title, a
  step, a route or a recorded photo keeps, a placement during a save, a
  restore re-creating its created frames and seating a dangling object,
  carried work re-seated.
- The save, a thunk against this slice: `tour-document-save.ts.md`.
- `tour-document.property.test.ts` - D33's rule against a model that reads
  the SET of edits each view carries (over random edits, steps, in-place
  saves, failed ones and downloads, and steps while an in-place write is in
  flight holding the slot: a resave is due exactly when a step undoes an
  edit the in-place file - or the write in flight - holds, redoes one it
  lacks, or that view is off the history); over random sequences of edits,
  moves, deletes, placements, station moves, settings, details, undos,
  redos and saves: undo then redo is identity; undoing everything gives the
  opened tour; `manifestToWrite` equals `rebuildFinishedTour`'s written
  manifest on a real zip, opened with the walk baked and without, and
  again for a second save after the first landed. And the station rule:
  after every step of a random mix of placements (12.5 m steps, so inside,
  on the edge of and beyond the 25 m radius), moves, deletes, station
  moves, restores, carried work, saves, undos and redos, every object
  names one of the document's stations and no empty automatic station
  stays; an undo of a placement gives the stations back exactly.
- `tour-document-parity.test.ts` - the phone's and the desktop's paths
  write the same tour and draft (D30), the station rule included (a pin
  within a station's radius joins it, one beyond starts one, a move out of
  a radius and into another's, the only pin's delete dropping its
  station); D8's "a pin that starts its own station" is a by-design row (the desktop lacks it until the 3D editor),
  and the harness accepts a by-design row on either page lacking the
  operation.
