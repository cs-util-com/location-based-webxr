# dock-rail.ts

## Purpose

The docked editor's groups fold to rails, and this module is the fold as data: which groups may fold, along which axis, how thick the rail is for the input in use, and the size a folded group gets back when it unfolds. It has no DOM and no docking library; `dock-host.ts` applies its results to the dockview groups.

## Public API

- `RAIL_PX` - `{ mouse: 34, touch: 44 }`, the rail's thickness in px. A rail is a row of buttons: 44 px fits a finger, and 34 px leaves the 3D view more room under a mouse.
- `railPx(coarse)` - the rail thickness for a coarse pointer (`true`) or a fine one.
- `UNFOLD_MIN_PX` - `{ width: 200, height: 120 }`, the least size a group unfolds to.
- `foldAxis(group, layout)` - `"height"` when the group is as wide as the layout (it has no side to fold to: a phone's group held upright, however tall it was dragged); else `"width"` when the group is at least 55 % of the layout's height (a side column), else `"height"` (a group above or below the 3D view). A height that is not a positive finite number gives `"width"`.
- `canFold(panelIds, location)` - true only for a group in the grid (`location === "grid"`) that holds at least one panel and not the 3D view (`"view"`).
- `foldedAt(folds, id, group, layout)` - a new `Folds` with `id` folded at its present size along its axis. Returns the same map when `id` is folded already (the rail's own size must never become the size to give back) or the size is not a finite number of at least 0.
- `unfoldedAt(folds, id)` - `{ folds, restore }`, where `restore` is `{ axis, px: max(UNFOLD_MIN_PX[axis], prevPx) }`, or `null` with the same map when `id` was not folded.
- `prunedTo(folds, live)` - the folds of the groups still in `live`. Returns the same map when nothing is dropped.
- `foldsAfterTurn(session, groupOf)` - by group, the folds a turn gives back: `session` maps a panel id to whether it was folded before the turn, `groupOf` places it in the turned layout (null: nowhere, left out). A group holding several session panels is folded only when all of them were. Tested in `dock-rail.test.ts` and `dock-rail.property.test.ts`.
- `moveOf(shape, location, fixed)` - the move a group's Float/Dock button offers: `"float"` for a group in the grid, `"dock"` for a floating one, null at a desk (`shape` null), for a `fixed` group (folded, or the 3D view's) and for any other location. A phone only: the desk keeps its strips as they were.
- `railSide(groupBox, viewBox)` - `"left" | "right" | "up" | "down"`: where the group lies against the 3D view, which is the direction its fold chevron points. The boxes are page rectangles, with 1 px of slack for sub-pixel edges.

## Invariants and assumptions

- `Folds` is a `ReadonlyMap<string, Fold>` keyed by the docking's group id, with `Fold = { axis, prevPx }`. Every function returns a new map on change and the same map otherwise, so a caller can compare by identity.
- Sizes come from laid-out boxes in CSS px. A box not laid out yet (NaN, 0) never records a fold and never decides the axis by an always-false comparison.
- Fold state belongs to the group, not the panel: a panel dragged into a folded group joins the rail, and a group the docking removes (dragged empty) is pruned.

## Examples

```ts
let folds: Folds = new Map();
folds = foldedAt(folds, group.id, { width: 260, height: 833 }, layout);
// later, a click on the rail
const { folds: next, restore } = unfoldedAt(folds, group.id);
if (restore) group.api.setSize({ [restore.axis]: restore.px });
```

## Tests

- `dock-rail.test.ts` - the rail sizes, the 55 % axis threshold on both sides of it, a group as wide as the layout folding its height (also a property in `dock-rail.property.test.ts`), non-numeric sizes, which groups fold, the fold/unfold round trip, the least unfold size, a repeated fold, pruning, the four rail sides and the Float/Dock button's move.
- `dock-rail.property.test.ts` - over any sizes: fold then unfold gives back the size along the folded axis (at least the least size) and leaves no fold behind, and pruning keeps exactly the live groups' folds.
