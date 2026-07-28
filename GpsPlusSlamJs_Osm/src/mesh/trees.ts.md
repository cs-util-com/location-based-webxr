# `mesh/trees.ts`

## Purpose

Tree placement as instancing data — position, rotation, scale, variant. No
geometry.

## Public API

- `buildTrees(features, { frame, groundHeightM? }): TreePlacement[]`
- `packInstances(placements): Map<TreeVariant, { positions, scales, rotations }>`
- `isTree(feature)`, `stableHash(text)`
- `DEFAULT_TREE_HEIGHT_M` (8), `DEFAULT_CROWN_RATIO` (0.6)

## Invariants & assumptions

- **This file emits NO geometry.** Trees are numerous and identical up to a
  transform, which is exactly what `InstancedMesh` exists for — a few shared
  geometries plus per-instance matrices draws a forest in one call. §8.2 calls
  this the one part of the 3D work that is straightforwardly a win on mobile.
  Keeping geometry out keeps the package free of `three` and keeps the
  interesting decisions (billboard vs. real geometry, LOD distance) with the
  renderer.
- **Determinism is part of the contract, not an implementation detail.**
  Randomness is an FNV-1a hash of the feature key, never `Math.random()`. This
  is an AR overlay used to judge pose accuracy: a forest that reshuffles between
  frames — or between two phones standing next to each other — is useless for
  that. OSM2World seeds from position for the same reason.
- **Untagged trees vary deterministically** (±25 % height), so a row does not
  look like clones while still being reproducible.
- **`packInstances` groups by variant**, because one `InstancedMesh` draws one
  geometry; a single mixed buffer would force the consumer to un-mix it.
- **Only `natural=tree` nodes.** `natural=wood`, `landuse=forest` and
  `natural=tree_row` need a scatter over an area or along a line — the same
  placement type, a different generator, and a well-defined follow-up rather than
  a guess.
- Species is not inferred from `genus`/`species` free text: a wrong species is no
  better than `unknown`, and those values are not a controlled vocabulary.

## Examples

```ts
const placements = buildTrees(features, { frame });
for (const [variant, buffers] of packInstances(placements)) {
  // one InstancedMesh per variant
}
```

## Tests

`buildings.test.ts` — one instance per node, determinism across calls, variation
between untagged trees, tagged height winning, `leaf_type` mapping to a variant,
variant-grouped packing, and hash stability.
