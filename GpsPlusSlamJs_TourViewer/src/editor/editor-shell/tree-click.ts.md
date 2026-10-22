# tree-click.ts

## Purpose

The 3D view's tree click rule, pure: one click on a card selects it,
unfolds it and flies the camera there; a second click on the selected
card deselects and folds it, the camera staying; a second click inside
the double-click interval (a double click, a double tap) is not a second
click, so nothing toggles.

## Public API

- `TREE_DOUBLE_CLICK_MS` - 500, the fallback window when the browser
  counts no double click.
- `TreeClickMemory`, `NO_TREE_CLICK` - the last click (`{ id, at }`); the
  shell keeps it between clicks.
- `treeClick({ id, at, detail, selected, last })` ->
  `{ outcome: "select" | "deselect" | "none", memory }`:
  - a card that is not selected is selected at once, however quick the
    click (another card, or the first);
  - on the selected card, a click is rapid when the browser counts it as
    a double click (`detail > 1`, which follows the system's setting) or
    when it comes within `TREE_DOUBLE_CLICK_MS` of the last click on the
    same card; rapid gives `none`, else `deselect`;
  - a time that is not a finite number reads as a slow click.
- `treeClickPlan(outcome, id, stations)` -> `{ select, unfold, fold,
openCodes, fly }`, or null for `none`:
  - select a station (`station:<id>`): unfold it, fly;
  - select an item: unfold its station, fly;
  - select anything else (a code's level id): open the codes, fly;
  - deselect: select none, fold a station, no flight.

## Invariants & assumptions

- Pure: no DOM, no clock; the shell passes `performance.now()` and the
  event's `detail`.
- Selection ids are the page's (`editor-model.ts`): `station:<id>`, an
  item's id, a code's level id.

## Examples

```ts
let memory = NO_TREE_CLICK;
const { outcome, memory: next } = treeClick({
  id,
  at: performance.now(),
  detail: event.detail,
  selected,
  last: memory,
});
memory = next;
const plan = treeClickPlan(outcome, id, manifest.stations);
```

## Tests

`tree-click.test.ts`: select, deselect after the interval, nothing inside
it (by time and by `detail`), another card at once, a click with no
usable time, the property that no run of clicks toggles inside the
interval, and each plan (station, item, code, deselect, none). The page's
use: `playwright-tests/editor3d-shell.spec.js`.
