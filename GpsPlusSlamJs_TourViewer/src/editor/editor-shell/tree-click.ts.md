# tree-click.ts

## Purpose

The 3D view's tree click rule, pure: one click on a card selects it,
unfolds it and flies the camera there; a second click on the selected
card deselects and folds it, the camera staying; a click inside the
double-click interval after one on the same card (the rest of a double
click, a double tap) does nothing, whether the first click selected or
deselected: only the first click of a quick run on one card counts.

## Public API

- `TREE_DOUBLE_CLICK_MS` - 500, the fallback window when the browser
  counts no double click.
- `TreeClickMemory`, `NO_TREE_CLICK` - the last click (`{ id, at }`); the
  shell keeps it between clicks.
- `treeClick({ id, at, detail, selected, last })` ->
  `{ outcome: "select" | "deselect" | "none", memory }`:
  - a click is rapid when it is on the card of the click before and the
    browser counts it as a double click (`detail > 1`, which follows the
    system's setting) or it comes within `TREE_DOUBLE_CLICK_MS` of that
    click; rapid gives `none`, selected or not;
  - any other click gives `deselect` on the selected card and `select`
    on any other (another card is selected at once, however quick);
  - a time that is not a finite number, or one before the last click,
    reads as a slow click.
  - The rule as a table (the test's oracle):
    - not selected, same card, quick: none;
    - selected, same card, quick: none;
    - selected, otherwise: deselect;
    - not selected, otherwise: select.
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
it (by time and by `detail`), nothing on a quick second click on the
card it just deselected (a double click on a selected card must not
reselect it), another card at once, a click with no usable time, the
property that any run of clicks follows the rule's table (an oracle
written apart from the code; it found the reselect case against the old
rule), and each plan (station, item, code, deselect, none). The page's
use: `playwright-tests/editor3d-shell.spec.js`.
