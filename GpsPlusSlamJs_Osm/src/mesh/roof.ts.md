# `mesh/roof.ts`

## Purpose

Roof geometry above the eaves, in the plan's own order of quality-per-effort.

## Public API

- `buildRoof(rings, cap, options): RoofMesh` — `MeshData` plus `isApproximate`
- `interface RoofOptions` — `shape`, `eaveHeightM`, `ridgeHeightM`

## Invariants & assumptions

- **Flat is the universal fallback**, used for `flat`, for no rise, and for every
  shape this file cannot generate.
- **`pyramidal` is exact**: one apex above the footprint's CENTROID, one triangle
  per edge. The centroid rather than the bbox centre because an L-shaped
  footprint's bbox centre can fall outside the building, and an apex hanging in
  the air outside its own walls is the most obviously wrong thing possible.
- **`dome` is approximated by a pyramid** to the same apex, and says so. At
  walking distance under a shallow viewing angle the two are near
  indistinguishable (§8.4); a real dome needs a tessellation not worth its
  triangles until something is seen from above.
- **`skillion` slopes along the footprint's longest axis.** `roof:direction` is
  not read yet — a small, well-defined follow-up. Its vertices carry the sloped
  **plane's own normal**, not `(0, 1, 0)`; with the flat normal it shades exactly
  like a flat roof and the slope shows only in silhouette, so the tag looks like
  it did nothing.
- **`gabled` and `hipped` come from the oriented minimum bounding rectangle.**
  Gabled runs the ridge the full length so the ends are vertical gable walls;
  hipped pulls the ridge in by a quarter at each end so all four sides slope.
  **Exact for a rectangular footprint, an approximation otherwise, and
  `isApproximate` says which.**
  - **A footprint with HOLES is always approximate on this path.** `ridgeRoof`
    reads `rings[0]` and nothing else, so a courtyard building gets a solid
    ridge roof spanning the courtyard while `isRectangular(outer, box)` is
    perfectly true of the outer ring — the one case where the flag would assert
    something false rather than merely be conservative, and not rare in the
    European blocks this package targets. The flat, apex and skillion paths all
    pass `rings` to `triangulate` and do honour holes.
- **The straight skeleton is deliberately NOT implemented.** A gabled roof on a
  non-rectangular footprint cannot be generated exactly without one — the
  skeleton IS the mathematical description of a roof surface. It is omitted
  because: the census measured 12 % non-flat `roof:shape` in a German best-case
  area and most sit on rectangles; §8.4 puts OSM's own footprint error in the
  low metres, which a slightly-off ridge is well inside; and **a half-correct
  skeleton is worse than none** — it produces self-intersecting surfaces that
  render as z-fighting and read as a renderer bug.
  - **Build it when** `isApproximate` is measured to fire on a meaningful share
    of buildings in a target area, not before.
  - **Licence constraint, and it binds:** benchmark against `straight-skeleton`'s
    **v1 branch** (pure TypeScript). Do NOT touch v3 in production or in the
    harness — its npm package declares MIT while wrapping CGAL's GPL
    `Straight_skeleton_2`, and reading GPL source with intent to reimplement is a
    derivation this Apache-2.0 package must not contain.
- Holes are not carried into an apex roof: a courtyard under a pyramid is not a
  shape OSM describes, and guessing would be inventing geometry.
- **Orientation is not free here — it has bitten this file twice.** The ENU→3D
  mapping in `extrude.ts` is `(x, height, y)`, so 3D z is ENU north and the frame
  flips handedness. Two consequences that every new shape inherits:
  - **Emit eave → ridge, never eave → eave → ridge.** `faceNormal` is derived
    from the emitted winding, so a reversed face reverses its normal too and
    both agree while both are wrong — a roof lit from underneath. The
    winding-vs-normal check therefore _cannot_ catch it; only the
    outward-from-the-volume check can.
  - **`apexRoof` normalises `rings[0]` to counter-clockwise itself.**
    `extrudeBuilding` passes rings through raw and real footprints arrive both
    ways round, so without it the roof's facing depends on the mapper's drawing
    direction while `addWalls` (which does normalise) stays correct.
  - **`orientedBoundingBox` keeps its frame right-handed across the long/short
    axis swap** by negating `cross`. A plain swap mirrors the frame, which
    inverted every ridged roof whose footprint happened to start at a corner on
    its short side — a coin flip per building.

## Examples

```ts
const roof = buildRoof(rings, cap, {
  shape: "hipped",
  eaveHeightM: 9,
  ridgeHeightM: 13,
});
```

## Tests

`buildings.test.ts` — apex height for pyramidal, gabled closing at both ends
with its exact triangle count, hipped sloping all four sides, skillion staying
between eave and ridge, and the flat fallback when there is no rise.

`mesh-orientation.test.ts` — the orientation invariants above, run over every
shape and over rings that differ in winding and in starting corner. Note that
none of the `buildings.test.ts` assertions could have failed while every roof in
this file was inside-out: a triangle count and a height range are both blind to
orientation.
