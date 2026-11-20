# start-question-slice.ts

## Purpose

The setup's start answer in the page's store: which panel step 2 shows
(`new`, `link`, `file`, `later`, or `share` from Done's "Make your code
now"). It is store state because two views read it: step 2's panel
(`start-question.ts`) and the host tiles, which offer no starter zip for
`share` (`host-picker.ts`'s `saved`, wired in `main.ts`).

## Public API

- `startQuestionReducer` - mounted as `startQuestion` by
  `createTourViewerStore` (`tour-viewer-session.ts`).
- `startPanelShown(panel)` - an answer tapped, or Done's "Make your code
  now". A panel the reducer does not know changes nothing.
- `selectStartPanel(state)` - the panel, or null before any answer.
- `StartQuestionState` - `{ panel: StartPanel | null }`.

## Invariants & assumptions

- **One writer:** `wireStartQuestion` dispatches `startPanelShown`; every
  reader goes through `selectStartPanel`.
- **Never saved, never recorded:** no `startQuestion/*` action is among the
  page's persisted prefixes, and a reload starts at the question (or at
  `new` for a creator with a stored host, which `main.ts` passes as the
  wiring's `initial`).
- **The open step is not here:** which step is open stays the wizard's
  (`wizard.ts`), a `<details>` the page owns; this slice holds only the
  answer.
- Defensive: the payload is checked against `START_ANSWERS` plus `share`.

## Examples

```ts
store.dispatch(startPanelShown("later"));
selectStartPanel(store.getState()); // "later"
```

## Tests

- `start-question-slice.test.ts` - no answer at first; the last panel
  shown wins (property); an unknown panel changes nothing.
- `start-question.test.ts` - the wiring dispatches and draws from the
  store, also a panel dispatched from elsewhere.
