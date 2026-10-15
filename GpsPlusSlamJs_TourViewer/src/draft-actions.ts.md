# draft-actions.ts

## Purpose

What a delete and an undo write to a page's draft (M6 E2c, the E2c plan
review #4): one home for the sequences the phone's object list
(`object-editing.ts`) and the desktop editor (`editor/editor-session.ts`)
both run, so the two pages cannot disagree about the order that keeps an
undo cut short from half restoring an object (root `CLAUDE.md` DEC-H3).
The writes are each page's own draft's (`creator-draft.ts`,
`editor/editor-draft.ts`); the records are `draft-persistence.ts`'s.

## Public API

- `DraftObjectWrites` - `saveObject(object, blob?)` (a record with its
  base), `saveDeletion(id)` (a tombstone), `forgetDeletion(id)` (an Undo's
  tombstone removal), each resolving whether it landed; `forgetObject(id)`
  (a local record dropped, reports nothing).
- `draftObjectWrites(draft)` - the four over a draft that queues tasks per
  id (`write(id, task)`), writes a record with its base (`writeObject`) and
  forgets a record (`forgetObject`): the phone's `creator-draft.ts`. The
  tombstone tasks are `writeDraftDeletion` / `removeDraftDeletion`.
- `recordDelete(writes, id, hosted)` - a hosted object's tombstone, else
  the record goes; whether it landed, never rejects.
- `recordUndoDelete(writes, undone)` - the record first (when the page had
  one: an edited or placed object's, with a photo's bytes), then the
  tombstone goes (when hosted); both ISSUED synchronously in that order;
  whether both landed, never rejects.
- `UndoneDelete` - `{ object: { id }, placed: { object, blob? } | null,
hosted }`, which `object-edits.ts`'s `DeletedRecord` satisfies.

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
void recordDelete(writes, id, found.hosted).then((ok) =>
  say(ok ? done : notBackedUp),
);
void recordUndoDelete(writes, gone.record);
```

## Tests

`draft-actions.test.ts`: a hosted delete's tombstone and a local
delete's forget; a failed or thrown write is false; the undo's order (record,
then tombstone) and its outcomes; the builder's tombstone tasks through a
store. The phone's composed suites (`creator-setup.test.ts`,
`object-editing.test.ts`, `authoring-settle.test.ts`) run the same sequences
through `object-editing.ts`.
