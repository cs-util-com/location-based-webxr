# creator-document.ts

**Purpose:** the tour document as the phone's creator page holds it - a
handle over the shared `tourDocument` slice (`tour-document.ts`, D29-D31),
the one copy of the tour both pages edit. Beside the slice it keeps what
state must never hold, in side tables keyed by object id: a photo's
picture (a Blob) and where an object was placed in AR (its odometry pose
in one visit, `VisitPlacement`). The session object carries one per page
(`ctx.tourDocument`, `tour-viewer-session.ts`); the phone keeps no other
copy of the tour.

## Public API

- `createCreatorDocument(store) -> CreatorDocument` - `store` is the page's
  (`createTourViewerStore`; any `CreatorDocumentStore`: `getState`,
  `dispatch`, `listenToDocument`). It opens the "no tour" document at once.
- Reads:
  - `state()` - the slice.
  - `manifest()` - the open tour's manifest as it stands (`manifestNow`:
    its frames moved, its setting and details applied); null while no tour
    is open (`open(null)`: a visitor's file without `tour.json`) and
    nothing was written. A creator's recording opens as an empty tour
    (`archive-open.ts`), so it reads a manifest from the start. The same object until the document changes.
  - `opened()` - the tour file as it was OPENED (the slice's `opened`):
    not what a Finish wrote since, nor this page's changes; null while no
    tour file is open. The phone's draft compares its records with it.
  - `entries()` - this page's entries (`PlacedEntry`: the object, its
    `blob`, its `placement`), in order; the same array until the document
    or a side table changes.
  - `deleted()`, `objects()` (`documentObjects`, each entry joined:
    `CreatorObject`), `pictureOf(id)`.
- Changes - each first asks the slice's own guard and returns null when
  refused, else a `DocumentChange` whose `backedUp` settles once every
  draft write the change caused settled (true: all landed, or no draft
  follows):
  - `place(object, { blob?, placement?, ownStation? }, what)` -
    `canPlace`; the slice's station rule seats an object naming no station
    (the station holding it, or a new one anchored at it, under a fresh id
    the document does not use); with `ownStation` ("New station here",
    owner decision D8 of `GpsPlusSlamJs_Docs/docs/2026-10-18-2210-editor3d-prototypes-round-2-plan.md`)
    always a new one, even within another's radius. Returns the change,
    `ownStation` as asked, and the `object` as the document seated it
    (naming its station). It never reads or changes the arm:
    the caller takes it when the item is committed (a photo at its
    shutter tap, not when its encode lands) and gives it back if the item
    is not placed (`creator-placement.ts`);
  - `edit(object, what)` - `objectFits`; the AR placement is kept;
  - `move(object, what, placement?)` - null for an id the document
    lacks; within its station's found radius the object stays there,
    beyond it the station rule seats it anew (a fresh id for a station it
    starts), and the station it left goes when that empties an automatic
    one. `placement` replaces the AR placement (a move in AR), else it is
    kept (a settle's re-pose);
  - `remove(id, what)` - null for an id the tour does not carry;
  - `moveStation(stationId, geo, what)` - D17, null for an unknown station;
  - `restore({ objects, deleted, pictures, stations?, createdStations? },
what)` - a draft's work, already filtered by the page, with its
    photos' pictures and the whole frames of the stations its objects were
    seated in that the tour lacks;
  - `undo()` - `{ kind: "undone", what, backedUp }`, `{ kind: "nothing" }`,
    or refused: `"saving"` (`canStep`) or `"picture-gone"`
    (`picturesNeeded`, a photo whose picture this page does not hold).
- `newStationArmed()`, `armNewStation(armed)` - the slice's
  `newStationArmed` flag (D8): no edit of the tour (no undo step, no
  revision, no draft write); gone when a tour opens or closes.
- `rename(name)` - the tour's name (the phone's one detail, plan W2):
  `detailsChange` with the other details as they stand - `renamed`
  (`backedUp`), `unchanged`, or `refused` with the reason (over 80
  characters, counted as a reader counts them; an empty name removes the
  title).
- `tourChanged()` - the tour's own fields (its name, a station's frame,
  its setting) changed since the last write (`tourFieldChanges`): work
  for a Finish though no object changed.
- `keepPicture(id, blob)` - a deleted photo's picture, for an undo after a
  write took it out.
- `open(manifest | null)`, `close()` - see the invariants.
- The write (the Finish): `saveStarted() -> generation`, `saved({
generation, written, appliedDeletions, stationsAtStart })`,
  `saveEnded(generation, error?)`.
- `follow(draft)` - the draft follows the document: `followDocument`
  (`tour-document-draft.ts`) from a listener after each edit. Once per
  page (a second call throws: two drafts would write everything twice).
- `stationPlacements()` - the AR anchors of the stations an object with
  an AR placement started, by station id (`StationPlacement`: the
  placement and the `item` it was started for), only stations the
  document has now; see the invariants. `StationPlacement` is the
  method's own shape, module-private.
- `revision()`; the types `VisitPlacement`, `CreatorObject`,
  `DocumentChange`, `CreatorDocumentStore` (`PlacedEntry`,
  `PlacedChange`, `DocumentUndo` and `DocumentRename` are the methods' own shapes,
  module-private).

## Invariants & assumptions

- **The save status is not all here yet**: the slice's `save` says
  whether a write runs for the undo (`canStep`); the phone's Finish keeps
  its own beside it - a named deviation from the root Redux rule, with its
  follow-up, in `creator-finish.ts.md` (the r880 milestone review
  MEDIUM-1).

- **No tour is an open, empty document.** The slice takes edits only into
  an open document, and the creator may place before any tour is open
  (scan-to-open plan §9 #5). So "no tour" is an empty manifest the handle
  opened itself, told apart by identity: `manifest()` reads null there,
  as the session field it replaces did, until a write lands. A creator's
  file without `tour.json` is NOT "no tour": the page opens it as an
  empty manifest of its own (a real, unnamed tour), whose stations the
  HUD, the settle and the write read from the first placement.
- **`open` carries only that work.** Objects placed with no tour open come
  into the opened tour as one restored step (their pictures and placements
  with them), each seated again by the station rule against the opened
  tour's stations (`rerun`): the stations they stood in were the empty
  document's, and none of them comes along; anything of another tour was dropped at its `close`, side
  tables included (M4 review #1: carried into another tour it would be
  written into ITS zip).
- **A station's AR anchor is a side table too** (`stationPlacements()`,
  `StationPlacement`): a station a placement, a move or carried work
  started for an object with an AR placement is anchored at that
  placement, with the object's id (`item`), whose moment the anchor
  settles at - the station rule anchors the frame where its first item
  stands, so the anchor's odometry pose is that item's. The visit's settle
  re-poses such a station with the visit's objects (`creator-settle.ts`).
  Only stations the document has now are listed (an undo hides one, a redo
  brings it back with its anchor); a close drops them all, and a write
  drops those of the stations it carried (they are the file's now, as its
  items' placements go). A station started without an AR placement (a
  draft's, a hosted one) has none.
- **Side tables are set before the dispatch**, so the listener's
  `pictureOf` finds a new photo's picture. Pictures stay until the tour
  closes (an undo after a write needs them); a placement goes when a write
  takes its entry out (as the entry did before the document held it).
- **The draft's writes are collected synchronously.** RTK's listener
  middleware calls the effect inside the dispatch, so the writes a change
  causes are known when `change` returns - the test "writes each change
  from the listener" pins it.
- **`manifest()` is memoized on every field `manifestNow` reads**: the
  written file, the frames, the entries, the tombstones (`deleted`: a
  cover whose photo is deleted is none, `effectiveDetails`), the setting
  and the details. The tombstones are in the key although each reducer
  that changes them also replaces `placed` today; a later reducer that
  touched only them would otherwise serve a stale manifest.
- Nothing here re-implements a document rule: every guard is the slice's
  exported one, asked first so a page can say why in its own words.

## Examples

```ts
const ctx = createTourViewerSession(arStore); // ctx.tourDocument
ctx.tourDocument.follow({ ...draftObjectWrites(draft), saveSettings });
const placed = ctx.tourDocument.place(pin, { placement }, `the pin "Gate"`);
if (placed === null) note("That spot is too far from its station.");
else void placed.backedUp.then((ok) => ok || draft.warnNoBackup());
```

## Tests

- `creator-document.test.ts` - no tour and a tour opening (work carried,
  carried work seated by the rule against the opened tour's stations,
  a file without `tour.json`, a close dropping everything), the identities
  readers memoize on (a new manifest when only the tombstones change,
  driven through a store that serves that state, since no reducer makes
  it), the guards (a known id, a move beyond reach, an
  unknown station), the placement kept or replaced, undo (refused while a
  write runs, refused without a picture), a write taking an entry and its
  placement out, the stations' AR anchors (a placement's, a move's in AR
  and by a settle, carried work's; none without an AR placement or for a
  tour's station; kept through undo and redo; gone with the tour and for a
  written station), and the draft following (writes from the listener with
  the picture, a failure reported to its change, the station poses'
  record, nothing for an open, a close or a landed write).
- The composed phone: `authoring-settle.test.ts`, `creator-setup.test.ts`,
  `creator-finish.test.ts`, `tour-document-parity.test.ts`.
