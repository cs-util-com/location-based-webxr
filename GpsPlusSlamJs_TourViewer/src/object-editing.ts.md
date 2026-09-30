# object-editing.ts

## Purpose

Editing placed objects (authoring plan 2026-09-28-0953 §3.4, milestone
M4): the object list's actions - Edit text, Move to the reticle, Delete -
and the selection a tap in AR makes, over the creator's in-memory state.
Wired by `creator-setup.ts`, drawn by `object-list.ts`.

## Public API

- `authoringObjects(manifest, placed, deleted): AuthoringObject[]` - the
  tour's objects now: the manifest's, this device's records replacing
  theirs by id, new ones appended, deleted ids gone - exactly
  `applyObjectChanges` (the Finish's rule), plus per object `hosted`,
  `changed` and this device's entry (`placed`).
- `upsertPlaced(placed, entry)` - replace the entry with that id, or append.
- `wireObjectEditing(deps): ObjectEditing` - binds the list's handlers.
  - `render()` - redraw the list (cheap when nothing changed).
  - `select(id | null)` - a tap in AR (the id `object-pick.ts` returned).
  - `objects()` - `authoringObjects` over the live state.
  - `reset()` - a visit ended or a tour closed: selection and note go.
- `ObjectEditingDeps` - the creator setup's state and callbacks: the
  session object, the store, the view, the world group, `sessionLive`,
  `placementAllowed`, `settleInputs` (the level in hand, this visit's
  measurement and sighting, the GPS accuracy), the stored codes, the draft
  writes (`saveDraftObject`, `saveDraftDeletion`, `forgetDraftObject`),
  `syncPreviews` and `renderAuthorReadout`.

## Invariants & assumptions

- **One record per id.** An edit or a move of a hosted object puts a record
  with the SAME id into `ctx.placedObjects` (`upsertPlaced`), never a second
  entry: the serializer rejects duplicate ids, so a duplicate would make
  every later Finish throw.
- **A delete is a tombstone only when the manifest carries the id**
  (`ctx.deletedObjectIds`, written to the draft as `deleted:<id>`); an
  object that exists only on this device is dropped from the list and its
  draft files are removed.
- **A move takes the settle's alignment** (`planMove`, `visit-settle.ts`):
  corrected through the code when this visit saw a stored code (D10b), so
  a pin moved in a later visit lands where the code says. The entry keeps
  the new odometry pose and this visit, so the preview is rigid in AR and
  the visit's own settle recomputes it with the rest at the end.
- **Logged**: `tourAuthoring/objectEdited` (before, after, surface),
  `tourAuthoring/objectMoved` (before, after, the reticle in odometry, the
  basis, the visit and used alignments, the sighting, a refused correction,
  the zero), `tourAuthoring/objectDeleted` (the object, whether hosted,
  surface).
- **Async-UI rule** (CLAUDE.md): the edited or moved row shows its busy
  label ("Saving…", "Moving…") until the draft write settles, then the note
  says "Saved ..." or that this device could not save a backup copy. A
  delete removes the row at once and the note goes "Deleting ..." then the
  outcome. A write that throws counts as refused.
- **Refused while a Finish rebuilds** the zip: the rebuild has read the
  lists, so a change then would be in neither the zip nor the list.
- Edit text trims the text; an empty text changes nothing and says so.

## Examples

```ts
const editing = wireObjectEditing({ ctx, arStore, view /* ... */ });
editing.select(seams.pickObjectInView(targets)); // a tap in AR
editing.render(); // from the panel's render
```

## Tests

- `object-editing.test.ts` - `authoringObjects` (and a property that it
  lists exactly what `applyObjectChanges` writes), `upsertPlaced`.
- `authoring-settle.test.ts` "editing placed objects, through the composed
  setup" - hosted objects rendered and listed, an edit in place with its
  log, the in-progress and final states with a held and a refused draft
  write, a hosted delete as a tombstone, a local delete, a move through the
  code correction in a later visit, and the tap-select.
