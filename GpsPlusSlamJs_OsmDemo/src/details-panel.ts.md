# `details-panel.ts`

**Purpose.** Render one cell's explanation as a dismissible overlay: a summary sentence, the threshold verdict, and a collapsible feature → tags tree.

## Public API

- `class DetailsPanel`
  - `constructor({ container, onClose })` — `onClose` fires when the user dismisses it, so the store can deselect.
  - `render(explanation: CellExplanation)` — replaces the contents and unhides.
  - `renderFeature(feature)` — the picked-marker mode (W12): a name, a kind and a link.
  - `renderRegion(summary: RegionSummary)` — the walkable-region mode.
  - `renderUnavailable(cell: string)` — says this cell has no explanation right now. Replaces and **unhides**, like the three above.
  - `clear()` — empties and **hides**. Called only when nothing is selected.

## Invariants & assumptions

- **An overlay on desktop as well as mobile (DEC-17).** The plan first put it in a thin third column; on a laptop that leaves the 2D and 3D panes at ~450 px each — the width that made the 3D pane useless on a phone. Floating it over the split keeps both views full size and means one layout to build and test.
- **Closing deselects rather than merely hiding.** A panel hidden while its cell was still selected would make re-clicking the same cell appear to do nothing. Pinned by an e2e that closes and re-clicks.
  - **It holds for REGIONS too, and through one dispatch.** `onClose` sends only `cellSelected(undefined)`, and that reducer clears `selectedCell`, `selectedFeature` **and** `selectedRegion` unconditionally (`osm-view-slice.ts`) — one panel, one selection, in both directions. Now pinned for regions by a close-and-re-click assertion, which is coverage the invariant did not previously have.
  - **A correction worth keeping, because the wrong version was briefly committed.** On 2026-08-07 a second `regionSelected(undefined)` dispatch was added here on the theory that closing a region's panel left the region selected. It was **dead code**: the reducer already cleared it, and the e2e passes with the line removed. Raised in review on #271 and reverted. The lesson is the shape — a fix that makes a symptom disappear is not evidence for the diagnosis behind it.
- **The vetoing feature's `<details>` is open by default.** It _is_ the answer; making the reader find and click the right row is making them guess which row is the answer.
- **Text goes in with `textContent`, never a template string.** Tag keys and values come from OSM and rule ids from a publicly editable sheet. `escape-html.ts` exists because this app already renders sheet-derived text into HTML sinks; the panel avoids the sink rather than escaping into one.
- **The tag table is readable without seeing it.** Four columns carry headers (`tag` / `factor` / `running` / `state`), because two of them hold bare numbers meaning different things -- what this tag multiplied by, and what the product was after it -- which a sighted reader infers from context and a screen-reader user cannot. Every state is named including the ordinary `scored` one: rendering that as an empty cell left the normal case distinguishable only by the ABSENCE of text, and `skipped` is precisely the state a reader must not have to infer.
- **"No answer" is a render mode, not a `clear()`.** The two look interchangeable from the caller — neither has an explanation to show — and they are opposite to the user: `clear()` hides the panel, which is the silence DEC-7 reveals sub-threshold cells to remove, so a click on a cell the worker cannot score would be indistinguishable from a click that missed. It is also **not** a status-line error: routing this routine state through `nonFatalError` set the store's global error phase and aborted the rest of a progressive refresh (raised in review on #265). `explain-cycle.ts.md` carries the full chain.
- All decisions live in `explanation-tree.ts`; this file builds nodes. If a question can be asked in a unit test, it belongs there.
- Class names (`panel-header`, `panel-close`, `panel-summary`, `panel-threshold`, `panel-feature`, `panel-feature-<state>`, `panel-tags`, `panel-tag`, `panel-tag-<state>`, `panel-factor`) are the e2e's and the stylesheet's handles.

## Examples

```ts
const panel = new DetailsPanel({
  container: document.getElementById("details"),
  onClose: () => store.dispatch(actions.cellSelected(undefined)),
});
panel.render(explainCell(cell, covering, table, category));
panel.clear();
```

## Tests

Covered end to end by `playwright-tests/` — _"clicking a cell opens a details panel explaining its score"_: the panel starts hidden, a cell click reveals it, a feature expands to show tag rows, and closing it deselects so the same cell can be re-opened.

The view model is unit-tested in `explanation-tree.test.ts`. `details-panel.test.ts` (jsdom) covers the two modes that have **no** model behind them and therefore live only here: `renderFeature` (label, kind, the `href` it actually points at, replacement, escaping, `clear()`) and `renderUnavailable` (visible, names the cell, replaces rather than appends, dismissible through the shared `onClose`, escapes the id).
