# `mesh/trees.ts`

## Purpose

Tree placement as instancing data: position, rotation, scale, variant and
colour, plus what a tree is from its tags (`treeClass`). No geometry.

## Public API

- `buildTrees(features, { frame, groundHeightM? }): TreePlacement[]`
- `packInstances(placements): Map<TreeVariant, TreeInstances>`, where
  `TreeInstances` is `{ positions, scales, rotations, colours }`; `colours`
  is sRGB channels 0 to 1, three per instance, for the renderer to convert
- `treeClass(tags): TreeClass`, `{ leafType, leafCycle, source }`:
  - `leafType`: broadleaved, needleleaved, mixed or unknown;
  - `leafCycle`: deciduous, evergreen or unknown;
  - `source`: `leaf_type`, `wood`, `genus` or `none`
- `treeColour(cls, key, jitter = TREE_COLOUR_JITTER): number`, packed sRGB
- `TREE_PALETTE` (a `Map`, key `leafType/leafCycle` or `unknown`)
- `isTree(feature)`, `stableHash(text)`
- `DEFAULT_TREE_HEIGHT_M` (8), `DEFAULT_CROWN_RATIO` (0.6),
  `MAX_TREE_HEIGHT_M` (60), `MAX_TREE_CROWN_M` (40),
  `TREE_COLOUR_JITTER` (0.16)

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
  - **It had no production caller until W6 (2026-07-31).** The demo allocated a
    fresh `ConeGeometry` and material per tree instead, so the design's whole
    point — a forest in a handful of draw calls — was written, tested and never
    reached. Worth recording because "the function exists" and "the function is
    used" looked identical from inside this package.
- **Leaf type comes from `leaf_type` OR `wood`, and `leaf_type` wins.** `wood`
  is the older key and is still widely tagged; `deciduous` maps to broadleaved
  and `coniferous` to needleleaved, matching OSM2World's `TreeModule`. A feature
  carrying both is mid-retagging, so the newer key is the one someone last
  checked.
  - `wood=yes` stays `unknown`: it is not a leaf-type claim. `mixed` (either
    key) is its own class; one tree has one form, so its variant is `unknown`.
  - The tables are `Map`s: on a plain object `leaf_type=constructor` found an
    inherited function and the tree was dropped; prototype names now read as
    `unknown`.
  - **A closed genus list, read as a leaf type only.** After the two keys,
    the first word of `genus`, `species` or `taxon` is looked up in a list of
    48 genera whose leaf type is not in doubt (Quercus, Tilia, Pinus, ...). It
    never picks a shape, a size or a species look, and a genus not on the
    list leaves the tree `unknown`: free text is read only where the reading
    cannot be wrong. Larch-type genera (Larix, Metasequoia, Taxodium) are
    needleleaved and deciduous.
  - **`leaf_cycle` is the cycle, never the type.** It picks the light
    deciduous or the dark evergreen green; a tree tagged only
    `leaf_cycle=deciduous` keeps the cycle and stays of unknown type, because
    deciduous does not mean broadleaved (a larch is both).
  - This matters more than it looks: `variant` is the only thing standing
    between the renderer and drawing every tree as the same fir (R4-3), so every
    tree left at `unknown` is a tree that cannot be drawn correctly.
- **Two frames, and the boundary between them is `packInstances`.**
  `TreePlacement.position` is ENU (`+y` north) because a placement is not a
  buffer; `packInstances` emits the RENDER frame (`+x` east, `+y` up, `−z`
  north), the same frame `MeshData` documents. Packing raw ENU into `+z` — which
  it did until 2026-07-29 — mirrors a forest north/south against its own
  buildings, and because the trees stay consistent with each other it reads as a
  data or heading problem rather than a sign error. A consumer doing its own
  packing from `TreePlacement` must apply the reflection itself.
- **Only `natural=tree` nodes.** `natural=wood`, `landuse=forest`,
  `landuse=orchard` and `natural=tree_row` imply trees nobody mapped one by
  one; `cosmetic-trees.ts` invents those (city objects plan 2026-11-07-2315
  M2a), as the same placement type flagged `cosmetic: true`, and `buildCity`
  keeps them in their own field.
- **Colour per class, muted, deterministic** (city objects plan
  2026-11-07-2315 M1, ported from the O1 quiet-greens lab the owner chose).
  `TREE_PALETTE` is sRGB, chroma 19 to 40 (max minus min channel) against
  the old 62. A hash of the feature key (`unit(key, "l")`) moves lightness by
  up to plus or minus 8 percent. The colour rides on the placement and in
  `packInstances`' `colours` as sRGB; converting it to a renderer's working
  space is the renderer's job (`three/city-objects.ts` does it through
  `THREE.Color`, section 7 of that plan).
- **Tagged sizes are refused above 60 m (height) and 40 m (crown)**, and at
  or below zero: a refused value falls back to the untagged rule (8 m times
  0.75 to 1.25, crown 0.6 times the height) rather than drawing a typo.
  `circumference` is not read yet: it sizes a trunk, and trees are crown-only
  until the trunk option.

## Examples

```ts
const placements = buildTrees(features, { frame });
for (const [variant, buffers] of packInstances(placements)) {
  // one InstancedMesh per variant
}
```

## Tests

`trees.test.ts` — the class table (every vocabulary value, prototype names,
the `leaf_cycle` hint, the genus list, larch-type genera), the palette per
class, the lightness spread, variant and colour on placements, the size
refusals, and the packed colours.

`trees.property.test.ts` — every colour stays muted (chroma at most 45) and
deterministic per key; any tag soup classifies into the closed vocabulary.

`buildings.test.ts` — one instance per node, determinism across calls, variation
between untagged trees, tagged height winning, `leaf_type` and `wood` mapping to
a variant (including which wins when both are present),
variant-grouped packing, and hash stability.

`mesh-orientation.test.ts` — the frame split above: a tree 50 m north packs to
`z ≈ −50` while its placement keeps `position.y ≈ +50`. That file is where every
"which way is north" assertion in the package lives.

## Colour schemes (OSM demo colour schemes plan 2026-11-10-0841)

- `TreeKey` names the seven keys of `TREE_PALETTE`.
- `treeColour(cls, key, jitter?, palette?)`: the palette is an optional
  fourth parameter (default `TREE_PALETTE`); the jitter applies to any
  palette.
- `BuildTreesOptions.treePalette` passes a scheme's `trees` through
  `buildTrees`; absent, `TREE_PALETTE`.
