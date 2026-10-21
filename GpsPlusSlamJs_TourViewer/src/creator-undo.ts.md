# creator-undo.ts

## Purpose

The persistent Undo of the creator's AR action strip (owner decision W-D4
of the visitor-walk prototypes plan, answering Q-J of the debug-captures
plan): one chip, `#setup-undo`, that takes back the tour document's last
step when that step is one the page offered - a delete, or a settle that
changed a stored code automatically, together with the stations and
objects it moved (one step since plan M3b, Q-D). It says what it will
take back.

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
- `SettleCodeChange` - `"improvement" | "move" | "move-back" | null`: how
  a settle changed one code's saved text (null: only re-minted from this
  visit's own measurement).
- `settleUndoTarget(changes) -> string | null` - the settle step's name:
  one code by its change ("the code's improvement", "the code's move",
  "the code's move back"), several by count ("the 2 codes' new
  positions"); null - no offer - when no automatic change is among them.
- `undoSettle({ tour, target, visit, log, changed, say })` - the run of a
  settle's offer: the document's undo, the `tourAuthoring/settleUndone`
  log (the codes, frames and objects that went back), `changed()` (the
  page brings the scene, the earlier objects' frames and the readout
  along, and forgets the settle's per-code records), then `say` names
  what was undone once the draft writes settled ("Undone: the code's
  improvement - the code and everything that moved with it are back where
  they were.", or the not-backed-up wording). A refusal (a Finish
  rebuilds) is said and returns null.
- `wireCreatorUndo({ tour, dom: { button, label }, locked, hidden })` ->
  `{ offer, target, render, reset }`:
  - `offer(o)` - a step was just taken; the offer stands while the
    document's `generation` and `revision` stay what they were now.
    Replaces any earlier offer.
  - `target()` - what a tap would take back now, or null.
  - `render()` - the chip's label, `disabled` and `hidden` (the readout's
    render calls it).
  - `reset()` - a tour closed.

## Decisions (W-D4), and why

- **What it undoes: a delete, or a settle's automatic code change - not
  every step.** The owner named these two. The phone's other steps stay
  out on purpose: a move in AR keeps the visit's odometry placement beside
  the document (`creator-document.ts` side table), so an undone move would
  be re-applied by the visit's own settle at its end; a placement, an
  edit and a draft restore have their own controls (Delete, Edit, "Delete
  it"). A step that is not offered leaves the chip disabled, because the
  document's undo takes back only its LAST step - a delete before it is
  not reachable without taking that step back first.
- **A settle is offered only when it changed a stored code automatically**
  (an improvement, a move, a move back - the decisions of
  `code-position-rule.ts` and `code-spots.ts`). A settle that only refined
  this visit's own fresh measurement (no decision) is no "automatic code
  improvement" (Q-D's wording), and taking it back would put the visit's
  pins at their less accurate tap-time positions under a name a creator
  would not recognise.
- **Enablement: only while the offered step is the document's last one,
  from this page.** The callers offer a step at the moment they take it;
  any later change (the revision) or another open (the generation)
  withdraws it, and the tap checks again (a change that rendered nothing
  may land between the render and the tap). "From this page": nothing is
  offered after a reload (Q-E/Q-H: the page remembers nothing across a
  reload), so a restored draft's step is never offered. Disabled while a
  Finish rebuilds (the document refuses an undo then, `canStep`).
- **Persistent, single level.** The offer outlives the note's 8 s hold and
  AR visits: a settle lands at a visit's END, so the strip offers it in
  the next visit (or at once after a Finish settled the running visit).
  After a tap nothing further is offered (no Redo: not required, and a
  redo of a settle does not re-take the hand, `creator-codes.ts`).
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
  `creator-codes.ts` listener, already built); the list's note names what
  was undone ("Restored "Gate"." for a delete, "Undone: the code's
  improvement - ..." for a settle); the settle's per-code records go with
  it (`creator-settle.ts` `settleUndone`), so the Finish's result line does
  not report an improvement the creator took back.
- **Async-UI rule:** "Undoing…" (disabled) until the tap's draft writes
  settle, then "Undo"; a write that did not land is said in the note.

## Invariants & assumptions

- The chip never runs an offer whose step is not the document's last one:
  `generation` and `revision` are compared at render AND at the tap.
- `run` is called at most once per offer; the offer is cleared before it
  runs.
- No DOM is read; the DOM is written only when a value changes.
- Hidden in object mode (a selected object's actions take the strip's
  place) and while the pin's text is typed (CSS).

## Known gaps (filed)

- A settle undone and then settled AGAIN in the same visit (a Finish that
  failed, `unsettle`) is judged afresh and may make the same change again.
- The visit log entry of the undone settle's visit, already in the draft,
  still names a code it moved (the summary's move boundary).

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
  change, another open, a Finish, object mode, a reset); a tap runs only
  the last offer, once, and nothing after an unrendered change; the busy
  state on success, failure and rejection; a property over any order of
  offers, changes, opens and taps.
- `authoring-settle.test.ts` - through the composed setup: a delete in AR
  offered in the strip past the note's hold and taken back (list, scene,
  draft, log); withdrawn by a later change; "Undoing…" and the refused
  write; the note's Undo kept on the page; a settle's improvement offered
  at the next visit and taken back in one tap (code, station, pins, hand,
  log); withdrawn by a placement; no offer for a fresh measurement's
  settle; the settle's busy and refused states; the Finish's result line
  after the undo.
- `playwright-tests/object-editing.spec.js`, `code-auto-move.spec.js` -
  the composed page in AR: a delete and an automatic move taken back from
  the strip. `ar-layout.spec.js` - the chip's place in H1 and a long label
  at 390 and 320 px in a wide face.
