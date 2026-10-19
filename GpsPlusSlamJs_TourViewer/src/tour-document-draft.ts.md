# tour-document-draft.ts

**Purpose:** what a page's draft writes when the tour document
(`tour-document.ts`) changes: the writes follow the STATE, not the
gesture. A page registers `followDocument` as a Redux listener (the
store's listener middleware, `createTourViewerStore`'s
`listenToDocument`) for the actions `isDocumentEdit` names; it runs
after the reducer, never from `store.subscribe`.

## Public API

- `TourSettingsRecord` - `{ needsNoGps, details?, stations? }` (`stations`:
  `StationPose[]`, each station's `{ id, geo }`), the draft's settings
  record (`editor/editor-draft.ts`'s `EditorTourSettings` has the same
  shape).
- `TourDocumentDraft` - `DraftObjectWrites` (`draft-actions.ts`) plus
  `saveSettings(record)`.
- `SETTINGS_KEY` (`"settings"`) - the record's file in a draft
  namespace, on both pages; `readDraft` skips it.
- `parseSettingsRecord(text)` - a stored record, or undefined when it does
  not read (a bad station pose or detail costs the record, never the
  objects beside it).
- `changedStations(wanted, against)` - the ids of `wanted`'s stations
  whose pose differs from `against`'s; none without an opinion, none for a
  station `against` does not carry.
- `settingsRecord(state)` - the record as the document holds it: the
  details only once `detailsRecorded`, the station poses (every station's,
  in the document's order) only once `stationsRecorded`.
- `followDocument(draft, before, after, pictureOf)` - issues, in order,
  each id's writes for its change of standing against the written file
  (an entry, a tombstone, or nothing), then the settings record when it
  changed. Writes nothing when `before` and `after` belong to different
  opens (`generation`).

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
  or across an open.
- The record's reading and comparing, through both drafts:
  `editor/editor-draft.test.ts` and `creator-setup.test.ts` "the draft
  keeps a moved station's pose".
- Through the editor: `editor/editor-session.test.ts` (among them delete,
  download, undo, redo, then a reload that offers the delete again) and the
  parity contract `tour-document-parity.test.ts` (the draft records
  compared).
