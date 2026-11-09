# `part-coverage.ts`

## Purpose

Measures how much of a building outline its `building:part`s cover, so
`buildings.ts` hides an outline only when its parts fill it (bug 5 of
`GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`).

## Public API

- `PART_COVERAGE_TO_HIDE_OUTLINE = 0.9` - the share at or above which the
  outline is hidden. Accepted recommendation, 2026-11-07; OSM2World uses the same 90 %.
- `partCoverage(outline, parts) -> number` - the share, 0-1, of the outline's
  area inside at least one part. `outline` is the outline's polygons (each an
  outer ring first, then holes); `parts` is one polygon list per part. Never
  throws.
- `PlanarPolygon` - one polygon in any planar frame.

## Invariants & assumptions

- **Sampled, not clipped.** 32 x 32 cell centres over the outline's bounding
  box; a sample counts when it is inside an outer ring and outside that
  polygon's holes. The error is about one cell column (1/32 of the width) on a
  cut, far inside the 10 % margin the threshold leaves. Nothing in the package
  does polygon booleans, and a grid has no degenerate cases.
- **Frame-independent.** The grid follows the bounding box, so an axis scale
  (the `cos(lat)` between lat/lng and ENU metres) or a shift moves the samples
  with the shape. That is why `buildBuildings` (ENU) and
  `solidBuildingFootprints` (lat/lng) share it and agree.
- **Parts outside the outline count only where they overlap it**; overlapping
  parts count once.
- **A degenerate outline** (no area, or nothing inside its own grid) returns 1,
  so it stays hidden exactly as before the rule.
- Cost: 1 024 samples per outline that has parts, each tested against the parts
  whose bounds hold it. Only outlines with parts are measured (79 in the eight
  corpus sites).

## The sweep (2026-11-07, eight corpus sites)

- Threshold 0.5 / 0.7 / 0.8 / 0.9 / 0.95:
  - outlines drawn with their parts: 20 / 23 / 29 / 34 / 37 (of 79 with parts);
  - parts no taller than their drawn outline, so hidden inside it:
    20 / 21 / 26 / 96 / 101;
  - parts sharing the outline's roof height (coplanar, a z-fighting risk):
    8 / 9 / 10 / 12 / 16.
- Verdict across the range: the badly covered outlines the rule exists for
  (Tower Bridge's towers 6-7 %, Cologne station 2 %) are drawn at every value.
  The jump between 0.8 and 0.9 is one building, the Tower Hotel (68 parts, a
  51 m outline), which 0.9 draws over its own detail. Drawing the uncovered
  remainder instead of the whole outline would remove both the swallowing and
  the coplanar roofs; it needs a polygon difference and is filed.

## Examples

```ts
const share = partCoverage(
  outlinePolygons,
  parts.map((p) => p.polygons),
);
if (share >= PART_COVERAGE_TO_HIDE_OUTLINE) hide(outline);
```

## Tests

- `part-coverage.test.ts` - the share for a cut, overlapping and outside parts,
  courtyards on either side, two outers, the degenerate case, and a property
  that an axis scale and a shift leave it unchanged.
- `s3db-parts.test.ts` - the rule in `buildBuildings`, on a synthetic outline
  and on Tower Bridge.
