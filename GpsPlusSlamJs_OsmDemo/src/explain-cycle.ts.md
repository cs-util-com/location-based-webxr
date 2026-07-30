# `explain-cycle.ts`

## Purpose

Turns a selected cell into a rendered explanation, dropping answers that arrive
after the user has moved on and reporting failures without discarding the map.

## Public API

- `createExplainCycle({ store, actions, worker, render, clear })` →
  `(cell: string | undefined) => Promise<void>`
  - `undefined` clears the panel and makes **no** RPC.
  - Never rejects. A failure dispatches `nonFatalError`.

## Invariants & assumptions

- **The category is captured at DISPATCH time and compared at ARRIVAL time.**
  Reading it from the store on arrival would compare it against itself and the
  staleness check would never fire — a silent no-op that looks like working code.
- **BOTH the cell and the category are re-checked.** They change through different
  actions (a map click; the `<select>`), and a cell-only check lets a category
  switch render the previous category's arithmetic for the _right_ cell — harder to
  notice than the wrong cell entirely.
- **`undefined` from the worker means "not in the current snapshot", not an
  error.** Reachable in normal use: the selection outlives one working set, so
  moving away leaves a selected cell the worker no longer holds. It clears.
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

`explain-cycle.test.ts` — 7 examples against a worker whose call the test holds
open: renders a current answer; clears with no RPC for no selection; drops a stale
**cell**; drops a stale **category**; clears on `undefined`; reports a rejection as
`nonFatalError` while asserting the snapshot **survives**; survives a thrown
non-`Error`.

This logic previously lived inline in `main.ts`, which cannot be unit-tested, so
none of it was covered. Extracting it was the point of the change.
