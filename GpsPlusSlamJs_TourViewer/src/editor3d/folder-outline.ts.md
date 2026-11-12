# folder-outline.ts

## Purpose

What the 3D editor draws round a selected plain folder: a light teal box
around each of its items and, while its gizmo is drawn, a dashed outline
round them all with the folder's name on a tag at its front left. A plain
folder has no drawing of its own, so these are how the creator sees in the
scene which items it groups and which folder the gizmo moves.

## Public API

- The outlines draw in `0x57c4b8`, the tree's folder teal (module-private).
- `folderItemIds(tour, folderId)` - the ids of the free items the plain
  folder `folderId` holds at any depth, in the tour's order (through
  `tourFreeEntries` and each entry's `folder` path). `[]` for a null tour,
  an empty id or a folder the tour lacks.
- `createFolderOutline({ scene, itemObjects })` returns
  - `update(tour, selected, gizmo?)` - per frame: when `selected` is
    `folder:<id>`, one `Box3Helper` per drawn item of that folder around
    its drawn objects (`itemObjects(id)`: its label, plane, model) as they
    stand this frame; every helper hidden for any other selection. With
    `gizmo` (`FolderGizmoAt`: the pivot, the heading and the sprite scale
    per pixel, given while the folder's own gizmo is drawn) also the
    dashed outline (`groupHull` of the boxes' ground footprints,
    `FOLDER_HULL_PAD_M` = 0.3 m beyond them, square to the heading, at
    the pivot's height) and the name tag (the tree's name of the folder,
    22 px high at any distance, its left end on the outline's front-left
    corner); both hidden without `gizmo`, without a drawn item or for a
    folder the tour lacks;
  - `count()` - how many boxes show (the page's checks read it through
    `__tourEditor.view3dFolderOutlines`);
  - `hull()` / `tag()` - the outline and the tag's name drawn now, or
    null (the page's checks);
  - `dispose()` - removes the helpers, the outline and the tag, and
    disposes their geometry, materials and texture.

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
- The outline and the tag draw without a depth test (render order 10 and
  11); the tag takes no ray (`raycast` is a no-op), so a press on it
  reaches what stands behind. The tag's picture is drawn only when its
  name changes, and only where a `document` exists (none in a unit test:
  the tag is then placed but has no picture).

## Example

```ts
const outline = createFolderOutline({ scene, itemObjects: layer.itemObjects });
outline.update(tour, "folder:yard"); // boxes around the folder's items
outline.count(); // e.g. 2
outline.update(tour, "folder:yard", { centre, headingDeg, spritePerPx });
outline.tag(); // "Yard"
outline.update(tour, "p"); // none
```

## Tests

- `folder-outline.test.ts` - the ids at any depth (nested folders), one box
  per item for a selected folder and none otherwise, and a moved item's box
  following it; the dashed outline round the boxes with the pad and the
  tag at its front left, both gone without the gizmo.
- The e2e `editor3d-folders.spec.js` reads the count through the page hook.
