# `world-cost.ts` - what a kind's world part costs, and whether it moved

## Purpose

The item lab's readout for a kind's world part (`item-lab.ts`): draw calls and triangles counted from the part's own objects, so a prototype can be compared with the per-item budget, and a key that tells a still part from a moving one, so the lab can show that the editor's part stands still.

## Public API

- `worldCost(root)` - `{ calls, triangles }` of everything visible under `root`: a mesh in one material is one call, a mesh in a list of materials one call per geometry group whose material is in the list (as three draws it); its triangles from the index (or the vertices of an unindexed geometry) divided by three, per drawn group for a list, an `InstancedMesh`'s times its `count`. A `Sprite` is one call and two triangles, `Points` and every `Line` (segments and loops too) one call and none.
- `poseKey(root)` - one string of every object's local position, quaternion and scale, `root` included.

## Invariants and assumptions

- Counted from the objects, not from `renderer.info`, which counts the whole scene (ground, figure) and only after a render.
- A hidden object hides its subtree (`traverseVisible`), as the renderer does. Frustum culling is not counted: a part's cost is the cost of seeing it.
- Materials with several passes (a double-sided transparent material) cost the renderer more than one call; the count does not say so.
- The budget the readout is compared with is provisional (about 30 calls and 50 000 triangles per item, not yet measured on a phone).

## Example

```ts
worldCost(part.object); // { calls: 2, triangles: 52 }
const still = poseKey(part.object) === lastKey;
```

## Tests

`world-cost.test.ts`: calls and triangles of shown meshes and instances, hidden subtrees, an unindexed geometry, material groups (six materials, one material, a group naming no material), points, lines and a sprite, an empty part, and the pose key.
