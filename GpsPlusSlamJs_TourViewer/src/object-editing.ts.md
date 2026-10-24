# object-editing.ts

## Purpose

Editing placed objects (authoring plan 2026-09-28-0953 §3.4, milestone
M4): the object list's actions - Edit text, Move to the reticle, Delete -
and the selection a tap in AR makes. The model is the shared tour
document (`tour-document.ts`) through the page's handle
`ctx.tourDocument` (`creator-document.ts`): an edit, a move and a
delete are its actions, an Undo is its undo - the desktop editor's rules,
draft writes and history. Wired by `creator-setup.ts`, drawn by
`object-list.ts`.

## Public API

- `AuthoringObject` - one object as the creator sees it now (the
  document's `CreatorObject`: `documentObjects` with this page's entry
  joined). The rule for a pin's text (`pinTextEdit`, `object-edits.ts`)
  is asked through the document (`pinTextChange`, `tour-document.ts`), as
  the desktop editor asks it; this file wires the
  document to the store's log, the scene and the list's sentences.
- `wireObjectEditing(deps): ObjectEditing` - binds the list's handlers.
  - `render()` - redraw the list (cheap when nothing changed).
  - `select(id | null)` - a tap in AR (the id `object-pick.ts` returned).
  - the list's `deselect()` handler - the row's Close: clears the selection, same
    note rule as a tap (polish round M3; the Previous / Next chooser is
    gone).
  - `selected()` - the selected id or null; `deps.selectionChanged` is
    told after a tap or Close changed the selection, so the place buttons
    follow object mode. A delete and `reset` do not tell it (`reset` runs
    inside a visit's teardown, M3 review #14); the next render catches up.
  - `objects()` - the document's objects now.
  - `reset()` - a visit ended or a tour closed: selection and note go.
  - `announce(text)` - show `text` as the list's outcome, held as an
    action's is: what the AR strip's Undo of a settle undid
    (`creator-undo.ts`).
- `NOT_BACKED_UP` - the shared "this device could not save a backup copy"
  tail, also `creator-undo.ts`'s.
- `ObjectEditingDeps` - the creator setup's state and callbacks: the
  session object, the store, the view, the world group, `sessionLive`,
  `placementAllowed`, the optional `notePlaced` (a move is a new placement
  for the settle's per-moment alignment, D33), `settleInputs` (the level in hand, this visit's
  measurement and sighting, the GPS accuracy), the stored codes, the
  optional `loadPicture` (a hosted photo's picture from the open file,
  kept at its delete so an Undo after a Finish can bring it back), `schedule`
  (the app's one-shot timer seam), `syncPreviews` and
  `renderAuthorReadout`; the optional `offerUndo`
  is handed each delete at once, as an `UndoOffer` named `delete <name>`
  whose run is the same `undoDelete` as the note's. No draft writes: the document's listener writes
  the draft (`creator-document.ts` `follow`), and each change's
  `backedUp` says whether they landed.
- `OUTCOME_HOLD_MS` (8 000) - how long an outcome stands against a tap
  that only selects, and how long a delete's Undo is offered (see below).

## Invariants & assumptions

- **One record per id**, held by the document: an edit or a move of a
  hosted object is the slice's `edited` / `moved`, which replace the
  record with the SAME id (the serializer rejects duplicate ids).
- **A delete is a tombstone only when the written tour carries the id**
  (the slice's `deleted`; the draft gets `deleted:<id>`); an object that
  exists only on this device is dropped and its draft files are removed.
- **The slice's guards answer first** (`objectFits` for an edit or a
  move): a refused change is said in words ("could not be changed here",
  "That spot is too far from its station"), never applied.
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
  undoes what the note says), when the document changed after the delete
  (another open, or any later change: the document's undo takes back the
  LAST step) or when the visit or tour ends (`reset`). A Finish's write
  itself changes no revision, so on the page the Undo outlives it while its
  hold lasts, as on the desktop (the parity row "delete, save, undo the
  delete, save"). In AR a Finish first settles the running visit
  (`settleVisit`), and a re-pose that moves an object is a later change
  that withdraws it (one that moves nothing is no step, the document's
  `putObject`). The tap checks again (`stillUndoable`): a change that
  rendered nothing since the button was shown makes it take back nothing. The Undo is the document's
  `undone`: the object comes back at its old place in the tour, into the
  scene, the draft (the listener: the record first, the tombstone after,
  both in the id's queue - an Undo cut short leaves the object deleted
  rather than half restored) and the log
  (`tourAuthoring/objectDeleteUndone`). **In AR the note shows no Undo of
  its own**: the strip's persistent Undo
  (`creator-undo.ts`), offered the same delete at once, is the one Undo
  there and outlives the hold; on the page the note's Undo stays. Both run
  `undoDelete` under the same revision rule, so they cannot take back two
  different things. Refused in words while a Finish
  writes (`canStep`) and for a photo whose picture this device no longer
  holds. "Restoring ..." then "Restored ..." or the not-backed-up wording.
  A delete's own outcome ("Deleted ...") is said only while the delete
  is still the document's last step: the strip's Undo may take it back
  before its draft write lands, and its note must not be overwritten.
  A write that did not land is still said after that, without an Undo:
  "The delete of <name> could not be backed up: <NOT_BACKED_UP>"
  (`authoring-settle.test.ts`).
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
  document, so a change then would be in neither the zip nor the list.
- Edit text trims the text; an empty text changes nothing and says so.

## Examples

```ts
const editing = wireObjectEditing({ ctx, arStore, view /* ... */ });
editing.select(seams.pickObjectInView(targets)); // a tap in AR
editing.render(); // from the panel's render
```

## Tests

- `object-editing.test.ts` - `authoringObjects` (and a property that it
  lists exactly what `applyObjectChanges` writes), `upsertPlaced` (the
  shared list functions the document builds on).
- `tour-document-parity.test.ts` - the phone's edit, delete and undo
  write what the desktop's do, an undo after a Finish included.
- `authoring-settle.test.ts` "editing placed objects, through the composed
  setup" - hosted objects rendered and listed, an edit in place with its
  log, the in-progress and final states with a held and a refused draft
  write, a hosted delete as a tombstone, a local delete, a move through the
  code correction in a later visit, and the tap-select; Undo of a hosted
  delete (list, scene, draft, log), of an edited hosted pin with its edit
  and of a local pin with its record, its expiry at `OUTCOME_HOLD_MS`,
  Delete's "Deleting…" and Move's "Moving…" with their refused (and
  throwing) writes, an outcome held through a selecting tap, and the
  Close letting the selection go with the place buttons back
  (`authoring-settle.test.ts`).
- `playwright-tests/object-editing.spec.js` - the page's Undo button and
  its withdrawal when the hold timer fires.
