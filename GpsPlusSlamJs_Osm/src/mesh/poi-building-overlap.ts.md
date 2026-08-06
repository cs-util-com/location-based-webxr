# `poi-building-overlap.ts`

**Purpose:** drops POI markers that duplicate a building already extruded —
F33, closed by §5 (DEC-R6-17).

## The defect

Five POI kinds are buildings in their own right at real-world scale:
`amenity=hospital` (15.3 m), `tourism=hotel` (13.5), `amenity=place_of_worship`
(12.0), `leisure=sports_centre` (9.0) and `amenity=bank` (8.0, exactly on the
threshold). A hospital is routinely mapped as **both** a node and a building
way; `poi.ts` marks nodes, `buildings.ts` extrudes ways, and neither knows about
the other. The result is a 15 m block standing inside a building that is already
there.

**It was four until round 8 and nobody noticed it became five.** `amenity=bank`
was re-adopted at a target height of exactly 8.0 m, which `>= 8` suppresses —
so bank nodes inside buildings started vanishing, correctly but silently. The
guard that should have said so restated the threshold as `> 8` instead of
calling `isBuildingScalePoi`, and stayed green. Fixed 2026-08-04 (DEC-S9); see
the invariant below.

## Why it lives in §5 rather than §4

DEC-R6-8 kept POI models at real-world scale rather than adopting the plinth
idiom, which would have dissolved this by making every marker ~0.9 m. So it is
fixed as what it structurally is — a volume drawn where another volume already
stands, the same defect the outline/part rule handles one level up.

## Public API

- `isBuildingScalePoi(kind): boolean`
- `suppressPoiInsideBuildings(markers, footprints): T[]`
- `BUILDING_SCALE_POI_HEIGHT_M` (8)

## Invariants & assumptions

- **Kind AND position, both load-bearing.** Position alone empties every station
  concourse of its benches; kind alone deletes a hospital mapped only as a node
  — a visible fix turning into an invisible data loss. The second is the easy
  mistake and looks correct on any fixture where a building happens to exist.
- **The threshold is derived from the models' own measured heights**, never from
  a list of kind strings, so a new building-scale model is covered without
  anyone remembering. A literal list failing silently is how F33 arrived.
  - **That property is only as good as the test that watches it**, which is the
    lesson round 8 taught at the cost of a silently-disappearing marker. The
    contract test now CALLS `isBuildingScalePoi` rather than restating its
    comparison — a test that re-expresses a production predicate can drift from
    it, and this one did, on exactly one value.
- **8 m was bounded from both sides by real models, and the band has since
  moved.** Re-measured 2026-08-04 after round 8 regenerated 29 of the 50
  heights: the gap is now `tourism=guest_house` at 7.6 m to `amenity=bank` at
  8.0 m, not the 3–4 m shopfronts to `sports_centre` 9.0 this document used to
  cite. A 7.6 m guest house is not a shopfront — it is the same defect, below
  the cutoff by arithmetic.
  - The number stays at 8 (DEC-S9), because `guest_house` becomes a 2.5 m
    symbol under the symbol-language plan and that dissolves the case.
  - **Generalised in `lessons-learned.md`:** a threshold derived from generated
    data must be re-measured whenever that data is regenerated.
- **Real point-in-polygon, not a bounding-box test.** Buildings are routinely L-
  or U-shaped and a marker in the notch is inside the box and outside the
  building. The box is a cheap pre-filter only.
- **Order is preserved.** The consumer indexes marker identity by array
  position, so reordering would make every later pick name the wrong feature.

## Examples

```ts
const poi = suppressPoiInsideBuildings(
  buildPoiMarkers(features, options),
  volumes.map((volume) => volume.footprint),
);
```

## Tests

- `poi-building-overlap.test.ts` — the selector, the suppression, and (most of
  the effort) the cases that must NOT be suppressed: a lone hospital node, a
  bench inside a building, a marker just outside, and a marker in an L-shape's
  notch.
