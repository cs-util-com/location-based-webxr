# `mesh/extrude.ts`

## Purpose

Footprint plus heights to a triangle mesh: walls, roof, and optionally a floor.

## Public API

- `extrudeBuilding(rings, options): MeshData`
- `mergeMeshes(meshes): MeshData`
- `interface ExtrudeOptions` — `minHeightM`, `eaveHeightM`, `totalHeightM`,
  `roofShape`, `groundHeightM?`, `includeFloor?`

## Invariants & assumptions

- **Output is plain typed arrays, never three.js objects.** The package must not
  depend on `three` (§4.2); the consumer app turns these buffers into a
  `BufferGeometry` and owns the `new Worker(...)` call — the same split the
  framework already uses for the occupancy mesher.
- **Geometry is in local ENU metres.** See `enu.ts` for why degrees and
  unprojected Mercator metres are both wrong, smoothly and plausibly.
- **Every ring gets walls, holes included.** A courtyard has inner-facing walls;
  omitting them leaves a building you can see straight through from inside the
  yard. Outer rings face outward, holes inward — reversed winding makes a
  courtyard invisible under backface culling while looking fine in a vertex-count
  test.
- **A floating part gets its underside.** `min_height > 0` means the volume is
  seen from the street below, which is exactly what `building:part` creates.
- **Zero-length walls are skipped** — a repeated node would otherwise emit a
  degenerate quad with an undefined normal.
- **A footprint that cannot form a volume yields an empty mesh**, never a throw.
- **Batch per res-8 or res-9 cell, never per fetch tile.** A fetch tile is res 7
  (2.81 km across); one merged geometry spanning 2.8 km defeats frustum culling
  entirely, since the batch is only ever wholly visible or wholly not. Fetch
  resolution and render-batch resolution are different concerns.

## Examples

```ts
const mesh = extrudeBuilding([outer, courtyard], {
  minHeightM: 0,
  eaveHeightM: 9,
  totalHeightM: 13,
  roofShape: "gabled",
});
```

## Tests

`buildings.test.ts` — wall/cap counts and vertical extent, `min_height`, the
ground offset, horizontal wall normals, courtyard walls, the empty-mesh
contract, and merging with index re-basing.
