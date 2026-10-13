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
  `userData.solid` on the mesh.
- `treeObjects(placements)` → one `InstancedMesh` per tree variant present
  (`packInstances` groups and reflects ENU to scene), on shared geometry and
  material, each flagged `userData.sharedResources`. Empty in, empty out.
- `cityObjects(city)` → buildings then trees, for a `buildCity` result.
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
- **Tree resources are shared and made on first use**, not at import, so
  importing the entry costs nothing. Three.js does not throw for a disposed
  geometry, it silently draws nothing, which is why they are flagged and
  never disposed. Unit-sized with the base at y = 0: the instance matrix is
  composed straight from `packInstances` (position, a rotation about the
  vertical, a (crown, height, crown) scale). Low segment counts on purpose
  (an AR overlay before a desktop scene; the flat low-polygon look is the
  house style). `unknown` leaf type keeps the cone drawn before the type was
  read.
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
resources, none for no trees; disposal freeing a building's own geometry and
material and never the trees' shared geometry. OsmDemo's
`mesh-layers.test.ts` covers the rows that delegate here.
