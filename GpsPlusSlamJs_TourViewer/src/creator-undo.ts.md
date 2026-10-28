# creator-undo.ts

## Purpose

The persistent Undo of the creator's AR action strip: one chip, `#setup-undo`, that takes back the
tour document's last step when that step is one the page offered - a
delete, or a settle that changed a stored code automatically, together
with the stations and objects it moved (one step).
It says what it will take back.

## Public API

- `UNDO_IDLE` ("Undo"), `UNDO_BUSY` ("Undoing…") - the chip's words with
  nothing to take back, and while a tap's draft writes run.
- `UndoOffer` - `{ target, run }`: `target` is what a tap takes back in
  words (`delete "Gate"`, "the code's improvement"); `run()` takes it back
  and returns a promise that settles once its draft writes did (true: all
  landed), or null when it took nothing back (refused - `run` says why in
  words itself).
- `undoChipText(target, busy) -> string` - "Undo: <target>", "Undo" for
  none, "Undoing…" while busy.
- `SettleCodeChange` - `"improvement" | "move" | null`: how a settle
  changed one code's saved text (null: only re-minted from this visit's
  own measurement, or re-applied after a failed Finish).
- `settleUndoTarget(changes) -> string | null` - the settle step's name:
  one automatic change by its kind ("the code's improvement", "the
  code's move"), several by their count ("the 2 codes' new positions");
  a re-minted code (null) is not counted; null - no offer - when no
  automatic change is among them.
- `undoSettle({ tour, target, visit, settledVisit, written, log, changed,
say })` - the run of a settle's offer: the document's undo, the
  `tourAuthoring/settleUndone` log (the visit of the tap, the visit whose
  settle took the step, and the codes, frames and objects that went
  back), `changed()` (the page brings the scene, the earlier objects'
  frames and the readout along, and forgets the settle's per-code
  records), then `say` names what was undone once the draft writes
  settled:
  - what actually went back: "Undone: the code's improvement - the code
    and everything that moved with it are back where they were." (the
    codes, for several), or, when none of its codes went back (one
    changed since), "... - the stations and objects it moved are back, but
    the code changed since and keeps its newer position.";
  - the not-backed-up wording when a draft write did not land;
  - "The next Finish saves this in the zip." added when `written()` - a
    Finish wrote the tour since the settle, so the saved zip still has
    the change.
  - A refusal (a Finish rebuilds, a photo's picture is gone) is said and
    returns null.
- `wireCreatorUndo({ tour, dom: { button, label }, locked, hidden })` ->
  `{ offer, target, render, withdraw, reset }`:
  - `offer(o)` - a step was just taken; the offer stands while the
    document's `generation` and `revision` stay what they were now, and
    every code the document's last step sets still holds the text it set.
    Replaces any earlier offer.
  - `target()` - what a tap would take back now, or null.
  - `render()` - the chip's label, `disabled` and `hidden` (the readout's
    render calls it).
  - `withdraw(o)` - `o` no longer stands (a failed Finish forgot the
    settle it names, `creator-setup.ts`): it goes if it is the one
    offered; a later offer stays.
  - `reset()` - a tour closed.

## Decisions, and why

- **What it undoes: a delete, or a settle's automatic code change - not
  every step.** These are the two kinds of step it offers. The
  phone's other steps stay out on purpose: a move in AR keeps the visit's
  odometry placement beside the document (`creator-document.ts` side
  table), so an undone move would be re-applied by the visit's own settle
  at its end; a placement, an edit and a draft restore have their own
  controls (Delete, Edit, "Delete it"). A step that is not offered leaves
  the chip disabled, because the document's undo takes back only its LAST
  step - a delete before it is not reachable without taking that step
  back first. For the same reason no "place a pin and undo it" e2e
  exists: a placement is not offered.
- **A settle is offered only when it changed a stored code automatically**
  (an improvement or a move, the decisions of `code-position-rule.ts` and
  `code-spots.ts`). A settle that only refined this visit's own fresh
  measurement (no decision) is no "automatic code improvement", and taking it back would put the visit's pins at their less
  accurate tap-time positions under a name a creator would not recognise.
  A decision re-applied by a settle redone after a failed Finish is no new
  change either. A code-spot move back is never offered: the code-spot
  rule writes it before the settle's step, outside the history.
- **Enablement: only while the offered step is the document's last one,
  from this page.** The callers offer a step at the moment they take it;
  any later change (the revision) or another open (the generation)
  withdraws it, and so does a code of the step that no longer holds the
  text the step set - a code changes without a step of its own (the
  code-spot rule's confirmation writes the book), and the document's undo
  would then leave it while the tap said it was back. The tap checks
  again (a change that rendered nothing may land between the render and
  the tap). A failed Finish that forgets its visit's settle withdraws that
  settle's offer (`withdraw`). "From this page": nothing is offered after
  a reload (the page remembers nothing across a reload), so a
  restored draft's step is never offered. Disabled while a Finish
  rebuilds (the document refuses an undo then, `canStep`).
- **Persistent, single level.** The offer outlives the note's 8 s hold and
  AR visits: a settle lands at a visit's END, so the strip offers it in
  the next visit (or at once after a Finish settled the running visit).
  After a tap nothing further is offered (no Redo: not required, and a
  redo of a settle does not re-take the hand, `creator-codes.ts`). A tap
  the document refused keeps the offer: the chip stays as it was, and the
  note says why.
- **Hidden in object mode.** While a selected object's actions replace
  the strip the chip is hidden, like
  the strip's other chips: object mode gives the bottom of the screen to
  the selected object's actions, and one chip left among them would read
  as one of them. The offer stays and comes back with the strip.
- **Label: what it takes back.** "Undo: delete "Gate"" (the pin's quoted
  text, or "the photo"), "Undo: the code's improvement"; "Undo" with
  nothing. The chip has a line of its own, so a long pin text ends in an
  ellipsis (CSS) while the accessible name stays whole.
- **One Undo path in AR.** The delete's note keeps its outcome sentence,
  but in AR its own Undo button is not shown (`object-editing.ts`): the
  strip's chip is the one Undo there. On the page (no strip: the AR
  controls are the session's) the note's Undo stays, for its hold. Both
  run the same `undoDelete`, under the same revision rule, so they can
  never take back two different things.
- **After an undo:** the hand lets go of the codes taken back (the
  `creator-codes.ts` listener); the list's note names what was undone
  ("Restored "Gate"." for a delete, "Undone: the code's improvement - ..."
  for a settle) and a delete's late outcome no longer overwrites it; the
  settle's per-code records go with it (`creator-settle.ts`
  `settleUndone`), so the Finish's result line does not report an
  improvement the creator took back.
- **Async-UI rule:** "Undoing…" (disabled) until the tap's draft writes
  settle, then "Undo"; a write that did not land is said in the note.

## Invariants & assumptions

- The chip never runs an offer whose step is not the document's last one:
  `generation`, `revision` and the step's codes are compared at render AND
  at the tap.
- `run` is called at most once per tap; the offer is cleared before it
  runs and put back only when the run was refused.
- The offer and the busy flag live in the wiring's closure, not in the
  store: a callback guarded by the document's generation and revision,
  read by one view - the same as `object-editing.ts`'s note Undo.
- No DOM is read; the DOM is written only when a value changes.
- Hidden in object mode (a selected object's actions take the strip's
  place) and while the pin's text is typed (CSS).

## Known gaps

Filed as follow-ups:

- A settle undone and then settled AGAIN in the same visit (a Finish that
  failed, `unsettle`) is judged afresh and may make the same change again.
- The visit log entry of the undone settle's visit, already in the draft,
  still names a code it moved (the summary's move boundary).
- `settleUndone` leaves the visit's settle record (`visitSettles`) in
  place, so a late photo of the undone visit still settles through its
  code-corrected record.
- A code-spot move back is outside the history (above).
- No Redo.

## Examples

```ts
const undo = wireCreatorUndo({
  tour: ctx.tourDocument,
  dom: { button: element("setup-undo"), label: element("setup-undo-label") },
  locked: () => ctx.finishing,
  hidden: () => editing.selected() !== null,
});
undo.offer({ target: 'delete "Gate"', run: () => undoDelete(deleted) });
```

## Tests

- `creator-undo.test.ts` - the words; enablement and withdrawal (a later
  change, another open, a code of the step rewritten, a withdrawal by
  name, a Finish, object mode, a reset); a tap runs only the last offer,
  once, and nothing after an unrendered change; a refused run keeps the
  offer; the busy state on success, failure and rejection; a property over
  any order of offers, changes, opens, taps and refused taps.
- `authoring-settle.test.ts` - through the composed setup: a delete in AR
  offered in the strip past the note's hold and taken back (list, scene,
  draft, log); withdrawn by a later change; "Undoing…" and the refused
  write; a deleted photo whose picture is gone (the note's words, the
  offer kept); a delete's late outcome after the undo; the note's Undo
  kept on the page; a settle's improvement offered at the next visit and
  taken back in one tap (code, station, pins, hand, the log with both
  visits); withdrawn by a placement and by a later confirmation of the
  code; withdrawn by a failed Finish, and no offer for the re-settle; no
  offer for a fresh measurement's settle; the settle's busy and refused
  states; the wording when no code went back, and after a Finish wrote
  the change; the Finish's result line after the undo, against the same
  flow without it.
- `playwright-tests/object-editing.spec.js`, `code-auto-move.spec.js` -
  the composed page in AR: a delete and an automatic move taken back from
  the strip, the code's saved position back in the next Finish's zip.
  `ar-layout.spec.js` - the chip's place in H1 (the camera view clear from
  its top) and a long label at 390 and 320 px in a wide face.
