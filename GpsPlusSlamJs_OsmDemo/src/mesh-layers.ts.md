# `src/mesh-layers.ts`

## Purpose

One row per drawable mesh layer — what it builds into the scene, and what it
contributes to the status line. Replaces the branch-per-layer form that
`BuildingView.render` had grown into.

## Public API

- `DRAWN_BY_MESH` — the layer ids whose geometry comes out of the worker's mesh
  (`buildings`, `trees`, `plates`). The declared truth the table is checked
  against.
- `MeshLayers` — `Partial<Record<MeshLayerKind, boolean>>` (the union is module-
  internal; reach it via `MeshLayerDescriptor["layer"]` if ever needed). Partial
  on purpose:
  an omitted layer falls back to its row's `defaultOn`.
- `BuildingStats` — the eight counters. Always fully populated.
- `MeshLayerDescriptor` — `{ layer, defaultOn, build(mesh), counters(mesh) }`.
- `MESH_LAYERS: readonly MeshLayerDescriptor[]` — the table.
- `drawMeshLayers(mesh, layers?) → { objects, stats }` — builds every enabled
  layer. No error modes: an empty layer yields no objects, and an unknown key in
  `layers` is ignored because the loop is driven by the table, not by the input.
- `meshLayerSelection(layers: LayerSet) → MeshLayers` — narrows the registry's
  full set to the mesh layers.
- `wantsAnyMeshLayer(layers: LayerSet) → boolean` — whether `render` has
  anything to do.
- `treeConePosition(tree) → [x, y, z]` — the scene position of one tree's cone.
  Re-exported from `building-view.ts` for existing call sites.

## Invariants & assumptions

- **The table must cover exactly `DRAWN_BY_MESH`, and `mesh-layers.test.ts`
  asserts it.** This is the reason the module exists rather than a tidiness
  argument. A layer with no row draws nothing, counts nothing and throws
  nothing — indistinguishable from a layer whose data happened to be empty.
  That is the same silent-absence shape as the `scene.environment` shader
  outage, which hid every `MeshStandardMaterial` for ten work items.
  - Adding a builder means adding its id to `DRAWN_BY_MESH` **and** a row. The
    test fails if you do only one.
- **`defaultOn` is `true` only for the two layers the demo shipped with.**
  Anything added since defaults to off, because the registry migration is only
  checkable against a known-good before (W10). A new layer that switched itself
  on would destroy that baseline.
- **Counters describe what was DRAWN, not what was available.** The result
  starts from an all-zero object and each enabled row overwrites only its own
  fields. A layer that is off therefore reports 0 rather than the mesh's value —
  a status line describing geometry that is switched off makes the number and
  the picture disagree with no way to tell which is lying.
- **`stats` is always fully populated (8 keys).** A missing key reads as
  `undefined` in the status line rather than as 0, and `toBeGreaterThan(undefined)`
  passes — a defect this repo has already shipped once via a dropped field in
  `buildHeightfieldData`.
- **Ground layers take their lift from `layer-order.ts`, never a local
  constant.** Five things want to be at y ≈ 0 and any two that end up coplanar
  z-fight; a layer that lifted itself would sit outside that guarantee while
  looking correct in isolation.
- **Rows build `three` objects directly**, unlike `sky-gradient.ts` which stops
  at pixels. That split exists where there is arithmetic worth proving without a
  GPU; wrapping worker-validated buffers in a `BufferGeometry` has none. three's
  geometry and material classes are plain JS and construct fine in vitest — only
  `WebGLRenderer` needs a context.
- **Order in the table is construction order only.** `layer-order.ts` owns the
  vertical ladder, and paint order at ground level follows from that. The
  coverage test sorts before comparing so it does not pin the order twice.

## Examples

```ts
// Draw the demo's default picture: buildings + trees, no plates.
const { objects, stats } = drawMeshLayers(mesh);
for (const object of objects) group.add(object);

// Drive it from the registry, without naming any layer.
if (wantsAnyMeshLayer(layers)) {
  view.render(mesh, meshLayerSelection(layers));
}
```

Adding a layer (W13 roads, say) is one id and one row:

```ts
export const DRAWN_BY_MESH = ["buildings", "trees", "plates", "roads"] as const;
// ...
{
  layer: "roads",
  defaultOn: false,
  build: (mesh) => (mesh.roads.triangleCount === 0 ? [] : [roadMesh(mesh)]),
  counters: (mesh) => ({ roads: mesh.roadCount }),
}
```

No change to `BuildingView.render` and none to `main.ts`.

## Tests

`mesh-layers.test.ts` — 13 tests in four groups:

- **the table itself** — coverage against `DRAWN_BY_MESH`, ids are real registry
  members, no duplicate rows, defaults reproduce W10's baseline.
- **what reaches the scene** — every enabled layer draws, a disabled one draws
  nothing, an enabled-but-empty one adds no object (an empty `BufferGeometry` is
  still a draw call and a disposal obligation), plates take the shared lift, and
  an omitted selection gives the baseline picture.
- **the counters** — a layer that is off zeroes its own fields and leaves the
  others alone; everything on counts everything; the result always has all eight
  keys.
- **`meshLayerSelection`** — picks exactly the mesh layers out of the full set.

`building-view.test.ts` still covers `treeConePosition` through the re-export.
