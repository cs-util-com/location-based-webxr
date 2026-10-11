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
  - the list's `step(1 | -1)` handler - the AR chooser: the next or
    previous object in list order, wrapping (Next from none is the first,
    Previous the last); same note rule as a tap.
  - `objects()` - `authoringObjects` over the live state.
  - `reset()` - a visit ended or a tour closed: selection and note go.
- `ObjectEditingDeps` - the creator setup's state and callbacks: the
  session object, the store, the view, the world group, `sessionLive`,
  `placementAllowed`, the optional `notePlaced` (a move is a new placement
  for the settle's per-moment alignment, D33), `settleInputs` (the level in hand, this visit's
  measurement and sighting, the GPS accuracy), the stored codes, the draft
  writes (`saveDraftObject`, `saveDraftDeletion`, `forgetDraftObject`,
  `forgetDraftDeletion`), `schedule` (the app's one-shot timer seam),
  `syncPreviews` and `renderAuthorReadout`.
- `OUTCOME_HOLD_MS` (8 000) - how long an outcome stands against a tap
  that only selects, and how long a delete's Undo is offered (see below).

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
  outcome. A write that refuses or throws is said, never swallowed.
- **Delete has an Undo, not a confirm** (M4 review #5). A confirm would
  cost every delete a second tap over the camera; an Undo costs nothing
  unless used. It is offered beside the delete's outcome for
  `OUTCOME_HOLD_MS`, on the page and in AR, and withdrawn when the hold
  ends, when any later note replaces the outcome (single-level undo: it
  undoes what the note says), when a Finish rebuilt the zip (the manifest
  advanced - the delete is applied) or when the visit or tour ends
  (`reset`). Undo puts the object back into the lists the Finish writes
  (an edit or a local placement at its old index, so the zip's order
  holds), the scene, the draft and the log
  (`tourAuthoring/objectDeleteUndone`). The draft gets the record first and
  loses the tombstone after, both in the id's queue: until the tombstone
  goes it outranks the record, so an Undo cut short leaves the object
  deleted rather than half restored. "Restoring ..." then "Restored ..." or
  the not-backed-up wording.
- **An outcome is held against a selecting tap** (M4 review #6). In AR
  every tap on the scene is a select, which used to clear the note at once
  - before it could be read. A note now stands for `OUTCOME_HOLD_MS`
    through selections; the next ACTION still replaces it at once.
- **Why 8 s** (`OUTCOME_HOLD_MS`). It rests on reading the outcome, then
  reaching its button. The outcomes run 8-17 words; at 150-250 words a
  minute that is 1.9-6.8 s, plus about 1-1.5 s to find and tap Undo with the
  phone held up - 3-8 s across that range, and 8 s covers its slow end
  (the 17-word refused-write outcome at 150 wpm). Common snackbar-with-
  action timings (4-10 s) sit around it. **What would reverse it**: creators
  reaching for Undo after it went (raise it, or keep Undo until the next
  action), or a held note read as describing the newly selected object
  (lower it).
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
  code correction in a later visit, and the tap-select; Undo of a hosted
  delete (list, scene, draft, log), of an edited hosted pin with its edit
  and of a local pin with its record, its expiry at `OUTCOME_HOLD_MS`,
  Delete's "Deleting…" and Move's "Moving…" with their refused (and
  throwing) writes, an outcome held through a selecting tap, and the
  chooser stepping (and wrapping) through every object to move one.
- `playwright-tests/object-editing.spec.js` - the page's Undo button and
  its withdrawal when the hold timer fires.
