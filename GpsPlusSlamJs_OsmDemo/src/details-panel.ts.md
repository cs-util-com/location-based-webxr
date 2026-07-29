# `details-panel.ts`

**Purpose.** Render one cell's explanation as a dismissible overlay: a summary sentence, the threshold verdict, and a collapsible feature → tags tree.

## Public API

- `class DetailsPanel`
  - `constructor({ container, onClose })` — `onClose` fires when the user dismisses it, so the store can deselect.
  - `render(explanation: CellExplanation)` — replaces the contents and unhides.
  - `clear()` — empties and hides. Called when nothing is selected.

## Invariants & assumptions

- **An overlay on desktop as well as mobile (DEC-17).** The plan first put it in a thin third column; on a laptop that leaves the 2D and 3D panes at ~450 px each — the width that made the 3D pane useless on a phone. Floating it over the split keeps both views full size and means one layout to build and test.
- **Closing deselects rather than merely hiding.** A panel hidden while its cell was still selected would make re-clicking the same cell appear to do nothing. Pinned by an e2e that closes and re-clicks.
- **The vetoing feature's `<details>` is open by default.** It _is_ the answer; making the reader find and click the right row is making them guess which row is the answer.
- **Text goes in with `textContent`, never a template string.** Tag keys and values come from OSM and rule ids from a publicly editable sheet. `escape-html.ts` exists because this app already renders sheet-derived text into HTML sinks; the panel avoids the sink rather than escaping into one.
- **Tag state is named in the row, not only coloured.** A legend for five tag states would cost more room in a panel this size than the words do, and `skipped` is the one a reader must not have to infer.
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

Covered end to end by `playwright-tests/osm-demo.spec.js` — _"clicking a cell opens a details panel explaining its score"_: the panel starts hidden, a cell click reveals it, a feature expands to show tag rows, and closing it deselects so the same cell can be re-opened.

The view model is unit-tested in `explanation-tree.test.ts`; this file has no logic of its own worth a separate unit test.
