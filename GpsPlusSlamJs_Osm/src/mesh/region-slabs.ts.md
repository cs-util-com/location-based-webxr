# `src/mesh/region-slabs.ts`

## Purpose

Turns merged affordance regions into low 3D slabs (W14, DEC-R2-11) — a body the
camera can see at a shallow angle rather than a flat overlay that vanishes
edge-on.

## Public API

- `SlabRegion` — `{ outline, medianScore }`. Structural rather than the full
  `Region`, so this module does not depend on the region builder and a test can
  construct one in three lines.
- `BuildRegionSlabsOptions` — `{ frame, groundHeightM?, wallHeightM? }`.
- `RegionSlab` — `{ medianScore, mesh }`.
- `buildRegionSlabs(regions, options) → RegionSlab[]` — one slab per region, in
  input order. Never throws; a degenerate outline yields an empty mesh.

## Invariants & assumptions

- **THE COLOUR IS NOT COMPUTED HERE, and that is the load-bearing decision.** The
  2D map and the 3D view must never be able to disagree about what a score looks
  like — the whole reason the store exists. The demo owns one
  `heatScale`/`heatColour` pair and both views read it; this module carries
  `medianScore` through untouched. A colour computed in the package would be a
  second source of truth for the same question, which is precisely what
  `geo-three`'s two elevation decoders and two Earth radii are cautionary
  examples of.
- **Holes are holes.** A building inside a park is a hole in the region, and that
  is the ordinary shape of the data rather than an edge case. A slab that filled
  its holes would cover the very buildings the view exists to show — and it would
  look deliberate, because a solid coloured surface reads as "this whole area
  scores", a confidently wrong claim rather than a visible glitch.
- **A region can be several polygons.** Two cells that score but do not touch are
  one region with two polygons; taking only the first would silently shrink it.
- **The wall surrounds every ring, holes included.** A hole's edge is as much a
  boundary of the region as its outside.
- **The top surface is wound so its face normal points UP.** `flatShading`
  recomputes the normal from the winding and ignores the per-vertex normals, so
  an inverted top is lit from beneath and culled while every counter still
  reports it — exactly the defect W13's ribbons shipped with for one commit.
- **Terrain is sampled PER VERTEX.** A region can be hundreds of metres across;
  one sample would cut into the hill at one end and float at the other.
- **A ring with fewer than three points is skipped, never triangulated.** Pushing
  on produces `NaN`, and one `NaN` deletes the entire draw call in three.js with
  no error.
- **`wallHeightM` defaults to 0.5 m** — the plan's proposal, still marked
  `[confirm]`. Tall enough to read at a shallow angle, short enough not to
  occlude buildings on a slope.

## Examples

```ts
const slabs = buildRegionSlabs(snapshot.regions, {
  frame: enuFrameAt(userPosition),
  groundHeightM: (p) => field.heightAt(p),
});
// The CONSUMER colours it, through the same scale the 2D map uses:
const colour = heatColour(scale, slab.medianScore);
```

## Tests

`region-slabs.test.ts` — 7 tests: one slab per region carrying its score; **a
hole stays a hole** (covered inside the outer ring, not covered at the hole's
centre); the slab has vertical extent; the top drapes per vertex; a multi-polygon
region covers both parts and not the gap; a degenerate outline stays finite; the
top surface's face normals point up.

Coverage is asserted by plan-view point-in-triangle rather than by triangle
counts — a count passes on geometry full of holes, which is the one thing this
builder must not have.
