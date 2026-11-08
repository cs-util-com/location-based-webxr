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
- `TreeGroup` - `{ id, selection?, children: string[], groups? }`, a group
  of the tree (the app's; the Tour Viewer makes them with its
  `tree-model.ts`). `groups` nest; a nested group is selected by its own
  `selection`, because the prefix names only the top level.
- `treeClickPlan(outcome, id, groups, { groupPrefix })` -> `{ select,
unfold, fold, toggle, ungrouped, fly }`, or null for `none`; `unfold` is a
  list, outermost first; `groupPrefix` (required, the kit has none of its
  own) is how the app's selection names a top-level group, and a missing or
  empty one throws `RangeError`:
  - select a top-level group (`<groupPrefix><id>`): unfold it, fly;
  - select a child, at any depth: unfold the whole chain to it, fly;
  - select a nested group: unfold what holds it, leave its own fold, fly;
  - select anything else: `ungrouped` (the app opens where such
    selections live), fly;
  - deselect a nested group: the selection stays and its fold flips
    (`toggle`), no flight;
  - deselect anything else: select none, fold a top-level group, no flight.

## Invariants & assumptions

- Pure: no DOM, no clock; the shell passes `performance.now()` and the
  event's `detail`.
- Selection ids, the groups and their prefix are the app's; the kit
  names none of its own.

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
const plan = treeClickPlan(outcome, id, groups, { groupPrefix: "folder:" });
```

## Tests

`tree-click.test.ts`: select, deselect after the interval, nothing inside
it (by time and by `detail`), nothing on a quick second click on the
card it just deselected (a double click on a selected card must not
reselect it), another card at once, a click with no usable time, the
property that any run of clicks follows the rule's table (an oracle
written apart from the code; it found the reselect case against the old
rule), each plan (group, child, ungrouped, deselect, none), nested groups
(the chain at any depth as a property, a nested group's own fold), a group prefix of
the app's own, an empty one refused and a missing one refused (and a
type error). The page's
use: `playwright-tests/editor3d-shell.spec.js`.
