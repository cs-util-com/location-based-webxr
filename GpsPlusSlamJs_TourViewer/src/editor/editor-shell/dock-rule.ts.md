# dock-rule.ts

## Purpose

The 3D view's docks on a narrow window, pure. The tree (left, 272 px) and
the inspector (right, 290 px) lie over the scene; from
`DOCKS_SIDE_BY_SIDE_PX` up they sit side by side. Below it two open docks
would leave a strip of about 200-260 px of scene, so one is open at a
time. Below `TREE_STARTS_FOLDED_PX` (a phone) the tree also starts folded.

## Public API

- `DOCKS_SIDE_BY_SIDE_PX` - 900; `TREE_STARTS_FOLDED_PX` - 700.
- `DockChange` - `"opened" | "selected" | "resized" | "tree-unfolded" |
"inspector-unfolded"`; `DockFolds` - `{ tree, inspector }`.
- `docksAfter(change, { widthPx, folded, inspectorShows })` -> the folds:
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
820), each unfold folding the other, the phone start, no inspector, and
the property over any width and change.
