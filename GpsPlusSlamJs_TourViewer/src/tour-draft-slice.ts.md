# tour-draft-slice.ts

## Purpose

The open tour's draft question in the page's store, one slice for both
pages that edit a tour: the phone page (`creator-draft.ts`) and the
desktop editor (`editor/draft-offer.ts`, started by `edit-main.ts`).
Both render the offer, "Delete it"'s progress and the note that an edit
waits from its selectors, so the question has one shape and one set of
rules, whichever page asks it.

## Public API

- `tourDraftReducer` - mounted as `tourDraft` by `createTourViewerStore`
  (`tour-viewer-session.ts`).
- `tourDraftActions`:
  - `readStarted()` - a new question: the open tour's draft is read.
    Moves `generation`.
  - `questionEnded()` - the question ends without a tour closing (the
    phone's teardown). Moves `generation`. `tourDocument/closed` does the
    same.
  - `found({ generation, text })` - the read found a draft to offer, in
    these words. Only while `reading`.
  - `noneFound({ generation })` - the read found nothing to offer. Only
    while `reading`.
  - `unavailable({ generation, reason })` - no draft can be kept:
    `storage` (no storage in this browser), `other-tab` (another tab
    holds the tour's draft), `read-failed` (the read threw). Never over
    an undecided offer.
  - `restored({ generation })` - Restore. From `offered` or `declined`,
    not while "Delete it" runs.
  - `declined({ generation })` - "Not now": the offer is hidden, the
    draft still undecided. From `offered` only.
  - `reshown({ generation })` - a put-off offer shows again (the phone's
    AR start asks first).
  - `deleteStarted({ generation })` / `deleteEnded({ generation, landed })`
    - "Delete it" runs; landed, the question ends in `none`; not landed,
      the offer stays with every answer on again.
  - `editsWaitingChanged({ count })` - the edit gate's count of waiting
    edits (`draft-edit-gate.ts` dispatches it). A first waiting edit
    shows a put-off offer again.
- Selectors:
  - `selectTourDraft(state)` - the slice.
  - `selectDraftUndecided(state)` - `offered` or `declined`: an edit then
    waits for the answer.
  - `selectDraftOffer(state)` - `{ text, waits, deleting }` while the
    offer shows, else null. Each page appends its own waiting line
    (`DRAFT_EDIT_WAITS`) when `waits`.
  - `selectEditWaitsForRead(state)` - an edit waits for a draft still
    being read (the page says `DRAFT_BEING_READ`).
- `TourDraftState` - `{ status, reason, generation, text, deleting,
editsWaiting }`; `TourDraftStatus` is `none`, `reading`, `offered`,
  `declined`, `restored` or `unavailable`.

## Invariants & assumptions

- **Generations:** every answer names its question. A read, a Restore or
  a "Delete it" that ends after the tour was read again or closed
  changes nothing (`tour-draft-slice.property.test.ts`). Only
  `readStarted`, `questionEnded` and `tourDocument/closed` move it, by
  one. `tourDocument/opened` does not: the desktop reads the draft
  before its session dispatches `opened`.
- `text` is set exactly while the draft is undecided, `reason` exactly
  while `unavailable`; `deleting` only while `offered`.
- **What stays outside the store:** the draft's records and photo bytes
  (each page's side table of the offer: `offered` in `creator-draft.ts`,
  the offer `editor-draft.ts` returns), and the gate's held actions and
  their promises (`draft-edit-gate.ts`): resources, not state. The gate
  reports only its count.
- Not recorded: no `tourDraft/*` action is among the page's persisted
  prefixes.
- Defensive: a malformed generation, reason or count changes nothing.
- **Not here yet:** the superseded and unread notes of a read still live
  in the pages (`creator-draft.ts`, `edit-main.ts`); they move with the
  one draft-writer core, a later step.

## Examples

```ts
store.dispatch(tourDraftActions.readStarted());
const question = selectTourDraft(store.getState()).generation;
// ... the read ...
store.dispatch(tourDraftActions.found({ generation: question, text }));
selectDraftOffer(store.getState()); // { text, waits: false, deleting: false }
```

## Tests

- `tour-draft-slice.test.ts` - each answer's path, the reopen and close
  guards, "Delete it"'s progress and failure, `unavailable` never over an
  offer, malformed payloads, the note while a read runs.
- `tour-draft-slice.property.test.ts` - random read, found, restore,
  decline, re-show, delete, reopen and close sequences with late
  answers: a late answer changes nothing, the invariants above hold, a
  decided question is never offered again, and a waiting edit always
  shows a put-off offer.
- `draft-shared-behaviour.test.ts` - both pages keep the question here
  ("the draft question is the store's ...", "... after Delete it").
- `draft-edit-gate.test.ts` - the gate's count reaches the slice.
