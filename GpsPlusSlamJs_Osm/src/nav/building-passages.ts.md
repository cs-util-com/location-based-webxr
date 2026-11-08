# `building-passages.ts`

**Purpose.** Finds where a road tagged `tunnel=building_passage` pierces a building footprint, so the obstacle index can admit a step through the arch instead of sealing it. DEC-R12-3's answer to the eighth testing session's "where a way crosses a building, an archway would make sense".

## Public API

- `PassableFootprint` — `{ rings: readonly (readonly PlanarPoint[])[] }`, rings as `x = lng, y = lat` degrees. Structurally satisfied by `mesh/buildings.ts`'s `SolidFootprint`, so the caller hands its footprints straight over.
- `passageLines(features, footprints): readonly (readonly (readonly PlanarPoint[])[])[]` — one list of passage POLYLINES per footprint, **in the same order**, so the caller can zip them. Almost all lists are empty.
- `insideRingsByParity(point, rings): boolean` — whether `point` is in the SOLID part of a multi-ring footprint. Exported so `obstacles.ts` shares it rather than keeping a second reading of the same question; see the parity invariant below.

## Invariants & assumptions

- **Only `tunnel=building_passage` counts.** `covered=yes` is rejected by name (DEC-R12-3): it is used for roads under canopies and arcades where the building beside them is genuinely solid, so honouring it would invent passages. `tunnel=yes` / `culvert` go _under_ rather than _through_ — the same distinction `model/below-surface.ts` already makes one module along, where `building_passage` is the one `tunnel` value deliberately excluded from the sub-surface set.
- **An untagged road crossing a footprint in plan opens nothing.** That is the rule DEC-R12-1 measured and rejected for barriers, and it fails the same way here: a road crossing a building outline on the map is normally running above or below it.
- **A CORRIDOR, not the whole volume — and that is a measurement, not a preference.** DEC-R12-3 was written as "the same passable-underneath treatment `min_height > 0` and `building=roof` already get", which excludes the entire volume from the obstacle index. Measured over the eight-site corpus that reading makes **30–35 % of the built area** at Cologne, Tokyo and Tower Bridge walk-through, and 22 % of the _buildings_ at Tower Bridge — an agent strolling through a city block because one arcade was mapped. So the decision's other phrase, passable **along it**, is the one implemented. Opening a corridor touches 0–15 buildings per site.
- **This is a property of the ROAD, not of the building**, which is why the obstacle index consults a second feature set here for the first time. `min_height` and `building=roof` are both readable from the building alone.
- **Openings are LINES, not a hole in the ring, and not the two mouths.** `segmentCrossesRing` treats a ring as closed whether or not the caller repeated the first vertex, so a building boundary cannot be cut the way `barrier-gates.ts` cuts a barrier centreline; buildings do not need it to be, because their passability has always been index-only here. But opening the two crossing POINTS was not enough and shipped a defect for a few hours: blocking is a pure BOUNDARY property, so once a mouth is open every step between two interior cells crosses no ring at all and the whole interior is free. Carrying the LINE lets `crossesObstacle` ask "is this step on the passage" of the inside as well as of the boundary.
- **`PASSAGE_CORRIDOR_M` is 10 m, sized by the pathfinder from both sides.** `crossesObstacle` admits a step that comes within half the corridor of the passage line anywhere along its length. Where the line runs past the walls, every step crossing it is admitted and the chain exists at any width, which is how an earlier version of the property hid the lower bound. Mapped passages end at the outline or a little inside it, and then the entry step must reach the line's end across the res-13 lattice (centres 7.1 m apart on average, up to 7.83 m). Measured over 400 uniform placements of a 60 m building: a passage ending exactly at the walls joined the two sides every time from 7 m (5 m: 392 of 400), one ending 3 m short needed 10 m (8 m: 389, 9 m: 398 of 400). Bearings within 2° of the lattice directions are no worse (2940 near-axis placements: 8 m 2890, 9 m 2939, 9.5 m and 10 m all), so the lower bound is about 9.5 m. **The upper bound is the building:** rooms 15-29 m off the passage stayed sealed up to 14.5 m and were reached at 15 m in 3 % of placements, at 16 m in 24 %. 10 m sits inside that window with only about 0.5-1 m of margin on the lower side and about 4.5 m on the upper.
- **A passage that merely ENDS inside the footprint counts.** OSM ways are routinely split at a building outline. Measured: no passage in the corpus has both endpoints inside a solid footprint, but Tokyo has one with a vertex inside a building whose ring it never crosses — a seventh building the crossing test alone missed.
- **Containment is by ring PARITY, not "inside any ring".** A point in a courtyard is inside the outer ring and inside a hole; counting it as inside would let a passage ending in the yard open a route through the outer wall.
  - **The rule is EXPORTED as `insideRingsByParity` because a second copy of it existed and was wrong** (r504 review, fixed 2026-08-12). `obstacles.ts` decided the same question with `rings.some(...)` — the very "inside any ring" this invariant rejects — which made a courtyard inside a PIERCED building unwalkable. The divergence survived because the test guarding it placed its courtyard 4.45 m from the passage, inside the 5 m corridor half-width, so `runsAlongAPassage` answered first and the parity question was never reached. Two implementations of one predicate is what allowed that.
- **The collinear case yields no opening.** A way running exactly _along_ a wall makes `segmentsIntersect` report a touch with no single crossing point, and inventing one (a midpoint, say) would place the opening where the passage does not run.

## Examples

```ts
const solids = solidBuildingFootprints(features);
const openings = passageOpenings(features, solids);
// openings[i] belongs to solids[i]; feed it to the Obstacle as `openings`.
```

`nav/obstacles.ts` attaches a non-empty list to the `Obstacle` and `crossesObstacle` admits a step passing within `PASSAGE_CORRIDOR_M / 2` of one.

## Tests

- `building-passages.test.ts` — which ways count (and each rejected neighbour by name), the passage line reported for a pierced footprint, the split-way case, and the one-entry-per-footprint ordering.
- `building-passages.property.test.ts` — the claim the feature exists for: **the passage is walkable end to end at any bearing**, with the passage ending at the walls or up to 3 m short of them and the search confined to a strip that rules out walking round the building; it fails at 5 m. Two counterweights: an untagged road joins nothing, and the rooms more than 15 m off a tagged passage stay sealed, which fails at 16 m. A plain assertion beside them holds `PASSAGE_CORRIDOR_M` inside the measured window (9.5 to 14.5 m), which 25 random placements alone could not. Placements are drawn uniformly (`test-utils/uniform-arbitrary.ts`).
- `nav/obstacles.test.ts` — the pair that defines a corridor: a step through the passage is admitted, a step between two rooms away from it is blocked, and the building stays indexed.
- `testdata/sites/site-building-obstacles.test.ts` — per-site counts of buildings that gain an opening, plus the guard that the corridor reading stays far below the whole-volume one.

No test data of its own; the corpus tests read the checked-in site extracts.
