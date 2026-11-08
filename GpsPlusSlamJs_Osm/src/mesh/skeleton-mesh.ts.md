# skeleton-mesh.ts

## Purpose

Turns a `SkeletonRoof` (`roof-skeleton.ts`) into triangles: heights from
`t`, one flat normal per face from its plane, and no cracks along the ridges.

## Public API

- `skeletonMesh(roof, { eaveM, slope }): { mesh, surfaceVertices }`
  - height of a point = `eaveM + t * slope`; `roof.ts` passes
    `slope = rise / roof.ridgeT`, so the top lands on the tagged ridge height.
  - `mesh`: a `MeshData` in the builder's (east, up, north) frame.
  - `surfaceVertices`: vertices `[0, surfaceVertices)` are slopes and caps,
    the rest are vertical gables, so a caller colours by position, not by
    normal.

## Invariants and assumptions

- Normals: a slope's is `normalize(-slope * nx / w, 1, -slope * ny / w)` for
  the face's inward wall normal `n` and weight `w`; a gable's is the outward
  wall normal `(-nx, 0, -ny)`; a cap's is straight up. Every triangle is wound
  so its geometric normal agrees with that.
- Stitching, because simultaneous events leave corners a hair apart and
  T-junctions along a ridge (pinholes of sky):
  - eave corners (`t === 0`) are registered first, exactly, and never moved
    or merged: they are the wall tops;
  - every other corner welds to the nearest registered corner within
    `WELD_M` (3 mm), found through a grid hash, but never onto an eave
    corner: near a sharp eave corner the two faces' copies of one event
    would otherwise land one on the wall top and one beside it;
  - a triangle takes in every registered corner within `ON_EDGE_M` (2 mm) of
    one of its edges (endpoints excluded) in ONE pass: its corners and those
    edge corners form a polygon, fanned from the polygon's centre. A
    recursive split looped forever on two corners a few millimetres apart,
    each on an edge of the other's half;
  - an out-and-back spike in that polygon (a corner just inside a triangle
    corner lies on both edges that meet there) is cut, and a sliver whose
    corner lies on its opposite edge reduces to nothing and is dropped: the
    neighbours across those edges close the gap between themselves.
- **The result is checked, and a failure is a `SkeletonFailure`.** Every edge
  above the eaves must be used by exactly two triangles, in opposite
  directions. A face with three corners on one line can still fold when its
  corners are welded; measured on 4,000 random stars, no hipped and about
  1 in 670 gabled roofs fail on their first nudge, and all close on the
  second. `roof.ts` then takes its next rung, so a fold or a crack never
  reaches the screen.
- **Sweep of the weld and edge distances** (weld / edge; 4,000 random stars
  of 13 to 40 corners, plus the 508 ridged roofs of the test corpus;
  2026-11-08). "First" counts roofs whose first nudge failed, "both" those
  that failed both:
  - 1 / 0.7 mm: hipped first 0, gabled first 6, both 0; corpus prisms 2;
  - 2 / 1.5 mm: 0, 6, 0; prisms 2;
  - 3 / 2 mm (kept): 0, 6, 0; prisms 2;
  - 4 / 3 mm: 0, 8, 0; prisms 2;
  - 6 / 4 mm (the plan's value): hipped first 3 (both 2), gabled first 10
    (both 2); prisms 3;
  - 12 / 8 mm (2,000 stars): hipped first 4 (both 3), gabled first 5
    (both 3).
  - The verdict holds from 1 to 4 mm and turns above it: a weld that wide
    merges distinct corners of a narrow face. 3 mm sits in the middle of the
    clean range and still closes the hair-wide gaps simultaneous events leave.
- With a caller-given offset ring (an invented roof's soffit), the eave corners
  are the offset ring's: the roof is closed against that ring, and the soffit
  between it and the walls is the caller's to draw.

## Examples

```ts
const roof = skeletonRoof([footprint], { gableEnds: { kind: "neighbours" } });
const { mesh, surfaceVertices } = skeletonMesh(roof, {
  eaveM: 7,
  slope: 3 / roof.ridgeT,
});
```

## Tests

- `mesh-orientation.test.ts`: the skeleton roof among the shapes, outward
  normals and winding.
- The mesh properties in `roof-skeleton.property.test.ts`: normals up on
  every surface, gables vertical, edge-manifold with the eave ring as the
  only open boundary (a soffit ring for an offset ring), over random stars
  with and without gables; a star whose skeleton or mesh refuses is skipped
  (the ladder handles it, `roof.test.ts` pins a retry and a fallback).
- `s3db-roof-tags.test.ts`: heights and coverage through `buildBuildings`.
