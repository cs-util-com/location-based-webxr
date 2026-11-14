# `mesh/invented-roofs.ts`

## Purpose

Invented roofs for the buildings the map says nothing about. The rules (who
keeps the library volume, who is refused, the slopes, the gable share, the
neighbourhood prior) live in [`roofscape-rules.ts`](roofscape-rules.ts.md);
this file runs them over a whole set of footprints and turns each answer into
a plan and a mesh. Design: the city plan
(`GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`,
the invented roofscape) and the toggles plan
(`GpsPlusSlamJs_Docs/docs/2026-11-10-1902-osm-prototype-features-as-toggles-plan.md`, M8).

## Public API

- `planInventedRoofs(footprints, { frame?, params? } = {}): Map<OsmFeatureKey, InventedPlan>`
  - `frame`: the `EnuFrame` the footprints are in; east-west lengths are then
    measured at each building's own latitude. `params` defaults to
    `ROOFSCAPE_DEFAULTS`.
  - One entry per planned building; a building the map describes has none
    and keeps the library volume.
  - `InventedFootprint`: `key`, `tags`, `at` (a point inside), `polygons`,
    `outlineKey?` (for a part), `hasParts` (an outline with parts, or one not
    drawn because what stands inside it fills it; both are kept).
  - Never planned: parts, outlines with parts, multi-polygon outlines (the
    library volume stays), and every `keepReason` of the rules.
- `InventedPlan = InventedLid | InventedRoof`
  - A roof's `rings`, `roofRings` and `roof` are in the building's own
    coordinates; `place: PlanPlace` (`x`, `y`, `xScale`) maps a point `p` to
    `(p.x * xScale + x, p.y + y)` in the frame. `inventedRoofMesh` returns
    the mesh already placed.
  - `InventedLid { kind: "lid", why, heightM }`: refused by class, by size or
    by flat neighbours, or no sound roof fits ("no sound roof", at the
    invented eave).
  - `InventedRoof { kind: "roof", style, rings, roofRings, roof, tan, eaveM, totalM }`:
    `style` is `gable`, `shared` (a shared wall, no gable), `hip` or `cut`
    (flat at `maxRiseM` on a deep building); `rings` the walls, `roofRings`
    the eave ring the roof stands on.
- `inventedTotalM(plan)`: base to top, metres; what navigation takes.
- `inventedRoofMesh(plan, { lowest, rise }): ExtrudedBuilding`: walls from
  the building's lowest ground to the eave, the skeleton roof, and the eave's
  underside (soffit) facing down. `roofVertices` covers the roof surfaces
  only; `roofMethod` is `"skeleton"`, so the city colours it as a pitched
  roof.

## Invariants & assumptions

- **Order-independent**: the plans depend on the set of footprints, never on
  their order (property test). Randomness is `mixedUnit` keyed by the feature
  key.
- **The drawn top is the planned top**: `inventedRoofMesh`'s highest vertex
  is `lowest + rise + totalM` (unit test, property test, and every fixture in
  `site-invented-roofs.test.ts`). Navigation relies on this.
- **Shared walls** are found by a segment grid (16 m cells, 1 m reach) and
  weighted 0: the roof stands vertical over them and the eave does not reach
  past them.
- **A stated `height`** is the whole building: the eave is `height - rise`,
  at least 2 m.
- **Invented roofs call `skeletonRoof` directly**, not `skeletonFootprint`:
  they change weights and ring between runs (`roof-skeleton.ts.md`).
- **A T-junction is accepted** where a gable wall's top meets the gable's
  bottom edge: the two edges are collinear, so there is no gap, only a vertex
  of one surface lying on the edge of the other.
- **Frame independence**: each building is planned in its own coordinates:
  metres from its first corner, east-west scaled by `cos(lat) / cos(lat0)`
  (its latitude rounded to 1e-6 degrees), rounded to 0.1 mm; neighbour walls
  are brought into them, and the prior measures east-west distances the same
  way (`xScale` on the entries). So any frame gives the same decisions and
  heights, and the mesh differs only by where it is placed.
  - **Why it was needed**: planned in frame metres, a skeleton event or an
    eave's soundness sat on rounding: moving the origin by 1e-7 degrees
    (about a centimetre) changed 10 of Meggen's invented roofs and 7 of
    Hinterzarten's, and a frame 300 m away about as many. The demo
    re-anchors its frame while the user walks, so roofs would have flipped
    on every re-anchor.
  - The rounding is what removes float noise: without it the same corner
    differs in the last bits between frames, which is enough to flip an
    event. A corner sitting exactly on a 0.1 mm boundary can still round two
    ways; no captured site has one.
- **The neighbourhood prior reads every footprint handed in**, not only
  those inside a consumer's window (`buildCity`'s `withinM`): a building at
  the window's edge is judged by its real neighbours, so the edge does not
  change its roof. Deliberate; bounding it would make a roof depend on where
  the window was cut.
- Defensive: a ring the skeleton refuses (`SkeletonFailure`) gives a lid,
  never a throw; any other error is a defect and propagates. Slivers of
  soffit under 1e-6 m2 are skipped.

## Examples

```ts
const plans = planInventedRoofs(footprints);
const plan = plans.get(key);
if (plan?.kind === "roof") {
  const mesh = inventedRoofMesh(plan, { lowest: 0, rise: 0 });
}
```

## Cost on the globe's warm delivery

`globe-invented-roofs.bench.ts` times reading the staged tiles and
`buildCity` with the globe worker's options, roofs off and on, 15
iterations after 3 warm-ups. Means, 2026-11-11 (off to on):

- Heidelberg, central half: 49 ms to 93 ms (x1.9).
- Heidelberg, whole box: 78 ms to 308 ms (x3.9).
- Meggen, central half: 14 ms to 47 ms (x3.3).
- Meggen, whole box: 54 ms to 243 ms (x4.5).

The warm delivery more than doubles, so the globe builds with
`inventedRoofs: false` (`globe-city-worker-core.ts`, pinned in its test).

## Tests

- `invented-roofs.test.ts`: who gets a roof (a lone house, every keep case,
  shop, hall, flat neighbourhood, order), the shape (shared wall vertical,
  overhang on free walls, cut at the rise limit, a stated height, gable
  share), the mesh (top, roof range, soffit winding).
- `invented-roofs.errors.test.ts`: a `SkeletonFailure` leaves the building
  flat, any other error from the skeleton propagates.
- `testdata/sites/site-invented-roof-sweep.test.ts`: the invented-roof
  counts at Park Slope, Midtown and Meggen with each planner parameter
  varied over a plausible range, the reversals pinned.
- `testdata/sites/site-invented-roof-staging.test.ts`: the flips of a
  staged delivery against the full one (shape, height over 1 cm and 50 cm)
  at three staged box sizes on all 12 sites, and that none survives the
  full delivery.
- `invented-roofs.property.test.ts`: drawn top equals planned top within the
  rise limit, order invariance, and the same plans under any translation of
  the input, over random rotated rectangles and Ls.
- `testdata/sites/site-invented-roof-frames.test.ts`: the same decisions
  and heights (within 1 cm) with the frame moved east, north, both, and by
  1e-7 degrees, at Meggen, Hinterzarten, Reuss, Heidelberg and Tokyo.
- `../testdata/sites/site-invented-roofs.test.ts`: the fixture counts and the
  cross-checks with `buildBuildings` and `inventedRoofTotals`.
