# draft-edit-gate.ts

## Purpose

The edit gate of a page's draft question. While a draft of the open tour
is undecided (offered, or put off with "Not now"), every edit of the tour
document waits for the creator's answer instead of landing on top of the
draft. The page asks at the first edit that waits; Restore and a landed
"Delete it" let the waiting edits through after their own change; "Not
now" drops them. Both pages use it: the phone creator
(`creator-draft.ts`, `present`) and the desktop editor
(`editor/edit-main.ts`, `offerDraft`).

**Why:** an edit that landed on an undecided draft was the root of a
family of "live work wins" rules (poses carried along, records merged
station by station, ids spared by "Delete it"), and a declined rename,
reorder, deletion or character was still lost after "Not now" plus an
edit. With no edit ever landing on an undecided draft, the draft is
either restored whole or deleted whole, and every write after the answer
is the page's own.

## Public API

- `createDraftEditGate(): DraftEditGate` - one per store
  (`tour-viewer-session.ts`, `draftGate`), its middleware installed before
  the document's listener.
- `DraftEditGate`:
  - `middleware` - the Redux middleware. A held edit's dispatch returns a
    `HeldEdit` instead of the action, and reaches neither the reducer nor
    any listener.
  - `hold(ask)` - edits wait from now on. `ask` runs inside the first
    waiting edit's dispatch (again after each `drop`); it shows the
    question and must not dispatch.
  - `release(): number` - the answer was given: holding stops and the
    waiting edits are dispatched in their order. Returns how many.
  - `drop()` - the question put off: the waiting edits are dropped (none
    applied, each `landed` settles `null`); still holding, so the next
    edit asks again.
  - `holding()`, `waiting()` - whether edits wait, and whether one waits
    now.
- `HeldEdit { kind: "held", landed }` and `isHeldEdit(value)` - `landed`
  resolves with `{ before }` (the root state just before the edit's own
  dispatch) once it is let through, or `null` once dropped.
- `DRAFT_EDIT_WAITS`, `DRAFT_EDIT_WAITS_IN_AR` - the question's words when
  an edit waits, said after the offer's own (in AR the placement note).

## Invariants & assumptions

- **What waits:** every `isDocumentEdit` action except `restored` (the
  answer's own change), `undone` and `redone` (with every edit held there
  is nothing of this open to take back). Code changes are not document
  edits and are not held.
- **`opened` / `closed` end the question:** holding stops and what waited
  is dropped, so nothing of one tour lands on the next.
- **Order:** `release` replays in the order the edits were made, each
  through the store's full dispatch (so the document's listener writes
  its draft records for it); `creator-document.ts` maps each replayed
  action back to the change that made it (`held`, `backedUp`).
- `ask` is called once per wait, not per edit: a second edit while one
  waits joins it silently.
- No state in the store: the gate is a resource of the page's draft
  question, and the offer's status lives in the pages (no draft status
  slice exists).

## Examples

```ts
const gate = store.draftGate;
gate.hold(() => showOffer(DRAFT_EDIT_WAITS));
const out = store.dispatch(tourDocumentActions.detailsChanged({ title: "X" }));
isHeldEdit(out); // true: not in the document yet
// Restore:
store.dispatch(tourDocumentActions.restored(work));
gate.release(); // 1: the rename lands after the draft
// or "Not now":
gate.drop(); // nothing applied; the next edit asks again
```

## Tests

- `draft-edit-gate.test.ts` - pass-through while not holding, one ask per
  wait, restore/undo/non-edits passing, release in order, drop keeping
  the hold, open/close dropping, and a property over random edits and
  put-offs (nothing lands before the answer, the last batch lands in
  order).
- `draft-shared-behaviour.test.ts` - the rule across both pages with
  random view / "Not now" / edit / Restore / "Delete it" / reopen
  sequences.
