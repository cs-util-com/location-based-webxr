# `three/city-objects.ts`

## Purpose

The city as three.js objects, behind the package's opt-in entry point
`gps-plus-slam-osm/three`: building chunks as meshes, trees as instanced
meshes, and a disposal that never frees shared resources. Moved from
OsmDemo's `mesh-layers.ts` (its buildings and trees rows and its geometry
wrapper) when the globe lab became the package's second consumer (globe city
plan 2026-10-05-0040 §14 L5, the owner's D-K6). The package's core stays
three-free; three.js is an optional peer, loaded only by this entry.

## Public API

- `geometryFrom(data, colors?, shell?)` → `BufferGeometry` with `position`,
  `normal`, the index, and, when given, `color` (per-vertex RGB),
  `aHeight01` and `aFeatureRand` (the AR shell shader's inputs).
- `buildingObjects(chunks)` → one `Mesh` per `MeshChunk`, each with its own
  `MeshStandardMaterial` (white, `vertexColors`, `FrontSide`, `flatShading`,
  roughness 0.55, metalness 0, `userData.neutralSurface`) and
  `userData.solid` and `userData.cityLayer = "buildings"` on the mesh.
- `treeObjects(placements)` → one `InstancedMesh` per tree variant present
  (`packInstances` groups and reflects ENU to scene), on shared geometry and
  material, each flagged `userData.sharedResources`, each instance coloured
  through `instanceColor` from the placement sRGB colour (converted with
  `SRGBColorSpace`). Empty in, empty out.
- `roadObjects(chunks)` → one mesh per road chunk (`buildCity` with
  `roads`), OsmDemo's look moved here (round-4 plan 2026-10-11-0122
  DEC-R4-7): white plus vertex colours, opaque (a vertex disc overlaps its
  quads; translucent, junctions double-blend), single-sided, flat,
  roughness 0.9, `userData.neutralSurface`; each carries
  `userData.cityLayer = "roads"` and lies at its ground (the lift off a
  drawn ground is each app's: OsmDemo's ladder, the globe's relief).
- `cosmeticTreeObjects(placements)` → `treeObjects` for `City.cosmeticTrees`,
  each mesh flagged `userData = { sharedResources: true, cosmetic: true }`
  so an app can hide the invented trees (OsmDemo's `woods` layer, AR)
  without touching the mapped ones. Instances keep the build's rank order
  within each form (`packInstances` preserves order), so drawing the first n
  thins a wood evenly (city objects plan 2026-11-07-2315 M2a; the phone
  governor of M2b).
- `cityObjects(city)` → buildings, then trees, then the cosmetic trees (when
  the city has them), then roads (when the city has them), for a
  `buildCity` result.
- `disposeCityObjects(objects)` → disposes each mesh's geometry and
  materials, skipping any object flagged `sharedResources`.

## Invariants & assumptions

- **A material per building chunk.** Identical materials share one compiled
  program, so the cost is a small object, never a draw call; a hoisted
  shared material is either disposed on the first refresh or leaks a chunk's
  own geometry.
- **The building look**, as OsmDemo settled it over several rounds: white
  plus vertex colours (the palette arrives per vertex; a tinted base would
  tint it), single-sided (the winding is proved by `mesh-orientation.test.ts`,
  so double-siding would only hide a missing floor at twice the fragment
  work), flat-shaded, roughness 0.55 (a highlight on facades, and clear of
  the ground's 0.42; a guard keeps buildings above 0.5 so they never read as
  glass).
- **`userData.solid`** marks a mesh as a picking blocker; per chunk, so it
  cannot tell which building in it is passable (a canopy still swallows a
  click; filed in OsmDemo).
- **`userData.cityLayer`** names the layer: `"buildings"` on a building
  chunk, `"roads"` on a road. A consumer keys a layer-only treatment on it,
  never on `solid` (the globe's building light, `globe-city.ts`; #905
  review): the picking marker may change for picking's sake.
- **Tree resources are shared and made on first use**, not at import, so
  importing the entry costs nothing. Three.js does not throw for a disposed
  geometry, it silently draws nothing, which is why they are flagged and
  never disposed. Unit-sized with the base at y = 0: the instance matrix is
  composed straight from `packInstances` (position, a rotation about the
  vertical, a (crown, height, crown) scale). Low segment counts on purpose
  (an AR overlay before a desktop scene; the flat low-polygon look is the
  house style).
- **Crown-only forms, ported from the O1 quiet-greens lab** (city objects
  plan 2026-11-07-2315 M1): a hull of revolution, 5 sides, poles at y 0 and
  y 1, the crown tapering to the ground (no trunk, the owner default). Broad
  and neutral are 20 triangles, needle (a cone) 10. An `unknown` leaf type is
  the NEUTRAL form, a narrower plain egg, never the fir cone it was before
  (DEC-R4-10: no confident wrong shape). Radii are half the lab profile
  values because the unit crown here has unit diameter (the instance scale is
  `crownDiameterM`), the lab unit radius with a half-crown scale.
- **The tree material is white, vertex-coloured, flat, roughness 0.9.** The
  instance colour carries the class; the per-vertex grey (0.86 at the foot to
  1.04 at the top) darkens the underside and is raw, as in the lab. The
  colour is converted from sRGB through `THREE.Color`, the colour-space rule
  of section 7 of that plan for trees.
- One three.js copy: the package's three is a dev dependency at the
  consumers' version and external in the build, so `instanceof` checks in a
  consumer still hold.

## Examples

```ts
import { buildCity, cityGround, enuFrameAt } from "gps-plus-slam-osm";
import { cityObjects, disposeCityObjects } from "gps-plus-slam-osm/three";

const city = buildCity(features, cityGround(enuFrameAt(origin), field));
const objects = cityObjects(city);
for (const o of objects) root.add(o);
// later
disposeCityObjects(objects);
```

## Tests

`city-objects.test.ts` - the geometry's attributes with and without the
optional ones; one mesh per chunk with the settled material and flags, a
material per chunk; one instanced mesh per variant present on shared
resources, none for no trees; the instance colour converted from sRGB; the
three forms (triangle counts, vertex shade, unit bounds, the material); disposal freeing a building's own geometry and
material and never the trees' shared geometry; the road row's material,
layer flag and zero lift, and roads in `cityObjects` only when built; the
cosmetic meshes flagged, one per form, in rank order, and drawn by
`cityObjects` only when the city has them. OsmDemo's
`mesh-layers.test.ts` covers the rows that delegate here.
