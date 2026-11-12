# `three/trunk-trees.ts`

## Purpose

The trunk-and-crown trees, an option beside the crown-only default (the owner's Q7, city objects plan 2026-11-07-2315 M2b): O1's crown lifted onto a trunk, drawn in two levels by distance from the eye.

## Public API

- `TREE_LOD_NEAR_M` (120): trees nearer than this to the eye take the near level.
- `TREE_LOD_REPACK_M` (2): the eye must move this far before the levels are re-sorted.
- `trunkRadiusM(heightM)` (module-private): O1's girth fallback, `0.012 x height + 0.06` within 0.1-0.35 m (OSM rarely tags `circumference`, and placements carry none).
- `trunkTreeObjects(placements)`: four `InstancedMesh`es per form present (crown and trunk, near and far), each with `count` 0 until its first sort, `frustumCulled` off, and `userData` `{ sharedResources: true, treeForm: "trunk", treePart, treeLevel }`. Reached through `treeObjects(placements, { form: "trunk" })` and `cityObjects(city, { treeForm: "trunk" })`.
- `repackTreeLod(mesh, eye)`: writes the trees whose level is the mesh's into it, unless `eye` (the mesh's own frame, metres, 3D) is within `TREE_LOD_REPACK_M` of the last sort. True when it sorted; false for a mesh this module did not make. Runs from each mesh's `onBeforeRender`, with the camera converted into the mesh's frame.
- `setTreeLodShare(mesh, share)`: the woods share for a trunk-form mesh; forces the next sort. Returns the trees the share draws, counted once per form (on the near crown mesh, 0 on the other three), or undefined for a foreign mesh. Called by `applyWoodsShare`, which validates the share.

## Invariants & assumptions

- Per tree, near / far: 52 / 26 triangles for a broad or untagged crown (7- and 5-sided crowns of three and two rings, 5- and 3-sided open trunks), 38 / 16 for a needle crown. The far crowns are the crown-only profiles.
- Profiles are O1's at a unit diameter (O1 drew them at a unit radius; halved here, since the crown is scaled by its diameter).
- The crown starts at 35 % (broad), 33 % (untagged) or 18 % (needle) of the tree's height, so crown base plus crown height is the true height; the trunk runs a quarter of the way into the crown so no gap shows.
- The distance is measured to the tree's mid-height, in 3D.
- Every tree is in exactly one level after a sort; a still camera costs nothing.
- Invented trees: only the first `ceil(total x share)` trees in rank order take part in the sort, so the governor thins this form exactly as the crown form.
- The geometry and the two materials are shared by every city (`sharedResources`, never disposed). The crown material is the crown form's (white, vertex colours, flat, roughness 0.9); the trunks are a bark grey-brown 0x5e564d, roughness 0.95.
- The eye is taken in the mesh's own frame (a consumer may move the city under a parent), as `street-furniture.ts` does.

## Examples

```ts
import { cityObjects } from "gps-plus-slam-osm/three";

for (const object of cityObjects(city, { treeForm: "trunk" })) root.add(object);
// nothing else: each tree mesh re-sorts itself before it renders
```

## Tests

`trunk-trees.test.ts`: O1's triangles per tree near and far; four meshes per form on shared resources, culling off, nothing before the first sort; the crown on the trunk with the true height and the girth fallback; near within 120 m and far beyond, each tree once; re-sorting only after a 2 m move, a foreign mesh untouched; the sort before render with the camera in the mesh's frame; the crown colour from the placement, the trunks one colour. `city-objects.test.ts` and `city-objects.property.test.ts` cover the form through `cityObjects` and the woods share.
