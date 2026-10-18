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
    page had goes (`forgetObject`);
  - now an entry: its record (`saveObject`, with the page's picture for a
    photo, `pictureOf`) unless the content is the same, THEN a tombstone
    goes - the record first, so an undo cut short leaves the object
    deleted rather than half restored (M4 review #5).
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
  an edited object's delete (record before tombstone), a photo's picture,
  the settings record with and without details, the station poses once a
  station moved (review #1), nothing for a save landing
  or across an open.
- Through the editor: `editor/editor-session.test.ts` and the parity
  contract `tour-document-parity.test.ts` (the draft records compared).
