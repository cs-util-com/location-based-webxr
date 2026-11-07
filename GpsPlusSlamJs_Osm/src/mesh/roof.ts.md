# `mesh/roof.ts`

## Purpose

Roof geometry above the eaves, in the plan's own order of quality-per-effort.

## Public API

- `buildRoof(rings, cap, options): RoofMesh` — `MeshData` plus `isApproximate`
- `interface RoofOptions` — `shape`, `eaveHeightM`, `ridgeHeightM`, and the
  optional `directionDeg` (`roof:direction`), `orientation` (`"across"`) and
  `maxOverhangM` (the overhang limit, for sweeps and tests)
- `RIDGE_OVERHANG_LIMIT_M` (1) — the default for `maxOverhangM`

## Invariants & assumptions

- **Flat is the universal fallback**, used for `flat`, for no rise, and for every
  shape this file cannot generate.
- **`pyramidal`, `dome` and `onion` share one profile-of-revolution builder**
  (`revolvedRoof`). Each is a list of `(scale, rise)` points: the footprint
  ring, scaled towards an apex by `scale`, at `rise` of the roof height. A
  pyramid is `(1, 0), (0, 1)`, one triangle per edge, as before. A dome is a
  quarter circle in 15° steps; an onion bulges to 1.3 times its base before it
  narrows. A ring at `scale > 1` overhangs its own walls, which is what an
  onion is. Every band is two triangles per edge, the last band closes in the
  apex, and nothing has a lid.
  - **The apex stands over the AREA centroid**, of the ring with its closing
    node dropped. The old vertex average counted the closing node twice (an
    octagon's apex sat radius/9 off centre) and followed the mapper's node
    density (an apse drawn with many short segments pulled the steeple
    sideways). The bbox centre is no better: an L-shaped footprint's bbox
    centre can fall outside the building.
  - **The dome is now real, not a pyramid.** The old sidecar argued the two are
    indistinguishable at walking distance; that held for a shallow roof, but on
    the Dresden Frauenkirche and the Berlin Cathedral the dome IS the landmark.
  - **Cost:** a dome on a 16-gon is 176 triangles against 16 for the pyramid it
    replaces; an onion is 6 bands. Over the 6 sites and 5 landmarks of the test
    corpus the whole building set went from 78,498 to 89,280 triangles
    (+13.7 %), almost all of it in the landmark fixtures (Berlin +98 %, Dresden
    +89 %, Munich +49 %, Moscow +40 %); ordinary town sites moved +4 to +14 %.
    Build time did not measurably change.
  - Holes are not carried into a revolved roof: a courtyard under a pyramid is
    not a shape OSM describes, and guessing would be inventing geometry.
- **`skillion` slopes downhill towards `roof:direction`** (degrees or a 16-point
  compass name, parsed in `building-heights.ts`; it names the facing of the
  slope, "from high (ridge) to low (eaves)"). With no direction it falls back to
  sloping along the footprint's longest axis. Its vertices carry the sloped
  **plane's own normal**, not `(0, 1, 0)`; with the flat normal it shades exactly
  like a flat roof and the slope shows only in silhouette, so the tag looks like
  it did nothing.
- **`gabled`, `hipped`, `gambrel` and `round` come from the oriented minimum
  bounding rectangle.** Gabled runs the ridge the full length so the ends are
  vertical gable walls; hipped pulls the ridge in by a quarter at each end so
  all four sides slope. Gambrel and round are gabled with a different
  cross-section: each side is a strip per step of `(across, rise)` (gambrel
  breaks at 70 % of the half width and 60 % of the height; round is a quarter
  circle), and the gable ends are fanned from the first eave corner, which for
  the straight slope is exactly the old single triangle. **Exact for a
  rectangular footprint, an approximation otherwise, and `isApproximate` says
  which.**
  - **Which way the ridge runs:** along the box's long side by default;
    `roof:orientation=across` turns it square to that, and `roof:direction`
    turns it so the slopes face that direction (the ridge runs at right angles
    to it). The turn is the same right-handed swap as in `orientedBoundingBox`.
  - **Aliases** (in `building-heights.ts`): `cone` is drawn as `pyramidal`,
    `half-hipped` and `mansard` as `hipped`, `saltbox` as `gabled`. Each is
    the nearest generated shape that keeps the roof's height and silhouette;
    the flat fallback would have put the roof height on the walls.
  - **A box roof that would overhang its walls by more than
    `RIDGE_OVERHANG_LIMIT_M` (1 m) is not drawn.** The overhang is measured on
    a grid (at most 33 x 33, at least every 0.5 m) of box points outside the
    outline, as each one's distance to the nearest wall, and it is measured
    for every ridged roof, rectangles included. In its place the roof is
    **hipped over the real outline**: a ridge along the box centre line,
    shortened by the half width at each end, and every eave vertex sloping up
    to its nearest point on that ridge. It is refused, and the roof falls back
    to flat at the eave, when the ridge leaves the outline, when a hip line
    from a vertex to the ridge leaves it (touching a wall is allowed: on a
    rectilinear L the hip from a wing corner runs along the wing's wall and
    makes a gable), or when a face would fold over its neighbour in plan.
  - **Why hipped over flat, decided by eye** on the lab page
    (`GpsPlusSlamJs_DesignSystem/labs/building-geometry/`): the first fallback
    tried, a pyramid over the outline, put a tent on Munich's Frauenkirche nave;
    flat lost the roof's height, which is most of a church's silhouette. The
    hipped roof follows the apse and keeps the height.
  - **Sweep of the limit** over the 502 ridged roofs of the test corpus (none
    with holes): at 0.5 m 69 are hipped over the outline and 27 fall back to
    flat; at 1 m 46 and 27; at 2 m 23 and 20. 1 m is kept: it is the low end of
    OSM's own footprint error (§8.4); a lower limit replaces box roofs that were
    within that error anyway, and a higher one lets a box roof hang a full
    storey's depth over the street before anything changes.
  - **Sweep of `isRectangular`'s 2 % area tolerance**: 334 of the 502 count as
    rectangles at 1 %, 380 at 2 %, 421 at 5 %. The tolerance only sets the
    `isApproximate` flag now; whether the box roof is drawn is decided by the
    overhang, so the 2 % is kept unchanged.
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
- **Orientation is not free here — it has bitten this file twice.** Emitters
  work in the ENU frame, and with Y up a counter-clockwise `(east, north)` loop
  reads as clockwise from +Y. (The ENU→render reflection that publishes north at
  −z is separate and lives in `MeshBuilder` — see
  [`mesh-data.ts.md`](./mesh-data.ts.md).) Two consequences every new shape
  inherits:
  - **Emit eave → ridge, never eave → eave → ridge.** `faceNormal` is derived
    from the emitted winding, so a reversed face reverses its normal too and
    both agree while both are wrong — a roof lit from underneath. The
    winding-vs-normal check therefore _cannot_ catch it; only the
    outward-from-the-volume check can.
  - **`revolvedRoof` and the outline fallback normalise `rings[0]` to
    counter-clockwise themselves.**
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

`s3db-roof-tags.test.ts` — one Simple 3D Buildings tag at a time:
`roof:direction` on a skillion (degrees, compass names, a property over any
direction and proportion), `roof:orientation` and `roof:direction` turning a
ridge, the aliased and new shapes keeping `roof:height` off the walls, the onion
bulge, the round dome profile, the apex position, the gambrel and round
cross-sections, and the hipped fallback over an L (height, flag, facing, staying
over its walls, and the flat fallback where the ridge would sit on the outline).

`buildings.test.ts` — apex height for pyramidal, gabled closing at both ends
with its exact triangle count, hipped sloping all four sides, skillion staying
between eave and ridge, and the flat fallback when there is no rise.

`mesh-orientation.test.ts` — the orientation invariants above, run over every
shape and over rings that differ in winding and in starting corner. Note that
none of the `buildings.test.ts` assertions could have failed while every roof in
this file was inside-out: a triangle count and a height range are both blind to
orientation.
