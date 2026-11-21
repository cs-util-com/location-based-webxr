# draft-offer.ts

## Purpose

The desktop editor's draft offer: what its three answers (Restore, Not
now, Delete it) do, apart from the toast that shows them. `edit-main.ts`
wires it to the session and renders its view; the logic lives here so it
can be tested without a page.

## Public API

- `createDraftOffer(deps): DraftOfferAnswers` - shows the offer at once
  and holds the store's draft gate (`draft-edit-gate.ts`) with a question
  that shows it again, its words then ending in `DRAFT_EDIT_WAITS`.
  - `deps.gate` - the gate's `hold`, `release` and `drop`.
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
  - `restore()` - hides the offer, drops what waited (each waiting edit
    was built from the document before the draft came back), restores,
    releases the gate and says the restore's line, with
    `DRAFT_EDIT_MAKE_AGAIN` appended when something was dropped.
  - `notNow()` - hides the offer and drops what waited, saying
    `DRAFT_EDIT_NOT_APPLIED` when something was; the gate keeps holding,
    so the next edit asks again.
  - `deleteIt(): Promise<void>` - shows the offer with `deleting` (every
    answer off, the label `DRAFT_DELETING`), awaits the removal; landed:
    hides it and replays what waited (`release`, built from the state
    that stays); not landed: shows the offer again, says
    `discardFailed` as an error, and what waited keeps waiting.

## Invariants & assumptions

- No answer runs while "Delete it" runs or while the offer is hidden; a
  re-show meanwhile (an edit that waits) keeps `deleting` on.
- An answer after the tour was left only hides the offer: the gate was
  already ended by the document's `closed` / `opened`.
- The offer's status lives in this closure, not in the store; the
  deviation and its follow-up are named in `draft-edit-gate.ts.md`.

## Examples

```ts
const offer = createDraftOffer({
  gate: store.draftGate,
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
  re-show while it runs, and an answer after the tour was left.
- `draft-shared-behaviour.test.ts` - the same rule against the phone's.
