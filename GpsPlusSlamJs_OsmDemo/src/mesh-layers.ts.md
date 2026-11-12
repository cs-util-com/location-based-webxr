# `src/mesh-layers.ts`

## Purpose

One row per drawable mesh layer — what it builds into the scene, and what it
contributes to the status line. Replaces the branch-per-layer form that
`BuildingView.render` had grown into.

Since 2026-10-06 the buildings and trees rows build through the Osm library's
`gps-plus-slam-osm/three` (`buildingObjects`, `treeObjects`; since 2026-10-11
the roads row too, `roadObjects` plus this demo's lift, round-4 plan
2026-10-11-0122 DEC-R4-7), and every row
wraps its buffers with the library's `geometryFrom`: the globe draws the same
city (globe city plan 2026-10-05-0040 §14 L5). The tree resources and the
building material, with the reasons behind each choice, are documented there
(`GpsPlusSlamJs_Osm/src/three/city-objects.ts.md`); this file keeps the rows,
the counters and the layers only OsmDemo draws.

## Public API

- `DRAWN_BY_MESH` — the layer ids whose geometry comes out of the worker's mesh
  (`buildings`, `trees`, `woods`, `plates`, ...). The declared truth the table is checked
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
- `showCosmetic(root, visible)` - shows or hides every object under `root`
  tagged `userData.cosmetic` (the woods layer), leaving mapped objects alone.
  Absolute, so idempotent after a rebuild. `BuildingView.setArShellMaterial`
  calls it: the woods are off in AR (owner decision, objects M2a).
- `showFurniture(root, visible)` - shows or hides every object under `root`
  tagged `cityLayer: "furniture"` (the furniture layer). Absolute, so
  idempotent after a rebuild. `BuildingView.setArShellMaterial` calls it:
  lamps and bollards are off in AR (toggles plan 2026-11-10-1902 T2).
- `meshLayerSelection(layers: LayerSet) → MeshLayers` — narrows the registry's
  full set to the mesh layers.
- `wantsAnyMeshLayer(layers: LayerSet) → boolean` — whether `render` has
  anything to do.
  (`treeConePosition` was removed in W6 — trees are instanced and the package's
  `packInstances` supplies both the grouping and the ENU→scene reflection.)

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
- **Three `userData` keys are picking CONTRACTS, not decoration.** `regionId` and
  `poiInstances` make an object selectable; **`solid` (stage 4, DEC-R11-17) makes
  a building a BLOCKER** — `building-view.ts` puts every object carrying one of
  the three into the raycast set, and `resolvePick` stops at the first `solid`
  one without ever returning it. The marker and the membership are one fact
  rather than two that can disagree.
  - Barriers extrude with the buildings (DEC-R11-11), so a wall blocks the click
    for the same reason it blocks the agent, with no separate row.
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

## The noon brightening

`applyBuildingSkyLight(root, environment, environmentIntensity, k)` is the
light dialog's sky light on buildings (plan 2026-09-24-2140): the building
materials (the `aHeight01` geometry) get the scene's environment as their
OWN envMap at `environmentIntensity × k`, because three overwrites a
material's `envMapIntensity` with the scene's whenever it has no envMap of
its own. Called before every render (a sun change re-bakes the environment
into a new texture); `k = 1` or no environment restores three's own path;
only adding or removing the envMap recompiles; `RangeError` for a `k` that
is not positive and finite.

The building and road materials carry `userData.neutralSurface`, and
`applySurfaceGain(root, gain)` sets their colour factor (absolute, so a
re-apply after a rebuild is idempotent; `RangeError` for a gain that is not
positive and finite). Only those two layers: they are nearly grey, so a lift
adds brightness without the colour that competes with the heat grid (plan
2026-09-24-0901). A mesh wearing a swapped material (the AR shell) is
skipped, since the tag is on the desktop material.

## Tests

`mesh-layers.test.ts` — the groups below, plus the noon brightening (only
the two tagged materials scale, idempotent, bad gains refused):

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

- **The AR sun shadow's caster tag** (shadow plan M3): a GROUND POI bucket is
  tagged `markArShadowCaster` where it is built; a roof-hosted (`@host`)
  bucket is not, because its real building casts the real shadow. Tested in
  `poi-host-placement.test.ts`.
- **The instanced trees (W6)** — one `InstancedMesh` per variant rather than one
  `Mesh` per tree, distinct geometry per variant, the instance matrix's position
  and scale, and the `sharedResources` flag that stops `clear()` disposing a
  geometry every later frame depends on.

## The woods layer (objects M2a, city objects plan 2026-11-07-2315)

- Row `woods`: `cosmeticTreeObjects(mesh.cosmeticTrees)` from the Osm library,
  the invented trees of woods, orchards and tree rows (`mesh/cosmetic-trees.ts`).
  On by default (owner), counter `woods`. Its instanced meshes carry
  `userData.cosmetic = true` and are never in the pick set: picking one
  resolves to no feature, because there is none.
- Hidden in AR by `showCosmetic` (above). Tests: `mesh-layers.test.ts`
  ("the woods layer", "showCosmetic"), `building-view-content.test.ts`.

## The furniture layer (city objects plan 2026-11-07-2315 M5)

- Row `furniture`: `streetFurnitureObjects(mesh.furniture)` from the Osm
  library: mapped street lamps and bollards (the worker builds only these two
  kinds; benches and bins are the `poi` layer's), one instanced mesh per model,
  drawing the items within 80 m of the camera and repacking after it moves
  4 m. Counter `furniture` is what was built, not what the cut draws.
- Tagged `cityLayer: "furniture"`, NOT `cosmetic`: the items are mapped, so
  they keep their own flag. On by default (toggles plan T2), off with the
  layer switch at draw time (no rebuild) or `?furniture=off` at boot.
- Hidden in AR by `showFurniture` (above); a hidden mesh is never rendered, so
  its cut does not repack in AR. Tests: `mesh-layers.test.ts` ("the furniture
  layer"), `building-view-content.test.ts`.

## Plates colour (colour schemes plan 2026-11-10-0841)

`MeshLayerContext.plateColour?` colours the plates; absent is `PLATE_COLOUR`.
`main.ts` passes the colour of the scheme the drawn mesh was built in.
Tested in `mesh-layers.test.ts`.

## Invented roof count

`BuildingStats.inventedRoofCount` carries the mesh's count of volumes with an
invented pitched roof, zero while the buildings layer is off like every other
buildings counter; the status line shows it beside the guessed heights.

## The tree form

`MeshLayerContext.treeForm` (`?treeform=trunk`, read by `main.ts` through
`woods-readout.ts`) reaches both tree rows, the mapped `trees` and the
invented `woods`, as the library's `TreeObjectOptions.form`; absent draws
the crown-only default. Both rows take it so a trunk-form measurement
covers every tree. Tested in `mesh-layers.test.ts` ("the tree form").
