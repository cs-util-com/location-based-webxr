# draft-edit-gate.ts

## Purpose

The edit gate of a page's draft question. While a draft of the open tour
is undecided (offered, or put off with "Not now"), every edit of the tour
document waits for the creator's answer instead of landing on top of the
draft. The page asks at the first edit that waits. A landed "Delete it"
lets the waiting edits through; Restore drops them first (each was built
from the document before the draft came back, and replayed after it
would write its old values over the draft's) and says to make the change
again; "Not now" drops them and says the change was not applied. Both
pages use it: the phone creator (`creator-draft.ts`, `present`) and the
desktop editor (`editor/draft-offer.ts`, wired in `editor/edit-main.ts`).

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
  - `drop(): number` - the waiting edits are dropped (none applied, each
    `landed` settles `null`); still holding, so the next edit asks
    again. Returns how many, so the page can say a change was lost.
  - `holding()`, `waiting()` - whether edits wait, and whether one waits
    now.
- `HeldEdit { kind: "held", landed }` and `isHeldEdit(value)` - `landed`
  resolves with `{ before }` (the root state just before the edit's own
  dispatch) once it is let through, or `null` once dropped.
- `DRAFT_GATE_PASSES` and `waitsForTheDraft(action)` - the classification
  (below).
- The words both pages say:
  - `DRAFT_EDIT_WAITS`, `DRAFT_EDIT_WAITS_IN_AR` - the question's words
    when an edit waits, said after the offer's own (in AR the placement
    note).
  - `DRAFT_EDIT_NOT_APPLIED` - after "Not now" dropped a waiting edit.
  - `DRAFT_EDIT_MAKE_AGAIN` - after Restore dropped one, appended to the
    restore's own line.
  - `DRAFT_DELETING` - "Delete it"'s label while it runs.
  - `DRAFT_BEING_READ` - an edit waits while the draft is still being
    read (the phone's note).

## Invariants & assumptions

- **What waits is a denylist:** every action of the tour document's slice
  waits, except the types named in `DRAFT_GATE_PASSES`, each with its
  reason: `opened` / `closed`, `restored` (the answer's own change),
  `undone` / `redone` (nothing of this open is in the history while the
  draft is undecided), the save's actions (a save writes the document,
  never the draft, so Save and Ctrl+S never wait), `newStationArmed`,
  `assetsAdded`, and the codes' actions (their record re-states the
  waiting draft's). A new action of the slice therefore waits unless
  someone names it as passing; a test walks every action creator and
  fails on one that is neither.
- **Not now cancels:** a waiting edit is never applied later. The page
  says so (`DRAFT_EDIT_NOT_APPLIED`, `DRAFT_EDIT_MAKE_AGAIN`).
- **`opened` / `closed` end the question:** holding stops and what waited
  is dropped, so nothing of one tour lands on the next.
- **Order:** `release` replays in the order the edits were made, each
  through the store's full dispatch (so the document's listener writes
  its draft records for it); `creator-document.ts` maps each replayed
  action back to the change that made it (`held`, `backedUp`).
- `ask` is called once per wait, not per edit: a second edit while one
  waits joins it silently.
- No state in the store: the gate is a resource of the page's draft
  question, and the offer's status (offered, put off, deleting) lives in
  the pages. **This is a deviation** from the workspace rule that
  workflow status is store state: it is kept because the offer's two
  pages hold it in two different shapes today. The follow-up is a draft
  status slice shared by both pages, with the gate's `hold` / `release` /
  `drop` run by its listener.

## Examples

```ts
const gate = store.draftGate;
gate.hold(() => showOffer(DRAFT_EDIT_WAITS));
const out = store.dispatch(
  tourDocumentActions.detailsChanged({
    details: { title: "X" },
    what: "a rename",
  }),
);
isHeldEdit(out); // true: not in the document yet
// Restore: the waiting rename was built before the draft came back.
const dropped = gate.drop(); // 1
store.dispatch(tourDocumentActions.restored(work));
gate.release(); // 0; the page says DRAFT_EDIT_MAKE_AGAIN
// or a landed "Delete it":
gate.release(); // 1: the rename lands on the file's tour
// or "Not now":
gate.drop(); // nothing applied; DRAFT_EDIT_NOT_APPLIED; the next edit asks again
```

## Tests

- `draft-edit-gate.test.ts` - pass-through while not holding, one ask per
  wait, restore/undo/non-edits passing, release in order, drop keeping
  the hold and returning its count, open/close dropping, the
  classification of every action creator (held or named as passing), a
  file use deleted / file replaced / asset optimized held, undo and redo
  changing nothing while undecided, and a property over random edits and
  put-offs (nothing lands before the answer, the last batch lands in
  order).
- `editor/draft-offer.test.ts` - the desktop's answers (Restore drops
  and says so, "Not now" drops and says so, "Delete it" replays, its
  progress and failure).
- `draft-shared-behaviour.test.ts` - the rule across both pages: a moved
  station plus a waiting caption edit, a renamed tour plus a waiting
  rename, a pin-text draft plus a waiting drag (each kept whole by
  Restore, the waiting edit dropped and said), "Delete it" letting the
  waiting edit through, and a property over random view / "Not now" /
  edit / Restore / "Delete it" / reopen sequences.
- `creator-setup.test.ts`, `ar-entry.test.ts` - the phone: the note while
  the draft is read, and the start of AR asking first.
