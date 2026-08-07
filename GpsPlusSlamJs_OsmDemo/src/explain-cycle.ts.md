# `explain-cycle.ts`

## Purpose

Turns a selected cell into a rendered explanation, dropping answers that arrive
after the user has moved on and reporting failures without discarding the map.

## Public API

- `createExplainCycle({ store, actions, worker, render, clear, unavailable })` →
  `(cell: string | undefined) => Promise<void>`
  - `undefined` **as the argument** clears the panel and makes **no** RPC.
  - `undefined` **as the worker's answer** calls `unavailable(cell)`. It does
    **not** clear, and it does **not** dispatch anything.
  - Never rejects. A thrown failure dispatches `nonFatalError`.
- The three panel callbacks are three different outcomes and must not be merged:
  - `render(explanation)` — there is an answer.
  - `unavailable(cell)` — the question is legitimate and has no answer right now.
  - `clear()` — there is no question, because nothing is selected.

## Invariants & assumptions

- **The category is captured at DISPATCH time and compared at ARRIVAL time.**
  Reading it from the store on arrival would compare it against itself and the
  staleness check would never fire — a silent no-op that looks like working code.
- **BOTH the cell and the category are re-checked.** They change through different
  actions (a map click; the `<select>`), and a cell-only check lets a category
  switch render the previous category's arithmetic for the _right_ cell — harder to
  notice than the wrong cell entirely.
- **`undefined` from the worker means "no score in the current working set", not
  an error** — and the difference decides which channel it uses. Reachable in
  normal use: the selection outlives one working set, so moving away leaves a
  selected cell `pipeline.scoreFor` no longer scores. It goes to `unavailable`.
  - **It must NOT go through `nonFatalError`, and this is a fixed defect rather
    than a preference.** `nonFatalError` sets `loading.phase = "error"`
    (`osm-view-slice.ts`), and two subscribers act on the **phase**, not on the
    message: `refresh-cycle.ts` returns before publishing a ring — dropping the
    rest of a progressive widening, against its own stated assumption that "an
    error visible here always belongs to THIS run" — and `main.ts` expands a
    collapsed header through `revealForError()`. `main.ts` re-explains the
    still-selected cell on **every** `snapshotReady` and one widening publishes
    three, so a user who moved with a stale cell selected lost rings 2 and 3 and
    saw `Failed: details panel: …` where the counts belong. Raised in review on
    [#265](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/location-based-webxr_pr_review_comments_handled.md).
  - **A routine state that reaches a global channel will be acted on by whoever
    reads that channel.** The generalised form of the above, and the reason
    `unavailable` is a callback of this module rather than one more action.
- **A failure is NON-fatal by construction.** A failed explanation says nothing
  about whether the map's data is good, so it must not clear the snapshot — that is
  `fetchFailed`'s job. It also must not reject: the caller is a store subscriber,
  and an exception escaping there would skip every later subscriber (see
  `refresh-cycle.ts`'s note on `renderSafely`).
- **Deliberately NOT coalesced through `latestOnly`**, unlike the refresh and
  terrain cycles. An explanation is cheap — no network, no scoring, it re-derives
  from data the worker already holds — so serialising it would add latency to the
  one interaction that should feel instant. Dropping stale answers on arrival gives
  the same guarantee for less.
- **It is an RPC because the data is worker-side.** The explanation needs the
  merged features (28–68 MB) and the rule table; answering it on the main thread
  would mean shipping those across to explain one cell.

## Examples

```ts
const explainSelected = createExplainCycle({
  store,
  actions,
  worker,
  render: (explanation) =>
    renderSafely(access, "details panel", () =>
      detailsPanel.render(explanation),
    ),
  clear: () => detailsPanel.clear(),
});
subscribe(
  (view) => view.selectedCell,
  (cell) => void explainSelected(cell),
);
```

## Tests

`explain-cycle.test.ts` — 8 examples against a worker whose call the test holds
open: renders a current answer; clears with no RPC for no selection; drops a stale
**cell**; drops a stale **category**; calls `unavailable` (and neither `render`
nor `clear`) on `undefined`; **asserts the phase is not `"error"` after that
miss**; reports a rejection as `nonFatalError` while asserting the snapshot
**survives**; survives a thrown non-`Error`.

The phase assertion is a **regression guard with a named consequence**, which is
why it is separate from the example beside it: the two differ only in what they
assert and only one of them would notice the routine-state-on-a-global-channel
defect coming back. The panel side is covered by
`details-panel.test.ts`'s `renderUnavailable` block — visible, names the cell,
replaces rather than appends, dismissible, and escapes the id.

This logic previously lived inline in `main.ts`, which cannot be unit-tested, so
none of it was covered. Extracting it was the point of the change.
