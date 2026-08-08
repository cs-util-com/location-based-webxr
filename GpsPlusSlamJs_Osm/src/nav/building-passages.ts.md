# `building-passages.ts`

**Purpose.** Finds where a road tagged `tunnel=building_passage` pierces a building footprint, so the obstacle index can admit a step through the arch instead of sealing it. DEC-R12-3's answer to the eighth testing session's "where a way crosses a building, an archway would make sense".

## Public API

- `PassableFootprint` — `{ rings: readonly (readonly PlanarPoint[])[] }`, rings as `x = lng, y = lat` degrees. Structurally satisfied by `mesh/buildings.ts`'s `SolidFootprint`, so the caller hands its footprints straight over.
- `passageLines(features, footprints): readonly (readonly (readonly PlanarPoint[])[])[]` — one list of passage POLYLINES per footprint, **in the same order**, so the caller can zip them. Almost all lists are empty.

## Invariants & assumptions

- **Only `tunnel=building_passage` counts.** `covered=yes` is rejected by name (DEC-R12-3): it is used for roads under canopies and arcades where the building beside them is genuinely solid, so honouring it would invent passages. `tunnel=yes` / `culvert` go _under_ rather than _through_ — the same distinction `model/below-surface.ts` already makes one module along, where `building_passage` is the one `tunnel` value deliberately excluded from the sub-surface set.
- **An untagged road crossing a footprint in plan opens nothing.** That is the rule DEC-R12-1 measured and rejected for barriers, and it fails the same way here: a road crossing a building outline on the map is normally running above or below it.
- **A CORRIDOR, not the whole volume — and that is a measurement, not a preference.** DEC-R12-3 was written as "the same passable-underneath treatment `min_height > 0` and `building=roof` already get", which excludes the entire volume from the obstacle index. Measured over the eight-site corpus that reading makes **30–35 % of the built area** at Cologne, Tokyo and Tower Bridge walk-through, and 22 % of the _buildings_ at Tower Bridge — an agent strolling through a city block because one arcade was mapped. So the decision's other phrase, passable **along it**, is the one implemented. Opening a corridor touches 0–15 buildings per site.
- **This is a property of the ROAD, not of the building**, which is why the obstacle index consults a second feature set here for the first time. `min_height` and `building=roof` are both readable from the building alone.
- **Openings are LINES, not a hole in the ring, and not the two mouths.** `segmentCrossesRing` treats a ring as closed whether or not the caller repeated the first vertex, so a building boundary cannot be cut the way `barrier-gates.ts` cuts a barrier centreline; buildings do not need it to be, because their passability has always been index-only here. But opening the two crossing POINTS was not enough and shipped a defect for a few hours: blocking is a pure BOUNDARY property, so once a mouth is open every step between two interior cells crosses no ring at all and the whole interior is free. Carrying the LINE lets `crossesObstacle` ask "is this step on the passage" of the inside as well as of the boundary.
- **`PASSAGE_CORRIDOR_M` is 10 m, wider than `GATE_GAP_M`, and sized by the pathfinder.** A gate needs ONE admitted step across a line; a corridor needs a CHAIN of them along its length, and the res-13 cells the search moves between sit ~6 m apart on a lattice that has no idea where the passage runs. A corridor narrower than that spacing is one the agent can enter and then not follow — worse than not opening it, because the mouth is visible. `building-passages.property.test.ts` states this as "walkable end to end at any bearing" and fails at 5 m.
- **A passage that merely ENDS inside the footprint counts.** OSM ways are routinely split at a building outline. Measured: no passage in the corpus has both endpoints inside a solid footprint, but Tokyo has one with a vertex inside a building whose ring it never crosses — a seventh building the crossing test alone missed.
- **Containment is by ring PARITY, not "inside any ring".** A point in a courtyard is inside the outer ring and inside a hole; counting it as inside would let a passage ending in the yard open a route through the outer wall.
- **The collinear case yields no opening.** A way running exactly _along_ a wall makes `segmentsIntersect` report a touch with no single crossing point, and inventing one (a midpoint, say) would place the opening where the passage does not run.

## Examples

```ts
const solids = solidBuildingFootprints(features);
const openings = passageOpenings(features, solids);
// openings[i] belongs to solids[i]; feed it to the Obstacle as `openings`.
```

`nav/obstacles.ts` attaches a non-empty list to the `Obstacle` and `crossesObstacle` admits a step passing within `GATE_GAP_M / 2` of one — the same width a mapped gate opens, for the same reason: an opening the search cannot step through may as well not exist.

## Tests

- `building-passages.test.ts` — which ways count (and each rejected neighbour by name), the passage line reported for a pierced footprint, the split-way case, and the one-entry-per-footprint ordering.
- `building-passages.property.test.ts` — the claim the feature exists for: **the passage is walkable end to end at any bearing**, with the counterweight that an untagged road joins nothing. This is where `PASSAGE_CORRIDOR_M` is justified; it fails at 5 m.
- `nav/obstacles.test.ts` — the pair that defines a corridor: a step through the passage is admitted, a step between two rooms away from it is blocked, and the building stays indexed.
- `testdata/sites/site-building-obstacles.test.ts` — per-site counts of buildings that gain an opening, plus the guard that the corridor reading stays far below the whole-volume one.

No test data of its own; the corpus tests read the checked-in site extracts.
