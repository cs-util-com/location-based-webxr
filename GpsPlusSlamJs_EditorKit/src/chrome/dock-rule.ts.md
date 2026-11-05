# dock-rule.ts

## Purpose

The 3D view's docks on a narrow window, pure. The tree (left, 248 px) and
the inspector (right, 290 px) lie over the scene; from
`DOCKS_SIDE_BY_SIDE_PX` up they sit side by side. Below it two open docks
would leave less scene between them than `SCENE_FLOOR_PX`, so one is open
at a time. Below `TREE_STARTS_FOLDED_PX` (a phone) the tree also starts folded.

## Public API

- `TREE_DOCK_PX` - 248 and `INSPECTOR_DOCK_PX` - 290, the docks' widths
  as the Tour Viewer's `editor-shell.css` draws them (its
  `editor-shell/dock-widths.test.ts` reads the CSS and holds the two to
  each other; the kit draws no CSS).
- `SCENE_FLOOR_PX` - 362, the narrowest strip of scene left between two
  open docks. It is a judgement, not a measurement: about a third of a
  landscape phone, which still shows a station and its surroundings. The
  strip two open docks leave is:
  - 230 px at 768 (a tablet in portrait);
  - 282 px at 820;
  - 362 px at 900;
  - 486 px at 1024.

  The tree narrows to 210 px from 1100 px down (the Tour Viewer's CSS),
  so the real strip there is wider than the rule counts: it errs towards
  folding a dock.

- `DOCKS_SIDE_BY_SIDE_PX` - `TREE_DOCK_PX + INSPECTOR_DOCK_PX +
SCENE_FLOOR_PX`, so 900; `TREE_STARTS_FOLDED_PX` - 700.
- `DockChange` - `"opened" | "selected" | "resized" | "tree-unfolded" |
"inspector-unfolded"`; `DockFolds` - `{ tree, inspector }`.
- `DockLayout` - `{ treePx, inspectorPx, sceneFloorPx, treeStartsFoldedPx }`,
  the app's docks in CSS px; `DEFAULT_DOCK_LAYOUT` is the four constants
  above (the Tour Viewer's). `docksSideBySidePx(layout)` - the sum of the
  docks and the floor; throws `RangeError` for a width that is not finite
  and non-negative.
- `docksAfter(change, { widthPx, folded, inspectorShows }, layout?)` -> the
  folds (the numbers below are the default layout's):
  - `opened` below 700 px folds the tree;
  - from 900 px up, or while no inspector shows, nothing else changes;
  - below 900 px with the inspector showing: `tree-unfolded` folds the
    inspector; any other change folds the tree while the inspector is
    unfolded.

## Invariants & assumptions

- Below 900 px with an inspector showing, never both docks open; from
  900 px up the rule folds nothing (the creator's folds stand).
- Pure; the shell passes `innerWidth` and stores the result through
  `editorView`'s `dockFolded`.

## Examples

```ts
const folds = docksAfter("selected", {
  widthPx: innerWidth,
  folded: view.foldedDocks,
  inspectorShows: true,
});
```

## Tests

`dock-rule.test.ts`: wide windows untouched, the tablet widths (768,
820), each unfold folding the other, the breakpoint as the sum of the
docks and the floor, the phone start, no inspector, and
the property over any width and change; a layout of the app's own moving
the breakpoint and the phone start, a layout that is not widths refused,
and the one-dock property over any layout.
