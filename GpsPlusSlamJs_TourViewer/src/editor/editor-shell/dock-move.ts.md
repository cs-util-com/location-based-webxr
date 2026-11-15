# dock-move.ts

## Purpose

"Move to...": the keyboard's way to move a docked panel, where a mouse drags its tab. The docking library's own keyboard docking is not free to use, and its tab menu is mouse-only, so this is our own menu over the library's `panel.api.moveTo`.

## Public API

- `MoveGroup` - `{ id, panels }`: a group shown, by the docking's group id, and its panels' ids.
- `MoveTarget` - `{ label, group, position }`: `position` `"center"` puts the panel into `group` as a tab; `"left"`, `"right"`, `"bottom"` make a group of its own at that side of `group`.
- `moveTargets(panel, groups, viewGroup, titleOf)` - every other group shown, in the order given, as `Into <its panels' titles>`; then `Left of the 3D view`, `Right of the 3D view`, `Below the 3D view` (new groups beside the 3D view's group). Nothing for the 3D view (it never moves), and nothing when `viewGroup` is not among `groups`. The 3D view's group is never a target as a tab (it is locked), nor the panel's own group, nor an empty group.
- `MoveMenuOptions` - `{ anchor, title, targets, onPick }`.
- `showMoveMenu(options)` - a `role="menu"` named "Move <title> to", in the page's body below `anchor` (above it when there is no room below, kept inside the window), its items buttons with `role="menuitem"`, the first focused. Up and Down wrap, Home and End jump, Enter or Space (a button's click) picks and closes, Escape or Tab closes with the focus back on `anchor`, a press outside closes. Returns its close. One menu at a time: a second call closes the first.

## Invariants

- `onPick` runs after the menu is gone, so the host may move the focus freely.
- No layout knowledge here beyond the 3D view's id: what is shown and where is the host's (`dock-host.ts`), which opens the menu on a focused tab's Shift+F10 or context-menu key, and from the tab's mouse menu.

## Example

```ts
showMoveMenu({
  anchor: tab,
  title: "Files",
  targets: moveTargets(
    "files",
    groups,
    viewGroupId,
    (id) => dockPanel(id).title,
  ),
  onPick: (t) => {
    panel.api.moveTo({ group: byId(t.group), position: t.position });
  },
});
```

## Tests

- `dock-move.test.ts` - the targets for the default layout, the 3D view and an absent view group, empty groups skipped; the menu's name, focus, arrows, Home and End, pick, Escape with the focus back, a press outside, one at a time.
- `playwright-tests/editor3d-docking.spec.js` - a tab moved below the 3D view by Shift+F10 and Enter, the focus on its tab after.
