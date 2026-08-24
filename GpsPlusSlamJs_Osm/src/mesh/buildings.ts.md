# `mesh/buildings.ts`

## Purpose

OSM features to building volumes, honouring `building:part`.

## Public API

- `buildBuildings(features, { frame, groundHeightM? }): BuildingVolume[]`
- `solidBuildingFootprints(features): SolidFootprint[]` — the same
  parts-else-outline selection, **in lat/lng and with no frame**, for
  [`nav/obstacles.ts`](../nav/obstacles.ts.md). Returns `{ feature,
parentFeature?, rings }` with rings as `x = lng, y = lat`.
  - **Shares `assignPartsToOutlines` rather than repeating it.** That function
    is generic over the footprint type because the rule is affine-invariant:
    crossing parity does not care about the frame, and the ENU map scales
    longitude by a constant `cos(lat)`, so the AREA ORDER a smallest-containing
    rule depends on survives too. Two implementations would drift, and the drift
    shows as an agent walking through a building that is plainly on screen.
  - **Skips volumes that are passable underneath, for TWO independent reasons.**
    - **`min_height > 0`** — the S3DB form for an arch or a gateway. Sealing the
      ground under one closes the route through it, and walking under a gate is
      the case the navigation design names.
    - **`building=roof`** — a canopy is a roof on posts (DEC-R11-14). It needs
      its own clause because most canopies carry no `min_height` at all, so the
      first rule misses them, and they are not small: Cologne's station
      forecourt roof is **~16 200 m², the largest single outline in the whole
      corpus**, so treating it as solid puts a building-sized hole in the middle
      of the one site the demo opens on.
      - **The accepted cost, stated:** a roof mapped over solid walls becomes
        walk-through. That is rarer than the canopy case and fails towards
        movement rather than towards an invisible obstruction.
    - **Note the asymmetry with PICKING in the demo**: both of these are still
      DRAWN, and `GpsPlusSlamJs_OsmDemo` marks every drawn building chunk as a
      click blocker — so a canopy is navigable and still swallows a click. See
      `mesh-layers.ts` there; it is a known gap, not an inconsistency to "fix"
      by making these solid again.
  - **The skip happens AFTER the assignment, and that order is load-bearing:**
    filtering floating parts first changes which outlines get claimed, so a
    building whose only parts float came back solid as a whole outline while the
    extruder drew it as floating slabs. Caught by the corpus test at Cologne and
    Berlin; no hand-built fixture would have.
  - **No area cap** — a measured deviation from DEC-R11-9. See below.
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
- **A part goes to the SMALLEST containing outline, ties broken on feature key
  (R5-7, DEC-R5-2, N3).** This was "the first containing outline", which with
  NESTED outlines made the result depend on the order Overpass serialised the
  payload in. Area expresses what is meant — the most specific claim about this
  piece of ground — and the key tie-break makes the build a property of the data
  rather than of its transport.
  - **`buildings.property.test.ts` is what keeps that true**, and it goes red the
    moment the rule is replaced by "first" again.
- **The part→outline assignment is INDEXED, not scanned (2026-08-22).**
  `smallestContaining` walked every outline for every part, so the work was
  `parts × outlines` and both grow with the working set — the same cross product
  `annotatePoiHosts` had, found by the same profile and answered by the same
  `host-grid.ts`.
  - **Safe for a stronger reason than the host join.** That one depends on
    candidate ORDER (first enabled host wins), so its index must promise
    ascending output. This rule picks by smallest area with an explicit key
    tie-break, so it is order-independent by construction and needs only the
    grid's superset guarantee. The bounds test and the ray cast are unchanged and
    still run, so the answer cannot differ.
  - **Measured, devbox-win11** (Node 24.14.1): the hot path itself —
    `assignPartsToOutlines` plus `smallestContaining` — went **~102 → ~24 ms per
    call at k=4, −76 %**, dropping out of the profile's top ten entirely.
    `buildBuildings` **487.65 → 430.08 ms (−11.8 %)**, diluted by the extrusion
    work around it; `solidBuildingFootprints`, which is little more than this
    rule, **156.20 → 85.95 ms (−45.0 %)**.
  - **The first attempt made `solidBuildingFootprints` 16.8 % SLOWER**, and the
    reason is worth keeping: `host-grid.ts` had a pitch floor in METRES, while
    this function is generic over the frame and passes **lat/lng degrees**. One
    cell then covered the planet, so the index pruned nothing and charged its own
    overhead. Nothing failed — it was caught only because that caller happened to
    be benched. `host-grid.ts` is now unit-free and pins that with a test.
- **The nested case (R5-7, DEC-R5-2) is fixed by the smallest-container rule
  ALONE**, through the pre-existing "an outline with parts is not extruded" line.
  Cologne Cathedral's `way/645732604` (`building=tower`, height 157, "Nordturm")
  drew as a solid 157 m prism through the modelled cathedral because the
  cathedral had claimed the tower's parts; once each part goes to its smallest
  container, the tower owns `way/207377042` and is suppressed like any other
  modelled building.
  - **A SECOND RULE WAS WRITTEN AND REMOVED, and the reason is the useful part.**
    "Suppress any outline nested inside a strictly larger outline that owns
    parts" reads like the same idea one level up. Measured on this repo's corpus
    it suppressed **nothing** the line above had not already suppressed, cost
    **0.8–4.6 s per build** at res-7 scale, and **deleted four legitimate
    buildings**: an `industrial` under the cathedral and three Heidelberg
    `kiosk`s. It also treated a courtyard as solid, so a building in the hole of
    a modelled multipolygon vanished.
  - **Nesting does not imply duplication**, which is the whole error. A kiosk in a
    station concourse is a building.
  - **The measurement that misled the first attempt is still true and is not the
    point:** the Nordturm's `Sockel` (`way/206020152`, 5.146e-8 deg²) is wider
    than the tower way above it (2.970e-8) and stays with the cathedral. The part
    that decides the outcome is the **unnamed** `way/207377042` — searching the
    fixture by the name "Nordturm" is what hid it.
- **`man_made=tower` without a `building` tag draws nothing** — `isBuilding` keys
  only on `building`. Cologne's Südturm (`way/645732603`, height 157) is exactly
  this and is invisible, which is the other half of the reported asymmetry.
  Deliberately not changed (N4, DEC-R5-13): admitting `man_made` widens what gets
  drawn at every site, which is a look rather than a refactor.
- **A multipolygon contributes only its first polygon.** A building mapped as
  several disjoint polygons is a data error rather than a shape, and extruding
  all of them under one set of heights would be inventing buildings.
- Non-buildings are ignored; a feature whose geometry cannot be built is skipped
  rather than throwing, matching the rest of the package.

## Why there is no area cap on outlines

DEC-R11-9 asked for a footprint-area threshold above which a `building=*`
outline stops counting as solid — to stop a castle-sized outline sealing its own
courtyard — and deliberately left the value to be **measured against
`testdata/sites/` rather than guessed**. The measurement says no such threshold
exists, on two counts:

- **The hazard is not in the corpus.** Heidelberg's defensive castle
  (`way/254154168`, `historic=castle`, `castle_type=defensive`) carries **no
  `building` tag at all**, so it never becomes a volume under any rule. The way
  the design cites as the trap — `historic=castle` also tagged
  `building=university` (`way/32200575`) — is **533 m²**: a wing, not a bailey.
- **A cap would break real buildings.** The largest outlines the parts rule
  leaves standing are Cologne's train station (~14 000 m²), a Berlin office
  block (~10 200 m²) and Tokyo's Keio department store (~7 200 m²). Any cap low
  enough to catch an enclosure makes all three walk-through, which is a louder
  bug than the one it prevents.

`testdata/sites/site-building-obstacles.test.ts` pins both facts, so a corpus
refresh that introduces a real enclosure fails rather than inheriting this
answer quietly.

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

- `buildings.test.ts` — the outline-with-parts suppression, an outline with no
  parts, a part with no parent, the part carrying its own height, and
  non-building features being ignored.
- `nested-outlines.test.ts` — the nested case, against the checked-in
  `cologne-cathedral` extract plus synthetic three-level nesting. The two rules
  are asserted **separately**, so a failure names which one broke.
- `buildings.property.test.ts` — the build is invariant under permutation of its
  input. Shuffles the real fixture rather than generating nested OSM buildings,
  because a generator for that would be a larger and less trustworthy artefact
  than the extract this project already captured.
- `../testdata/sites/site-geometry.test.ts` — the coarse geometry gate across all
  six corpus sites. The cathedral's volume count moves by one with this change (156 to 155): the Nordturm outline stops being drawn.
