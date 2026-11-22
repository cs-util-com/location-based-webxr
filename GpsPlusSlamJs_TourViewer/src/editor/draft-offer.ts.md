# draft-offer.ts

## Purpose

The desktop editor's draft offer: what its three answers (Restore, Not
now, Delete it) do, apart from the toast that shows them. `edit-main.ts`
wires it to the session and renders its view; the logic lives here so it
can be tested without a page. Its status is the store's draft question
(`tour-draft-slice.ts`), shared with the phone page, and the view is drawn
from that slice.

## Public API

- `createDraftOffer(deps): DraftOfferAnswers` - dispatches the offer
  (`found`) into the question `deps.question` names and holds the store's
  draft gate (`draft-edit-gate.ts`); it draws the view from the store on
  every change of the slice, its words ending in `DRAFT_EDIT_WAITS` while
  an edit waits (the gate's count shows a put-off offer again).
  - `deps.store` - the page's store: `dispatch`, `getState`, `subscribe`
    and its `draftGate` (`hold`, `release`, `drop`).
  - `deps.question` - the slice's `generation` the page read when it
    started reading the draft (`readStarted`, in `edit-main.ts`).
  - `deps.text` - the offer's own words.
  - `deps.render(view | null)` - shows `DraftOfferView { text, deleting }`
    or hides the offer.
  - `deps.say(text, error?)` - a line for the creator; `error` for a
    failure.
  - `deps.current()` - whether the offer's tour is still the one open.
  - `deps.restore()` - puts the draft back: `{ count, line }`.
  - `deps.discard()` - "Delete it"'s removal; resolves whether it landed.
  - `deps.discardFailed` - the line said when it did not.
  - `deps.changed(count, restored)` - work landed (the undo step and the
    unsaved mark).
- `DraftOfferAnswers`:
  - `restore()` - drops what waited (each waiting edit was built from the
    document before the draft came back), dispatches `restored` (the
    offer goes), restores, releases the gate and says the restore's line,
    with `draftEditsMakeAgain(dropped)` appended when something was
    dropped.
  - `notNow()` - dispatches `declined` (the offer goes) and drops what
    waited, saying `DRAFT_EDIT_NOT_APPLIED` when something was; the gate
    keeps holding, so the next edit asks again.
  - `deleteIt(): Promise<void>` - dispatches `deleteStarted` (every answer
    off, the label `DRAFT_DELETING`), awaits the removal and dispatches
    `deleteEnded`; landed: the offer goes and what waited is replayed
    (`release`, built from the state that stays); not landed: the offer
    shows with its answers on again, `discardFailed` is said as an error,
    and what waited keeps waiting.

## Invariants & assumptions

- No answer runs while "Delete it" runs or while the offer is hidden; a
  re-show meanwhile (an edit that waits) keeps `deleting` on.
- An answer after the tour was left only hides the offer: the gate was
  already ended by the document's `closed` / `opened`. A read of the next
  tour (a new `generation`) hides it too and unsubscribes it; its answers
  change nothing then.
- No status in this closure: the view is drawn from `selectDraftOffer`
  and redrawn only when what it shows changed.

## Examples

```ts
store.dispatch(tourDraftActions.readStarted());
const question = selectTourDraft(store.getState()).generation;
const offer = createDraftOffer({
  store,
  question,
  text: "2 earlier changes were not saved.",
  render: renderToast,
  say: toast,
  current: () => session.key === key,
  restore: () => session.restore(),
  discard: () => draft.discard(),
  discardFailed: "The earlier changes could not be deleted.",
  changed: (count, restored) => markChanged(count, restored),
});
restoreButton.onclick = () => offer.restore();
```

## Tests

- `draft-offer.test.ts` - the offer and its waiting words, Restore
  dropping the waiting edit and saying so (and saying only its line with
  nothing waiting), Not now dropping and saying so with the next edit
  asking again, Delete it's progress and replay, a failed Delete it, a
  re-show while it runs, an answer after the tour was left, each answer
  moving the slice's status with the view following it, and the next
  tour's read hiding it.
- `draft-shared-behaviour.test.ts` - the same rule against the phone's.
