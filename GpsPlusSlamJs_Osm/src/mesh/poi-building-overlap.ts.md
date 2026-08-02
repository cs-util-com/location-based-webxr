# `poi-building-overlap.ts`

**Purpose:** drops POI markers that duplicate a building already extruded —
F33, closed by §5 (DEC-R6-17).

## The defect

Four POI kinds are buildings in their own right at real-world scale:
`amenity=hospital` (15.3 m), `tourism=hotel` (13.5), `amenity=place_of_worship`
(12.0), `leisure=sports_centre` (9.0). A hospital is routinely mapped as **both**
a node and a building way; `poi.ts` marks nodes, `buildings.ts` extrudes ways,
and neither knows about the other. The result is a 15 m block standing inside a
building that is already there.

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
  a list of kind strings, so a fifth building-scale model is covered without
  anyone remembering. A literal list failing silently is how F33 arrived.
- **8 m is bounded from both sides by real models.** Below: shopfronts
  (`restaurant` 3.6, `cafe` 3.0, `fast_food` 3.2), all legitimately inside a
  building. Above: `sports_centre` at 9.0 is the smallest true duplicate.
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
