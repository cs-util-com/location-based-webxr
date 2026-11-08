# `mesh/roof.ts`

## Purpose

Roof geometry above the eaves, in the plan's own order of quality-per-effort.

## Public API

- `buildRoof(rings, cap, options): RoofMesh` - `MeshData` plus `isApproximate`,
  `method` and `surfaceVertices`. Never throws: anything unforeseen becomes the
  prism, or a flat cap at the eaves, for that one building
- `interface RoofOptions` — `shape`, `eaveHeightM`, `ridgeHeightM`, and the
  optional `directionDeg` (`roof:direction`), `orientation` (`"across"`) and
  `maxOverhangM` (the overhang limit, for sweeps and tests)
- `RoofMesh.method` - which builder drew the roof (`RoofMethod`,
  module-private): `flat`, `revolved`, `skillion`, `box`, `skeleton`,
  `hipped-skeleton`, `box-fallback`, `prism`
- `RoofMesh.surfaceVertices` - the vertices `[0, surfaceVertices)` are roof
  surface; the rest are walls the roof brings (gables, the prism's sides)
- `RIDGE_OVERHANG_LIMIT_M` (1, module-private) — the default for `maxOverhangM`
- `SKELETON_VERTEX_CAP` (128, module-private) - the most corners a skeleton
  roof is attempted on

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
- **`gabled`, `hipped`, `gambrel` and `round` take one of two builders.**
  - **A rectangle gets the box roof** over its oriented minimum bounding
    rectangle: one ring, an area within 2 % of the rectangle's, and an
    overhang within `maxOverhangM`. Gabled runs the ridge the full length so
    the ends are vertical gable walls; hipped pulls the ridge in by a quarter
    at each end so all four sides slope. Gambrel and round are gabled with a
    different cross-section: each side is a strip per step of
    `(across, rise)` (gambrel breaks at 70 % of the half width and 60 % of the
    height; round is a quarter circle), and the gable ends are fanned from the
    first eave corner. Exact, cheap, and 379 of the corpus's 508 ridged roofs.
  - **Everything else gets the straight skeleton of its real outline**
    (`roof-skeleton.ts`, meshed by `skeleton-mesh.ts`), courtyards included:
    every wall slopes up at one pitch, so an L-shaped house gets its two
    ridges and its valley, and no roof stands over the street. The slope is
    `rise / ridgeT`, so the highest point of the roof is exactly the tagged
    `roof:height` top; the tagged path never passes `maxT` (that is for roofs
    nobody tagged, see `roof-skeleton.ts.md`).
    - Gable ends: untagged, every wing end whose neighbours are not wing ends
      (the neighbour rule); with `roof:orientation` or `roof:direction`, the
      wing ends whose wall faces within 45° of the tagged ridge axis.
    - Gambrel and round have no cross-section on a skeleton yet: on a
      non-rectangle they are a plain gabled skeleton, flagged approximate.
  - **The fallback ladder**, in order; `method` says which step drew the
    roof:
    1. the tagged shape (`skeleton`);
    2. a hipped skeleton, gabled family only (`hipped-skeleton`);
    3. both again with the other corner nudge;
    4. the box roof, if its overhang is within the limit (`box-fallback`);
    5. a flat-topped prism at the tagged top with walls from the eaves
       (`prism`), so the building keeps its height and nothing stands
       outside its walls.
    - A footprint above `SKELETON_VERTEX_CAP` (128) corners starts at step 4.
    - **One deviation from that order:** a gabled-family skeleton that found
      no gable at all is passed over for the box roof where the box fits.
      On a quadrilateral tagged `roof:orientation=across` the gables belong
      on the long walls, which the axis rule cannot pick (it chooses among
      wing ends only), so the skeleton came back hipped: 39 of the corpus's
      52 across-tagged skeleton roofs, where the box roof had drawn them
      across before. Taking the box keeps the tag; teaching the axis rule end
      walls is a follow-up (`roof-skeleton.ts.md`). Without this step the
      corpus has 44 approximate skeletons and 2 box fallbacks instead of 13
      and 33.
    - Each skeleton rung catches ANY error, not only a `SkeletonFailure`,
      and the ladder goes on: an unforeseen throw in one rung used to skip
      the box rung and draw a prism (M2 review finding 6, 2026-11-08).
    - `buildRoof` never throws: an exception anywhere becomes the prism, or,
      if even that throws, a flat cap at the eaves.
  - **`surfaceVertices`** tells a consumer which vertices are roof and which
    are the walls the roof brings (gables, the prism's sides), so colouring
    needs no height epsilon (`chunk-meshes.ts.md`).
  - **What `isApproximate` means since M2:** the roof is not the tagged shape
    over the real outline. That is a gambrel or round skeleton, a gabled roof
    drawn hipped or with no gable, the box roof as a fallback, the prism, and
    the flat cap of a roof that could not be built. On the corpus 48 of the
    508 ridged roofs (13 approximate skeletons, 33 box fallbacks, 2 prisms),
    against 125 before, when every non-rectangle was approximate.
  - **Which way the ridge runs on the box roof:** along the long side by
    default; `roof:orientation=across` turns it square to that, and
    `roof:direction` turns it so the slopes face that direction (the ridge
    runs at right angles to it). The turn is the same right-handed swap as in
    `orientedBoundingBox`.
  - **Aliases** (in `building-heights.ts`): `cone` is drawn as `pyramidal`,
    `half-hipped` and `mansard` as `hipped`, `saltbox` as `gabled`. Each is
    the nearest generated shape that keeps the roof's height and silhouette;
    the flat fallback would have put the roof height on the walls.
  - **The alias, profile and cross-section tables are `Map`s** (review finding
    5, 2026-11-07): on a plain object a shape named `toString` found an
    inherited function and the building came back with walls and no roof. Any
    unknown name, prototype names included, now draws flat.
  - **The overhang** is measured on a grid (at most 33 x 33, at least every
    0.5 m) of box points outside the outline, as each one's distance to the
    nearest wall, for every ridged roof, rectangles included.
- **Sweeps** (the 508 ridged roofs of the 13 corpus fixtures, plus 2,000 to
  4,000 random stars for the failure rates; 2026-11-08). The counts are
  box / skeleton / approximate skeleton / box-fallback / prism:
  - **Overhang limit:** 0.5 m 377 / 78 / 22 (+1 hipped) / 23 / 3; **1 m
    (kept)** 379 / 77 / 13 / 33 / 2; 2 m 380 / 76 / 10 / 36 / 2. 1 m is the
    low end of OSM's own footprint error (§8.4); a lower limit sends more
    roofs to the prism and the hipped rung, a higher one lets a box roof hang
    a full storey's depth over the street.
  - **`isRectangular`'s area tolerance, which now picks box or skeleton:**
    0.5 % 288 / 115 / 25 / 74 / 2; 1 % 334 / 97 / 22 / 49 / 2; **2 % (kept)**
    379 / 77 / 13 / 33 / 2; 5 % 410 / 70 / 11 / 11 / 2. A tighter tolerance
    moves near-rectangles to the skeleton, which often finds no gable and
    falls back to the box anyway (box fallbacks grow from 33 to 74); a looser
    one draws a 5 % notch as a box. 2 % sits in the middle of a smooth trade.
  - **Vertex cap:** 128 and 256 draw the corpus identically. One skeleton
    run on a ring of irregular corners costs about 54 ms at 128 corners,
    280 ms at 256, 2.3 s at 512 and 8 s at 1,000 (regular corners: 10, 21,
    37 ms and 2.6 s); a 5,000-corner ring goes straight to the box or prism
    in 0.3 s. 128 is kept: the worst case is every rung failing, four runs.
  - **Skeleton parameters** (jitter, area check, gable rule, axis angle,
    weld) are swept in `roof-skeleton.ts.md` and `skeleton-mesh.ts.md`; in
    every variant no drawn top misses its tagged height.
- **Cost** (`buildBuildings` over the 13 fixtures, two interleaved runs on
  one machine, 2026-11-08): main (before the roof work) 80 to 81 ms and
  78,498 triangles; r1123 136 to 163 ms and 92,954; b19f1ddb3 150 to 228 ms
  and 92,929; M2 259 to 285 ms and 95,065 (+2.3 % triangles against
  b19f1ddb3). Roof time per `buildCity` is about 72 ms in skeleton roofs,
  23 ms in the two prisms (each after four failed rungs; the slowest single
  roof is a 61-corner gabled one at Cologne, 21 ms) and 16 ms in box roofs.
  Half of the skeleton time was the stitch's corner lookup until it got
  numeric cell keys; what is left is the skeleton's event loop and the
  stitch's on-edge scan.
- **Licence constraint, and it binds:** the skeleton is our own. Do NOT bring
  in `straight-skeleton`'s v3 in production or in the harness: its npm
  package declares MIT while wrapping CGAL's GPL `Straight_skeleton_2`, and
  reading GPL source with intent to reimplement is a derivation this
  Apache-2.0 package must not contain.
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
  - **`revolvedRoof` normalises `rings[0]` to counter-clockwise itself**, and
    the skeleton (`roof-skeleton.ts`) normalises every ring it is given.
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

`roof.test.ts` - the ridged builder and its ladder: a rectangle gets the box
(gables for gabled, all surface for hipped); an L and a courtyard get the
exact skeleton up to the tagged ridge; gambrel and round on an L are
approximate; a star that fails its first nudge closes on the retry; a gabled
star that fails as gabled is drawn hipped; an across-tagged quadrilateral
keeps its gables through the box roof while the untagged one is a skeleton; a
footprint above the corner cap goes to the box or the prism; an L draws as a
skeleton at eaves from -250.9 to 499.9 m (float32 positions); malformed and
NaN rings never throw; and a fuzz property over random rings, duplicates and
shapes (finite, between eaves and ridge, `surfaceVertices` in range).

`roof-ladder.test.ts` - an unforeseen error (a `TypeError` injected by mocking
`skeletonMesh`) in one rung goes on to the hipped rung, and with every
skeleton rung throwing a near-rectangle still gets the box fallback.

`roof-skeleton.test.ts`, `roof-skeleton.property.test.ts` - the skeleton and
its mesh; see their sidecars.

`s3db-roof-tags.test.ts` — one Simple 3D Buildings tag at a time:
`roof:direction` on a skillion (degrees, compass names, a property over any
direction and proportion), `roof:orientation` and `roof:direction` turning a
ridge, the aliased and new shapes keeping `roof:height` off the walls, the onion
bulge, the round dome profile, the apex position, the gambrel and round
cross-sections, and the ridged roofs over an L (height, flag, facing, staying
over its walls).

`buildings.test.ts` — apex height for pyramidal, gabled closing at both ends
with its exact triangle count, hipped sloping all four sides, skillion staying
between eave and ridge, and the flat fallback when there is no rise.

`mesh-orientation.test.ts` — the orientation invariants above, run over every
shape and over rings that differ in winding and in starting corner. Note that
none of the `buildings.test.ts` assertions could have failed while every roof in
this file was inside-out: a triangle count and a height range are both blind to
orientation.
