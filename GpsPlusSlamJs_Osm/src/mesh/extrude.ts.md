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
- **Emitters work in the ENU frame, and every one must compensate for Y-up.**
  With Y up, a counter-clockwise ring in `(east, north)` reads as _clockwise_
  seen from +Y. So `addWalls` emits `(i0, i2, i1)` and `addCap`/`flatCap` emit
  `(a, c, b)`
  rather than the natural order. Forgetting this in one emitter produces a
  surface that is lit correctly and culled backwards — invisible under a normal
  renderer, and invisible to a screenshot taken with `side: DoubleSide`, which
  is how it survived a full PR.
- **A footprint that cannot form a volume yields an empty mesh**, never a throw.
- **The return type is `ExtrudedBuilding` — `MeshData` plus
  `roofIsApproximate`.** `roof.ts` promises that a consumer wanting to know how
  much of what it draws is real can ask; returning a bare `MeshData` meant none
  could, and the demo substituted a roof-shape test that answers a different
  question. Extending rather than wrapping keeps `mergeMeshes` and every other
  `MeshData` consumer working unchanged.
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

`mesh-orientation.test.ts` — the two orientation invariants, over every roof
shape and over rings that differ in winding and in starting corner: the emitted
winding agrees with the assigned normal, and no normal points back into the
volume. These are separate checks because `roof.ts` derives its normals _from_
its winding, so the first is structurally unable to fail there.
