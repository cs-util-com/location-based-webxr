# street-furniture.ts (three)

## Purpose

Draws `FurniturePlacement`s (`../mesh/street-furniture.ts`) as one
`InstancedMesh` per model on shared geometry and material, packing only the
items within a cut around the eye (default 80 m) and repacking once the eye
has moved 4 m. City objects plan 2026-11-07-2315 M5, from the O3 street
scene prototype's `furnitureMeshes`.

## Public API

- `FURNITURE_CUT_M` (80), `FURNITURE_REPACK_M` (4).
- `streetFurnitureObjects(placements, { cutM?, repackM? })` →
  `THREE.InstancedMesh[]`, one per model present in first-seen order.
  `userData`: `sharedResources: true`, `cityLayer: "furniture"`,
  `furnitureModel`, `guessed` (`{ key, fields }` per item). Each starts
  with `count` 0 and repacks in its `onBeforeRender`. `cutM: Infinity`
  draws all. RangeError for a cut or repack distance that is not positive.
- `repackFurniture(mesh, eye)` → true when it repacked: packs the items
  within the cut of `eye` (the mesh's own ENU metres) to the front and sets
  `count`; false within the repack distance of the last packed eye, or for
  a mesh this module did not make.

## Invariants & assumptions

- The eye is the camera converted into the mesh's own frame
  (`worldToLocal`), so a parent that moves or turns the city (OsmDemo's
  content root) does not move the cut.
- `frustumCulled = false`: `count` changes, so the bounding sphere is never
  right, and `onBeforeRender` runs only for an object that was not culled.
  An invisible mesh is not rendered, so it never repacks (OsmDemo hides the
  furniture in AR and so skips the repack there).
- Models: the mast lamp is `postWithHead` (5 m post, 0.36 m head), the wall
  and hung lamps a head box at 4 m and 6 m, the bollard a six-sided prism of
  0.9 m; lamps 0x5a6167 and bollards 0x676d73 (fixed colours, not part of
  the colour schemes). Benches and bins are the POI models
  (`amenity=bench`, `amenity=waste_basket`) at their own size. A lamp or
  bollard is stretched vertically to its `heightM`.
- Matrices: position (x, groundHeightM, -y) (ENU north to scene -z), yaw
  about +y, scale (1, stretch, 1). Repacking twice at one eye changes
  nothing (property test).
- Shared resources are never disposed (`disposeCityObjects` skips them).

## Examples

```ts
const meshes = streetFurnitureObjects(city.furniture, { cutM: 80 });
scene.add(...meshes); // repacks itself before each render
```

## Tests

`street-furniture.test.ts` - one mesh per model on shared resources, empty
until repacked; the guessed list; position, yaw and stretch in scene axes;
benches and bins unstretched; refusals; the cut and the repack distance;
`Infinity`; the eye in the mesh's own frame under a moved and turned parent
(fails under sabotage when the world position is used); the idempotence and
within-cut property; `cityObjects` drawing the city's furniture at a given
cut and never freeing it.
