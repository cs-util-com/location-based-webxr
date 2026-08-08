# `building-passages.ts`

**Purpose.** Finds where a road tagged `tunnel=building_passage` pierces a building footprint, so the obstacle index can admit a step through the arch instead of sealing it. DEC-R12-3's answer to the eighth testing session's "where a way crosses a building, an archway would make sense".

## Public API

- `PassableFootprint` — `{ rings: readonly (readonly PlanarPoint[])[] }`, rings as `x = lng, y = lat` degrees. Structurally satisfied by `mesh/buildings.ts`'s `SolidFootprint`, so the caller hands its footprints straight over.
- `passageOpenings(features, footprints): readonly (readonly PlanarPoint[])[]` — one list of boundary-crossing points per footprint, **in the same order**, so the caller can zip them. Almost all lists are empty.

## Invariants & assumptions

- **Only `tunnel=building_passage` counts.** `covered=yes` is rejected by name (DEC-R12-3): it is used for roads under canopies and arcades where the building beside them is genuinely solid, so honouring it would invent passages. `tunnel=yes` / `culvert` go _under_ rather than _through_ — the same distinction `model/below-surface.ts` already makes one module along, where `building_passage` is the one `tunnel` value deliberately excluded from the sub-surface set.
- **An untagged road crossing a footprint in plan opens nothing.** That is the rule DEC-R12-1 measured and rejected for barriers, and it fails the same way here: a road crossing a building outline on the map is normally running above or below it.
- **A CORRIDOR, not the whole volume — and that is a measurement, not a preference.** DEC-R12-3 was written as "the same passable-underneath treatment `min_height > 0` and `building=roof` already get", which excludes the entire volume from the obstacle index. Measured over the eight-site corpus that reading makes **30–35 % of the built area** at Cologne, Tokyo and Tower Bridge walk-through, and 22 % of the _buildings_ at Tower Bridge — an agent strolling through a city block because one arcade was mapped. So the decision's other phrase, passable **along it**, is the one implemented. Opening a corridor touches 0–15 buildings per site.
- **This is a property of the ROAD, not of the building**, which is why the obstacle index consults a second feature set here for the first time. `min_height` and `building=roof` are both readable from the building alone.
- **Openings are POINTS, not a hole in the ring.** `segmentCrossesRing` treats a ring as closed whether or not the caller repeated the first vertex, so a building's boundary cannot be cut the way `barrier-gates.ts` cuts a barrier centreline. Buildings do not need it to be: their passability has always been an index-only property here — `min_height` and `building=roof` volumes are drawn exactly as before and simply do not obstruct — so the drawn-iff-indexed rule that forced the barrier gap into shared geometry does not apply.
- **Both crossings are collected.** A passage that pierces a building enters and leaves; opening only one end would let an agent walk in and not out.
- **The collinear case yields no opening.** A way running exactly _along_ a wall makes `segmentsIntersect` report a touch with no single crossing point, and inventing one (a midpoint, say) would place the opening where the passage does not run.

## Examples

```ts
const solids = solidBuildingFootprints(features);
const openings = passageOpenings(features, solids);
// openings[i] belongs to solids[i]; feed it to the Obstacle as `openings`.
```

`nav/obstacles.ts` attaches a non-empty list to the `Obstacle` and `crossesObstacle` admits a step passing within `GATE_GAP_M / 2` of one — the same width a mapped gate opens, for the same reason: an opening the search cannot step through may as well not exist.

## Tests

- `building-passages.test.ts` — the tag rule (accepted, and each rejected neighbour by name), the two crossings of a pierced building, a road that merely passes nearby, and the one-entry-per-footprint ordering.
- `nav/obstacles.test.ts` — the behaviour that matters, as a pair: a step through the passage is admitted **and** a step through the same building away from it is still blocked. Neither assertion is meaningful alone.
- `testdata/sites/site-building-obstacles.test.ts` — per-site counts of buildings that gain an opening, plus the guard that the corridor reading stays far below the whole-volume one.
