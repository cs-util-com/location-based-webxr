# tour-document-draft.ts

**Purpose:** what a page's draft writes when the tour document
(`tour-document.ts`) changes: the writes follow the STATE, not the
gesture. A page registers `followDocument` as a Redux listener (the
store's listener middleware, `createTourViewerStore`'s
`listenToDocument`) for the actions `isDocumentEdit` names; it runs
after the reducer, never from `store.subscribe`.

## Public API

- `TourSettingsRecord` - `{ needsNoGps, details?, stations?,
createdStations? }` (`stations`: `StationPose[]`, each station's
  `{ id, geo }`; `createdStations`: the whole frames of the stations this
  page created, `createdStationFrames` of `tour-document.ts`, absent when
  none), the draft's settings record (`editor/editor-draft.ts`'s
  `EditorTourSettings` has the same shape). Every object belongs to a
  station from its placement on, and the objects' records only NAME it:
  the record keeps the frame, so a reload brings a pin's station back
  where it stood (`restored` puts it back before the objects).
  Once a station was edited, added, deleted, reordered or copied
  (`framesRecorded`), the record also carries `frames` (every frame the
  next write carries, in its order, card image included) and
  `deletedStations` (the opened or written tour's stations it no longer
  carries, absent when none): what `restored` needs to bring those edits
  back, since no object's record names them.
- `TourDocumentDraft` - `DraftObjectWrites` (`draft-actions.ts`) plus
  `saveSettings(record)`, and `saveCodes(codes)` for a page that keeps a
  codes record (the phone's; the desktop measures no code and has none).
- `TourCodesRecord` `{ level, levels }` (plan M3b) - the codes a draft
  keeps: the code in hand (the page's, not the document's, so the caller
  names it) and `levelsNotHosted`, the hand's code among them; written as
  `draft-persistence.ts`'s `CODES_KEY` file. Built inside the module
  (`codesRecord(state, hand)`, not exported).
- `SETTINGS_KEY` (`"settings"`) - the record's file in a draft
  namespace, on both pages; `readDraft` skips it.
- `parseSettingsRecord(text, against?)` - a stored record, or undefined
  when it does not read (a bad station pose or detail costs the record,
  never the objects beside it). `against` is the opened tour: its
  stations count as siblings a route may name, and its assets as what a
  story step may name (without it, a frame whose step names an asset is
  lost). The created frames and the `frames` are read one by one as the
  format reads a station (`parseTourManifest`, without items, with a
  stand-in for each sibling that reads, so a route between them
  resolves); of two under one id the first is kept. A frame that does not
  read is lost - the objects naming it are seated by the station rule as
  they come back - and so is every frame whose route names a lost one:
  the frames are read again against the ones that read until none more
  drops, so no kept frame routes to a created station the record lost.
  The format's reader drops a card image naming a photo (the probe holds
  no items), so a well-formed `image` id of the record is put back on the
  frame it read from: a copied station's card showing its own copied
  photo comes back with it. `deletedStations` keeps the well-formed ids.
  A record without the newer fields reads as before.
- `changedStations(wanted, against)` - the ids of `wanted`'s stations
  whose pose differs from `against`'s (by data, whatever its key order:
  `same-json.ts`); none without an opinion, none for a station `against`
  does not carry.
- `settingsRecord(state)` - the record as the document holds it: the
  details only once `detailsRecorded`, the station poses (every station's,
  in the document's order) only once `stationsRecorded`, the frames and
  the stations gone only once `framesRecorded`
  (`documentFrames`, `stationsGoneSinceOpen`).
- `followDocument(draft, before, after, pictureOf, hands?)` - issues, in
  order, each id's writes for its change of standing against the written
  file (an entry, a tombstone, or nothing), then the settings record when
  it changed, then the codes record when it changed (only with a
  `saveCodes` and `hands`, the code in hand before and after). Writes
  nothing when `before` and `after` belong to different opens
  (`generation`).

## Invariants & assumptions

- **The gestures' own writes, from the state** (`draft-actions.ts`):
  - now deleted, was not: `saveDeletion` (a tombstone removes the record);
  - now nothing: a tombstone goes (`forgetDeletion`), or a record only this
    page had goes (`forgetObject`) - unless the written file lacks the id
    and the OPENED file holds it: that is a delete a save wrote, taken
    again (a redo after the undo across that save), and the draft keeps it
    as a tombstone (`saveDeletion`), since a reload may open a file that
    still holds the object (a download is not in place; the r880 fix
    re-review, L1);
  - now an entry: its record (`saveObject`, with the page's picture for a
    photo, `pictureOf`) unless the content is the same, THEN a tombstone
    goes - the record first, so an undo cut short leaves the object
    deleted rather than half restored (M4 review #5). The tombstone goes
    when it was deleted here, AND when it was nothing and the written file
    lacks it: an undo across a save that wrote its delete (the save took
    the id out of the document's deletions but not the draft's tombstone,
    which a later restore would apply again - the r880 milestone review
    HIGH-1). For a new object that is a removal of a key that is not
    there.
- Fire and forget: the draft queues per id and says its own failures once.
- A landed save is not followed (`isDocumentEdit`): it takes entries off
  the pending list, which would read as forgotten records.

## Examples

```ts
const stop = store.listenToDocument({
  predicate: isDocumentEdit,
  effect: (_action, api) => {
    followDocument(
      draft,
      selectTourDocument(api.getOriginalState()),
      selectTourDocument(api.getState()),
      (id) => pictures.get(id),
    );
  },
});
```

## Tests

- `tour-document-draft.test.ts` - an edit (and the same content again), a
  written object's tombstone and a new one's forgotten record, an undo of
  an edited object's delete (record before tombstone), an undo across a
  save that wrote the delete (its tombstone forgotten after the record),
  a redo of that delete (its tombstone written again, L1), a new object's
  undo (no tombstone), a photo's picture,
  the settings record with and without details, the station poses once a
  station moved (review #1), nothing for a save landing
  or across an open; the created stations' frames written by a placement
  that starts one (none for one that joins), read back as they were, and
  a record whose frames do not read keeping the rest, and one broken frame
  among good ones costing only itself; a frame routing to a broken
  sibling lost with it, and one routing to that frame too, so no kept
  frame routes to a lost station; the codes record written when a code's
  text or the hand changes, not for the same codes, and never for a
  draft without `saveCodes`.
- `tour-document-stations-draft.test.ts` - the stations whole through the
  record and a restore: renamed, added, deleted (its route pruned),
  reordered, an item copied; a copied station's own photo as its card
  image (seen red with the image re-attach off); a frame with an image
  step read against the opened tour's assets and lost without them; a
  deleted station an object still names kept; a record of the earlier
  format restoring its poses.
- `tour-document.property.test.ts` - any sequence of edits written to the
  records and restored over the opened tour gives back the same write.
- The record's reading and comparing, through both drafts:
  `editor/editor-draft.test.ts` and `creator-setup.test.ts` "the draft
  keeps a moved station's pose".
- Through the editor: `editor/editor-session.test.ts` (among them delete,
  download, undo, redo, then a reload that offers the delete again) and the
  parity contract `tour-document-parity.test.ts` (the draft records
  compared).
