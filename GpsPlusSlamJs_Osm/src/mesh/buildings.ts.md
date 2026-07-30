# `mesh/buildings.ts`

## Purpose

OSM features to building volumes, honouring `building:part`.

## Public API

- `buildBuildings(features, { frame, groundHeightM? }): BuildingVolume[]`
- `interface BuildingVolume` — `feature`, `parentFeature?`, `heights`, `mesh`,
  `roofIsApproximate`
  - **`roofIsApproximate` is the real flag from `buildRoof`, not a proxy.**
    Substituting "is the shape gabled or hipped?" is a _different_ claim: a
    gabled roof on an actual rectangle is exact, and that is the common case
    §8's approximation trade rests on — so the proxy over-reports every time.
    The demo counted it that way, which meant the counter that exists to check
    the census against real data was measuring something else.

## Invariants & assumptions

- **The base sits at the LOWEST terrain height under the outer ring, and the walls
  are lengthened to match (DEC-R2-19).** Previously one sample was taken at the
  footprint anchor, which is only correct on flat ground: on a slope it cut the
  building into the hill at one end and floated it at the other. That was documented
  as a known seam and was tolerable while consumers rendered a near-flat 600 m
  terrain square; once terrain covers a city with real relief it becomes routine.
  - **Both halves are required.** Re-basing without lengthening drops the roof below
    its tagged height on the high side; lengthening without re-basing leaves the
    building floating on the low side.
  - **Accepted consequence:** on steep ground the wall is taller than `height=`.
    That is correct — the tag is measured from the building’s own base, not from the
    lowest terrain beneath it — and it is a deliberate change to existing output.
  - **Flat ground is byte-identical to before**, because the rise is 0. Pinned by a
    regression test.
  - Only the OUTER ring is sampled: inner rings are courtyards, inside the outer
    extent by definition, so they can neither lower the base nor raise the rise.
  - A non-finite sample is SKIPPED rather than compared, or one NaN from a provider
    would poison the whole building and a NaN position silently drops triangles.
- **ONE BASE PER BUILDING, NOT PER PART (W5, finding R3-1).** The ground is sampled
  over the outline **and every part assigned to it**, once, and every volume in that
  building is given the same `{ lowest, rise }`.
  - **Why it has to be shared:** `min_height` is measured from the BUILDING's base.
    Give each part the minimum under its own footprint and two parts of one building
    end up displaced from each other by the relief between them.
  - **This shipped, and it was visible on the demo's showcase building.** It was
    harmless for exactly as long as the sampled field was 600 m and Cologne-flat, so
    the rise was ~0 and every part got the same base by accident. Once DEC-R2-8/21
    extended the field to 2.8 km of real relief, Cologne Cathedral's spires stopped
    merging into the model and started reading as separate low-polygon cones stuck
    on top of it.
  - **The outline is included in the sample even though it is not extruded.** It is
    part of the building's extent, and excluding it would make the base depend on
    which parts happened to arrive in this tile.
  - **A part with no containing outline keeps the per-footprint behaviour**, because
    there is no building to share a base with — which is also what makes the grouping
    safe to apply unconditionally: the fallback is exactly the old code.

- **Landmark detail is FREE if you honour `building:part` and `min_height`.**
  Cologne Cathedral is not a model file and not a special case — it is many
  `building:part` polygons, each with its own height and `min_height`. A naive
  one-polygon extrusion gives a box; the same extruder applied per part gives
  something recognisably cathedral-shaped, with no landmark database anywhere.
  That is why parts are first in the plan's ordering (§8, 24 % of buildings in
  the census) rather than an advanced feature.
- **A building WITH parts is not extruded itself** — the parts replace it.
  Drawing both is the single most visible S3DB mistake: every detailed building
  gets a box drawn straight through it. Taken from OSM2World's `Building.java`,
  the most complete implementation of the schema anywhere.
- **A part with no containing outline is still extruded.** A tile boundary can
  deliver a part without its parent, and dropping it would erase the building.
- **Containment is tested on a representative point, not on every vertex.** Parts
  routinely share an edge with their outline, so an all-vertices test would
  reject the common case on a floating-point tie. A concave part whose centroid
  falls outside is extruded standalone — visible, and not wrong.
- **A multipolygon contributes only its first polygon.** A building mapped as
  several disjoint polygons is a data error rather than a shape, and extruding
  all of them under one set of heights would be inventing buildings.
- Non-buildings are ignored; a feature whose geometry cannot be built is skipped
  rather than throwing, matching the rest of the package.

## Examples

```ts
const frame = enuFrameAt(userPosition);
const volumes = buildBuildings(index.mergedFeatures().values(), {
  frame,
  groundHeightM: (p) => terrain.at(p) ?? 0,
});
const batch = mergeMeshes(volumes.map((v) => v.mesh));
```

## Tests

`buildings.test.ts` — the outline-with-parts suppression, an outline with no
parts, a part with no parent, the part carrying its own height, and non-building
features being ignored.
