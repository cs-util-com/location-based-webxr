# draft-actions.ts

## Purpose

The writes a page's draft offers for its objects (M6 E2c): the shape the
tour document's draft-following (`tour-document-draft.ts`
`followDocument`) issues on both pages, and the phone's builder of it over
`creator-draft.ts`. The ORDER that keeps an undo cut short from half
restoring an object is `followDocument`'s (the record, then the
tombstone); the records are `draft-persistence.ts`'s. The gesture
sequences that used to live here (`recordDelete`, `recordUndoDelete`)
went when both pages adopted the document (the r880 milestone review
LOW-4).

## Public API

- `DraftObjectWrites` - `saveObject(object, blob?)` (a record with its
  base), `saveDeletion(id)` (a tombstone), `forgetDeletion(id)` (an Undo's
  tombstone removal), each resolving whether it landed; `forgetObject(id)`
  (a local record dropped, reports nothing).
- `draftObjectWrites(draft)` - the four over a draft that queues tasks per
  id (`write(id, task)`), writes a record with its base (`writeObject`) and
  forgets a record (`forgetObject`): the phone's `creator-draft.ts`. The
  tombstone tasks are `writeDraftDeletion` / `removeDraftDeletion`.

## Invariants & assumptions

- The caller's draft queues writes per object id (`keyed-chain.ts`), so
  issuing the record before the tombstone removal is what lands them in
  that order; the tombstone outranks a record (`readDraft`), so an undo cut
  short leaves the object deleted, not half restored (M4 review #5).
- An undo of a delete of an EDITED note writes its record again: the
  tombstone write removed it (E2c plan review #11).
- A rejected write reads as `false`, never as a rejection: the pages show
  "not backed up", never a failed tap.

## Examples

```ts
const writes = draftObjectWrites(draft);
followDocument(writes, before, after, pictureOf); // tour-document-draft.ts
```

## Tests

`draft-actions.test.ts`: the builder's tombstone tasks through a store.
The order of a delete's and an undo's writes is `followDocument`'s
(`tour-document-draft.test.ts`); the phone's composed suites
(`creator-setup.test.ts`, `authoring-settle.test.ts`) run it through
`object-editing.ts`.
