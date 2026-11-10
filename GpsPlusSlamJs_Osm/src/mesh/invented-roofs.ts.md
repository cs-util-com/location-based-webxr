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

- `planInventedRoofs(footprints, params = ROOFSCAPE_DEFAULTS): Map<OsmFeatureKey, InventedPlan>`
  - One entry per planned building; a building the map describes has none
    and keeps the library volume.
  - `InventedFootprint`: `key`, `tags`, `at` (a point inside), `polygons`,
    `outlineKey?` (for a part), `hasParts` (an outline with parts, or one not
    drawn because what stands inside it fills it; both are kept).
  - Never planned: parts, outlines with parts, multi-polygon outlines (the
    library volume stays), and every `keepReason` of the rules.
- `InventedPlan = InventedLid | InventedRoof`
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
- **Frame dependence**: planned in ENU metres, so a different frame moves
  corners by millimetres and can flip a roof sitting on a decision. Drawing
  and `inventedRoofTotals` must use the same frame.
- Defensive: a ring the skeleton refuses (`SkeletonFailure`) gives a lid,
  never a throw; slivers of soffit under 1e-6 m2 are skipped.

## Examples

```ts
const plans = planInventedRoofs(footprints);
const plan = plans.get(key);
if (plan?.kind === "roof") {
  const mesh = inventedRoofMesh(plan, { lowest: 0, rise: 0 });
}
```

## Tests

- `invented-roofs.test.ts`: who gets a roof (a lone house, every keep case,
  shop, hall, flat neighbourhood, order), the shape (shared wall vertical,
  overhang on free walls, cut at the rise limit, a stated height, gable
  share), the mesh (top, roof range, soffit winding).
- `invented-roofs.property.test.ts`: drawn top equals planned top within the
  rise limit, and order invariance, over random rotated rectangles and Ls.
- `../testdata/sites/site-invented-roofs.test.ts`: the fixture counts and the
  cross-checks with `buildBuildings` and `inventedRoofTotals`.
