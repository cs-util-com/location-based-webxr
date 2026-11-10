# folder-outline.ts

## Purpose

The light teal outline the 3D editor draws around each item of a selected
plain folder. A plain folder has no drawing of its own, so these boxes are
how the creator sees in the scene which items it groups.

## Public API

- `FOLDER_OUTLINE_COLOUR` - `0x57c4b8`, the tree's folder teal.
- `folderItemIds(tour, folderId)` - the ids of the free items the plain
  folder `folderId` holds at any depth, in the tour's order (through
  `tourFreeEntries` and each entry's `folder` path). `[]` for a null tour,
  an empty id or a folder the tour lacks.
- `createFolderOutline({ scene, itemObjects })` returns
  - `update(tour, selected)` - per frame: when `selected` is
    `folder:<id>`, one `Box3Helper` per drawn item of that folder around
    its drawn objects (`itemObjects(id)`: its label, plane, model) as they
    stand this frame; every helper hidden for any other selection;
  - `count()` - how many boxes show (the page's checks read it through
    `__tourEditor.view3dFolderOutlines`);
  - `dispose()` - removes the helpers, disposes their geometry and the
    shared material.

## Invariants and assumptions

- One shared `LineBasicMaterial` (opacity 0.6, `depthTest: false`,
  render order 10) for every helper; each helper's own default material
  is disposed when it is replaced.
- Helpers are pooled: the pool grows to the largest folder seen and spare
  helpers are hidden, never removed, until `dispose`.
- An item with no drawn objects, or only empty ones, gets no box (it is
  skipped, not drawn at the origin).
- World matrices are refreshed before measuring, so an item moved this
  frame is followed.

## Example

```ts
const outline = createFolderOutline({ scene, itemObjects: layer.itemObjects });
outline.update(tour, "folder:yard"); // boxes around the folder's items
outline.count(); // e.g. 2
outline.update(tour, "p"); // none
```

## Tests

- `folder-outline.test.ts` - the ids at any depth (nested folders), one box
  per item for a selected folder and none otherwise, and a moved item's box
  following it.
- The e2e `editor3d-folders.spec.js` reads the count through the page hook.
