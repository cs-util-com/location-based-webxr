# `ground-tint.ts`

## Purpose

The land-use ground tint: which mapped area paints which class into the
ground, in which colour and order, rasterised into a class index over the
build window. A port of the O2 painted-ground prototype the owner chose
(`GpsPlusSlamJs_DesignSystem/labs/city-look/o2-painted-ground/`), built as
the city objects plan's M3
(`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`),
with its colours from a colour scheme (OSM demo colour schemes plan
`GpsPlusSlamJs_Docs/docs/2026-11-10-0841-osm-demo-colour-schemes-plan.md`,
section 4.3). `three/ground-tint.ts` draws it.

## Public API

- `GROUND_CLASS_NAMES`, `GroundClass` - the 25 classes, in O2's order; the
  raster stores class `i` as byte `i + 1`, 0 for unpainted ground.
- `DEFAULT_GROUND_RGB` - the neutral ground, `0x6b7280` (OsmDemo's
  `GROUND_COLOUR`). `DEFAULT_LAND_USE_RGB` - O2's class colours, sRGB.
- `GROUND_CLASS_TIERS` - 0 zoning, 1 open land, 2 water, 3 surfaces.
- `groundClassOf(tags: unknown) -> GroundClass | undefined` - never throws.
  A building (other than `building=no`) paints nothing; any `water=*` is
  water; keys are read in the order water, waterway, natural, leisure,
  amenity, landuse, man_made, place; a pitch with a hard `surface` is a
  court; `highway=pedestrian` + `area=yes` is a square. Value tables are
  `Map`s, so `landuse=constructor` finds nothing inherited.
- `paintOrder(entries)` - tier ascending, then area descending, then
  feature key: the last painted wins.
- `polygonAreaM2(rings)` - shoelace, outer minus holes.
- `groundTintPlan(box, texelM)` - the raster size; the texel grows so
  neither side exceeds `MAX_GROUND_TINT_SIDE` (2048). `RangeError` for a
  texel that is not positive and finite, or an empty or non-finite box.
- (internal) `groundTintEntries(features, frame)` - the classified areas with their
  ENU polygons and areas, and a count of `skipped` ones (a class but no
  polygon: an unclosed way, a relation that does not stitch).
- `buildGroundTint(features, {frame, window, texelM?, ground, landUse})
-> GroundTint` - `{width, height, texelM, originX, originY, classes,
palette, shares, skipped}`. `RangeError` for a bad texel, an empty window
  or a `landUse` map missing a class.
- `DEFAULT_GROUND_TINT_TEXEL_M` - 2 m (the spike, below).

## Invariants & assumptions

- **A pure rasteriser**, not `OffscreenCanvas`: it runs in workers and in
  node tests and is deterministic. Even-odd scanline fill per polygon, holes
  included, sampled at texel centres, half-open on both axes. Crossings are
  bucketed per row, so a long ring costs its edges plus its crossings.
- `classes` is row-major with **row 0 at the SOUTH edge** of the window;
  `originX` / `originY` are the window's south-west corner in ENU metres.
- Only the window is rasterised; a polygon reaching outside paints nothing
  outside it.
- The result never depends on the order of `features` (the paint order is
  total).
- `palette` is sRGB: `palette[0]` the scheme's `ground`, then the classes.
- Every default class colour has a chroma (max minus min channel) under 45
  (DEC-R4-5: the heat ramp stays the loudest colour).

## The spike (RGBA8 with mipmaps against an R8 class index)

Throwaway, kept outside the repo. Reuss fixture, headless Chromium
(SwiftShader), 800 x 450, three views (OsmDemo's boot view at 226 m, a low
oblique at 25 m height, a grazing view at 6 m), each rendered at two camera
positions (steps 0.37 m and 1.3 m) and against a 4x supersampled reference.
Pixels differing from the reference by more than 12 summed levels: RGBA8
mipmapped 0.16-0.22 percent of the frame at both 1 m and 2 m texels; R8
nearest with a palette uniform 0.51-0.79 percent (2.3 to 4.9 times more, in
every view), its edges stair-stepped because an index cannot be filtered.
Memory at the 2048 cap: RGBA8 with mips about 22.4 MB, R8 4.2 MB; at
Reuss's 640 m window and 2 m texels the RGBA8 texture is about 0.55 MB.
Chosen: RGBA8 with mipmaps at 2 m (1 m measured no better at these views).
What would reverse the texel: a street-level view right at a class edge,
which the spike did not render.

## Cost per build (`ground-tint.bench.ts`)

Means on devbox-win11, Node 24, default colour scheme. Two sites: Heidelberg
Altstadt (dense, small land-use areas) and Lucerne Meggen (suburb, large
meadows and woods). Two windows each: the fixture's bbox, and the OSM demo's
largest window (4.8 km square, `TERRAIN_EXTENT_M = 2400`; the 2048-texel cap
coarsens the texel to 2.34 m).

- Heidelberg, fixture bbox (179 x 188 texels): rasterise 1.25 ms, texel
  expansion (`groundTintTexture`) 0.21 ms, class bytes 33.7 KB, texture
  134.6 KB plus 44.9 KB of mips.
- Heidelberg, 4.8 km (2048 x 2042): rasterise 83 ms, expansion 21 ms, class
  bytes 4.18 MB, texture 16.7 MB plus 5.6 MB of mips.
- Meggen, fixture bbox (320 x 320): rasterise 6.2 ms, expansion 0.68 ms,
  class bytes 102 KB, texture 410 KB plus 137 KB of mips.
- Meggen, 4.8 km (2048 x 2042): rasterise 90 ms, expansion 20 ms, class bytes
  4.18 MB, texture 16.7 MB plus 5.6 MB of mips.
- `buildCity` on the fixture bbox with and without the tint: Heidelberg 72.0
  against 66.8 ms, Meggen 24.0 against 22.8 ms (within the runs' 8-11 percent
  spread).

At the full window the cost is the cap, not the site: both sites land on
the same 2048-texel raster, so the rasterise is ~85-90 ms whatever the
density and the transfer and texture sizes are fixed. A caller that draws
no ground (the demo's AR) passes `groundTint: false`.

## Tests

- `ground-tint.test.ts` - the class table (incl. a hard pitch as a court,
  inherited names, non-object tags), tiers and default chroma, paint order,
  area, raster size and cap, a park over a district with south at row 0, an
  unclosed line skipped, a missing class colour, O2's coverage floors at
  Meggen (74.9 percent, measured 76.9) and Reuss (90.7, measured 92.4), and
  `buildCity`'s `groundTint` (absent by default, the scheme's colours).
- `ground-tint.property.test.ts` - every texel centre equals an independent
  point-in-ring evaluation of the same priority rule on random polygons;
  invariance under input permutation; the raster covers exactly the window.
