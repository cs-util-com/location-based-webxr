# tour-document-draft.ts

**Purpose:** what a page's draft writes when the tour document
(`tour-document.ts`) changes: the writes follow the STATE, not the
gesture. A page registers `followDocument` as a Redux listener (the
store's listener middleware, `createTourViewerStore`'s
`listenToDocument`) for the actions `isDocumentEdit` names; it runs
after the reducer, never from `store.subscribe`.

## Public API

- `TourSettingsRecord` - `{ needsNoGps, details?, stations?,
createdStations?, handMadeStations?, frames?, order?, deletedStations? }`
  (`stations`: `StationPose[]`, each station's `{ id, geo }`;
  `createdStations`: the whole frames of the stations this page created,
  `createdStationFrames` of `tour-document.ts`, absent when none;
  `handMadeStations`: the ids of the document's `handMade` stations it
  carries, absent when none, so an untitled station added by hand and
  holding nothing comes back from a reload instead of being dropped as
  emptied), the draft's settings record (`editor/editor-draft.ts`'s
  `EditorTourSettings` has the same shape). Every object belongs to a
  station from its placement on, and the objects' records only NAME it:
  the record keeps the frame, so a reload brings a pin's station back
  where it stood (`restored` puts it back before the objects).
  Once a station was edited, added, deleted, reordered or copied
  (`framesRecorded`), the record also carries `frames` (`recordedFrames`:
  the frames the opened or the written tour lacks or carries otherwise
  beyond their pose, whole, card image included; empty when none),
  `order` (`recordedOrder`: every station's id in order, only when a
  restore would not give that order by itself) and `deletedStations`
  (`stationsGoneSinceOpen`: the opened or written tour's stations it no
  longer carries, an emptied automatic one a write dropped excepted;
  absent when none): what `restored` needs to bring those edits back,
  since no object's record names them. A station edited only elsewhere
  is in none of them, so a restore over a file changed on another device
  keeps that file's version of it, and its pose.
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
- `settingsRecordText(record)` - the text a draft stores for a settings
  record (both pages write through it): `JSON.stringify` of the record
  as it is. Its `createdStations` and `frames` are already in the tour
  file's shape (a frame is a station with its story blocks, a step's
  `action` the file's own key), which `parseSettingsRecord` reads as the
  format reads a station.
- `parseSettingsRecord(text, against?)` - a stored record, or undefined
  when it does not read (a bad station pose or detail costs the record,
  never the objects beside it). `against` is the opened tour: its
  assets are what a story step may name (without it, a frame whose step
  names an asset is lost). The created frames and the `frames` are read
  one by one, in one pass, as the format reads a station
  (`parseTourManifest`, without free blocks, alone: a station names no other,
  so no frame depends on a sibling); of two under one id the first is
  kept. A frame that does not read is lost, and only it - the objects
  naming it are seated by the station rule as they come back. A `next`
  or a quiz `route` an older build stored is ignored by that reader, so
  it neither costs the frame nor survives the read.
  The format's reader drops a card image naming a captured photo not yet
  written (the probe holds no free blocks, and its assets are the opened
  tour's), so a well-formed `image` id of the record is put back on the
  frame it read from: a copied station's card showing its own copied
  photo comes back with it. `deletedStations` and `order` keep the
  well-formed ids, once each.
  A record without the newer fields reads as before.
- `changedStations(wanted, against)` - the ids of `wanted`'s stations
  whose pose differs from `against`'s (by data, whatever its key order:
  `same-json.ts`); none without an opinion, none for a station `against`
  does not carry.
- `settingsRecord(state)` - the record as the document holds it: the
  details only once `detailsRecorded`, the station poses (every station's,
  in the document's order) only once `stationsRecorded`, the frames, the
  order and the stations gone only once `framesRecorded`
  (`recordedFrames`, `recordedOrder`, `stationsGoneSinceOpen`).
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
  among good ones costing only itself; a frame naming a broken sibling
  (a stored `next`, a quiz route) kept and read without the name; the
  codes record written when a code's
  text or the hand changes, not for the same codes, and never for a
  draft without `saveCodes`.
- `tour-document-stations-draft.test.ts` - the stations through the
  record and a restore: renamed, added, deleted,
  reordered, an item copied; only the edited frames recorded, an order
  only when needed, a recorded frame restored at the document's pose, an
  emptied automatic station a save dropped not recorded as deleted; a copied station's own photo as its card
  image (seen red with the image re-attach off); a frame with an image
  step read against the opened tour's assets and lost without them; a
  deleted station an object still names kept; a record of the earlier
  format restoring its poses.
- `tour-document-draft.property.test.ts` - over random broken frames,
  some naming a sibling as `next`: exactly the readable frames come
  back, in order, none carrying a `next`.
- `tour-document.property.test.ts` - any sequence of edits written to the
  records and restored over the opened tour gives back the same write.
- The record's reading and comparing, through both drafts:
  `editor/editor-draft.test.ts` and `creator-setup.test.ts` "the draft
  keeps a moved station's pose".
- Through the editor: `editor/editor-session.test.ts` (among them delete,
  download, undo, redo, then a reload that offers the delete again) and the
  parity contract `tour-document-parity.test.ts` (the draft records
  compared).
