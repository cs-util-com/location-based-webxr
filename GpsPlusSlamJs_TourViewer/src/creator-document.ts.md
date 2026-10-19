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
    file is open (none, or one without `tour.json`) and nothing was
    written. The same object until the document changes.
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
  - `place(object, { blob?, placement? }, what)` - `canPlace`; returns
    the change with `ownStation`: while "New station here" is armed
    (owner decision D8 of `GpsPlusSlamJs_Docs/docs/2026-10-18-2210-editor3d-prototypes-round-2-plan.md`) the object names a fresh station id
    of its own (one the document does not use), so the write starts it
    there even within R of another (`tour-content.ts`), and the arm goes
    - only when the placement is taken: a refused one keeps it;
  - `edit(object, what)` - `objectFits`; the AR placement is kept;
  - `move(object, what, placement?)` - `objectFits`; `placement` replaces
    the AR placement (a move in AR), else it is kept (a settle's re-pose);
  - `remove(id, what)` - null for an id the tour does not carry;
  - `moveStation(stationId, geo, what)` - D17, null for an unknown station;
  - `restore({ objects, deleted, pictures, stations? }, what)` - a draft's
    work, already filtered by the page, with its photos' pictures;
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
  (scan-to-open plan §9 #5) or in a tour whose file has no `tour.json`. So
  "no tour" is an empty manifest the handle opened itself, told apart by
  identity: `manifest()` reads null there, as the session field it replaces
  did, until a write lands.
- **`open` carries only that work.** Objects placed with no tour open come
  into the opened tour as one restored step (their pictures and placements
  with them); anything of another tour was dropped at its `close`, side
  tables included (M4 review #1: carried into another tour it would be
  written into ITS zip).
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
  a file without `tour.json`, a close dropping everything), the identities
  readers memoize on (a new manifest when only the tombstones change,
  driven through a store that serves that state, since no reducer makes
  it), the guards (a known id, a move beyond reach, an
  unknown station), the placement kept or replaced, undo (refused while a
  write runs, refused without a picture), a write taking an entry and its
  placement out, and the draft following (writes from the listener with
  the picture, a failure reported to its change, the station poses'
  record, nothing for an open, a close or a landed write).
- The composed phone: `authoring-settle.test.ts`, `creator-setup.test.ts`,
  `creator-finish.test.ts`, `tour-document-parity.test.ts`.
