# dock-save.ts

## Purpose

The docked layout a creator arranged, kept in the browser per form factor and read back with a check. Pure: no DOM and no docking library; `dock-host.ts` stores it on every change and applies it when the panels dock.

## Public API

- The storage key's stem is `"editor-dock-layout"` (module-private).
- `DockFormFactor` - `"desk" | "sideways" | "upright"`.
- `dockFormFactor(widthPx, heightPx)` - a phone's window is at most 700 px wide or 500 px tall: `"sideways"` when wider than tall, else `"upright"`; anything else (and a window of no size) is `"desk"`. The same split as the docking prototype's.
- `dockSaveKey(formFactor)` - `"editor-dock-layout:<form factor>"`: each form factor keeps its own layout, so a phone held sideways never gets the desk's three columns back.
- `SavedFold` - `{ panel, prevPx }`: a group folded to its rail, named by a panel it holds (group ids are the docking's own), and the size along its fold axis it unfolds to. The axis is not kept: the host folds the group again and the axis follows from the restored layout's sizes.
- `SavedDock` - `{ layout, folds }`, `layout` the docking library's `toJSON()`.
- `writeSavedDock(layout, folds)` - the kept text, `{ v: 1, layout, folds }`.
- `readSavedDock(raw)` - the kept layout, or `null` when there is none or it is refused.
- `keptAtSize(saved, widthPx, heightPx)` - whether the kept layout is laid out at the size it was kept at (its grid's width and height, each within 1 px). At another size the host fits it as after a window resize (side groups at the window's widths) rather than letting the docking library scale every group in proportion.
- `createDockKeeper(write, delayMs)` -> `{ soon(key, text), flush(), cancel() }`: a write put off until changes settle. `soon` (re)starts the wait with the layout taken now; a pending layout of another key is written first; `flush` writes the pending one at once (the host calls it when the window turns to another form factor and on dispose); `cancel` drops it. `write` handles its own storage failures.

## Invariants and defensive measures

- A refused layout is never applied in part: the host loads the default layout in its place and removes the kept text, so the editor never comes up with an empty or partial layout.
- Refused: no text; not JSON; not an object; another version; no layout; a grid node of a shape other than `leaf` or `branch`; a group with no panels or with a non-string id; the panels named (`layout.panels`) or placed (the grid's and floating groups' `views`) not exactly today's `DOCK_PANELS`, each once (a panel missing, unknown or twice); the 3D view not alone in a docked group (floated, or sharing its group); any popout window.
- A fold that names no foldable panel (unknown, or the 3D view) or no finite positive size is left out, not the whole layout; folds that are not a list read as none.
- The keeper holds the layout taken at its change, not at its write: a write flushed after the window turned keeps the layout of before the turn, never the one squeezed into the new window.
- The check is structural only: the docking library's `fromJSON` may still refuse a layout this accepts, and the host falls back to the default then too.

## Example

```ts
const key = dockSaveKey(dockFormFactor(innerWidth, innerHeight));
storage.setItem(
  key,
  writeSavedDock(dock.toJSON(), [{ panel: "list", prevPx: 248 }]),
);
const saved = readSavedDock(storage.getItem(key)); // null: lay the default out
```

## Tests

- `dock-save.test.ts` - the form factors and keys, a round trip with folds and with a floated panel, every refusal case, folds filtered; `keptAtSize` at and beyond its pixel; the keeper's settle wait, flush, key change and cancel (fake timers).
- `dock-save.property.test.ts` - any arrangement of today's panels into groups (the 3D view alone) reads back; the same with one panel dropped or doubled is refused.
- `playwright-tests/editor3d-docking.spec.js` - a rearranged layout comes back after a reload, a broken kept layout loads the default, the desk's and the sideways phone's layouts are kept apart, a change made just before the window turns is kept for its form factor, and a kept layout opened in a wider window takes that window's side widths.
