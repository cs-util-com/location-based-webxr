# object-edits.ts

## Purpose

What an edit and a delete do to the lists a Finish writes (Tour
Viewer M6 E0c): the rules the phone's object list (`object-editing.ts`)
used inline, lifted so the desktop editor (`src/editor/`) applies the same
ones - the E2 plan review's #8 (root `CLAUDE.md` DEC-H3). Pure, generic
over the page's own entry type (`EditEntry`: an object, and whatever the
page keeps with it - a photo's bytes, a visit's frame).

## Public API

- `authoringObjects(manifest, placed, deleted)` - the tour's objects now:
  the manifest's, the page's replacing them by id, new ones appended,
  deleted ones gone (`applyObjectChanges`), each with `hosted` (the opened
  zip carries its id), `changed` and its `placed` entry.
- `upsertPlaced(placed, entry)` - replace by id in place, or append.
- `pinTextEdit(object, text)` - `{ kind: "edited", after }` for a pin's new
  trimmed text; `{ kind: "unchanged" }` for the same text or a photo (its
  caption is creator-facing only today, owner question Q-E2-1);
  `{ kind: "refused", reason }` for an empty pin - the manifest serializer
  rejects an empty label, so a save would throw.
- `deleteObject(lists, found)` - the page's entry goes; a hosted object
  gets a tombstone in `deleted`, a local one none; returns the lists. An
  undo is the tour document's (`tour-document.ts`: it goes back to the
  view before the delete), so no record of the delete is kept here.
- `moveObjectTo(object, lat, lon)` - a map move keeping height and facing
  (a pin's `headingDeg`, a photo's world-frame rotation); throws a
  `RangeError` for a position off the globe.
  A longitude past 180 (a drag on one of the map's world copies) is
  folded back onto the globe; a non-finite one, or a latitude past 90, is
  refused (PR #611 review).
- `EditEntry`, `AuthoringObject<P>`, `EditLists<P>`.

## Invariants & assumptions

- Every function returns new arrays; nothing is mutated.
- A delete takes exactly its entry, keeps the others' order and the
  earlier deletions, and tombstones only a hosted object (the property
  test).

## Examples

```ts
const objects = authoringObjects(manifest.objects, placed, deleted);
const gone = deleteObject({ placed, deleted }, objects[0]!);
```

## Tests

`object-edits.test.ts`: a pin's text edited, refused when empty, left
alone when the same or a photo's; a hosted delete's tombstone, a local
delete without one; the delete property; a map move keeping height and
facing, and refusing a position off the globe; `upsertPlaced`.
`object-editing.test.ts` still pins the list functions through the phone's
wiring.
