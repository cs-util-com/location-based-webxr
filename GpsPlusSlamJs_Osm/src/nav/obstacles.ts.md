# `obstacles.ts` — what blocks an agent, and at what height

**Purpose.** Index solid barriers by H3 cell, and turn that index into the
`levelsAt` that [`column-space.ts`](./column-space.ts.md) consumes.

## The ENU hazard, made structural

The navigation design names this twice: `BuildingVolume.footprint` is in ENU
metres in a frame rebuilt on **every publish**, so every recentre invalidates
every coordinate in it. An index keyed that way silently rebuilds itself, or
worse, silently doesn't.

**That justification is now weaker than when this was written (DEC-R11-8).** The
demo's scene anchor no longer follows the user, so an ordinary step invalidates
nothing. The decision stands on grounds that did not change — the anchor still
moves on a declared place change or past 5 km, an index can outlive the scene
that built it, and building from lat/lng makes the mistake _unavailable_ rather
than merely avoided — but it is **preferred and structural, not strictly
required.** Said plainly here because a sidecar that kept claiming a dead
constraint would teach a future reader something false.

Building from `OsmFeature` geometry instead — lat/lng, from Overpass `out geom`
— makes the constraint structural rather than a rule to remember: **no
publish-frame coordinate is ever in scope in this file.** A test asserts the
stored vertices are degrees near the feature, since ENU metres would be orders
of magnitude larger.

**The one place metres are unavoidable** is thickness: a wall is 0.5 m wide, not
0.5° wide. Each footprint is therefore built in a frame anchored at **the
feature's own first vertex** and converted straight back to lat/lng. That anchor
is a property of the feature, not of the current view, so nothing about it moves
when the user does.

## Public API

- `Obstacle` — `{ feature, heightM, rings, passages? }`. `rings` are
  `x = lng, y = lat`, ready for `containsPoint` (crossing parity is
  affine-invariant, so the lat/lng anisotropy needs no correction — see
  [`point-in-ring.ts.md`](../spatial/point-in-ring.ts.md)).
  - `passages` are **LINES along which the obstacle is open** (DEC-R12-3) —
    today, the `tunnel=building_passage` ways running through a building.
    **Lines, not the mouths**: a step is admitted when it runs along one, which
    is a claim `crossesObstacle` can make about a step _inside_ the footprint as
    well as one crossing its boundary, and the inside is where a corridor stops
    being a corridor if nobody asks.
    - **Absent on almost everything**, which is why it is optional rather than
      an empty array: `crossesObstacle` is the search's hottest path and pays one
      `undefined` test per obstacle for it. See
      [`building-passages.ts.md`](building-passages.ts.md).
    - **This field was called `openings` in an earlier draft of this document,
      and described as boundary POINTS.** It is neither. Corrected 2026-08-10.
- `ObstacleIndex` — `obstaclesIn(cell)`, `cells`.
- `buildObstacleIndex(features, resolution?) => ObstacleIndex` — **barriers and
  buildings**. Barriers become `thicknessM`-wide bands along their centrelines;
  buildings follow `solidBuildingFootprints`' parts-else-outline rule, which is
  the same selection [`buildings.ts`](../mesh/buildings.ts.md) extrudes.
- `obstacleLevelsAt(index, cell, groundAt) => number[]`
- `crossesObstacle(index, fromCell, toCell) => boolean` — **the predicate that
  makes a wall block.**

## What actually blocks, and why it is a step predicate

`obstacleLevelsAt` only ever ADDS a standable level. On its own that stops
nothing: a walled cell offers the ground and the wall top, and an agent walks
along the ground straight through the wall. Blocking is `crossesObstacle`, and
it is a property of the **step**, not of the cell:

- A res-13 cell is ~8 m across and a wall ~0.5 m thick, so a wall contains a
  cell's centre roughly one time in sixteen. Any rule of the form "you may not
  stand in a walled cell" is transparent to pathfinding the other fifteen.
- It tests the segment between the two **cell centres** against every obstacle
  ring, using [`segmentCrossesRing`](../spatial/segment-crossing.ts.md).
- Obstacles are gathered from the whole `gridDisk(fromCell, 1)`, not from the
  two endpoints: a thin wall's footprint covers the cells the BAND passes
  through, which can be neither endpoint. Asking only the endpoints missed
  exactly that, silently — the wall indexed correctly and blocked nothing.
- **Defined for neighbouring cells**, which is all the search asks: every
  candidate `columnSpace` generates comes from `gridDisk(state.cell, 1)`.
- A step within one cell is never blocked — moving between two LEVELS of one
  cell crosses no boundary, and it is the one move a column model has that a 2D
  model does not.

Wire it in through `ColumnSpaceOptions.canCross`; the default admits everything,
which is design rung 5.3 where agents deliberately do walk up walls.

## Invariants

- **The ground level is always offered, alongside every obstacle top.** A res-13
  cell is ~8 m across and a wall is under a metre thick, so a cell containing a
  wall also contains the ground beside it. Removing the ground would make it
  impossible to walk _next to_ a wall — which is not what a wall does, and would
  have been an easy thing to get wrong in the direction that looks correct.
- **Obstacle heights are relative to the ground beneath them.** A 2 m wall on a
  30 m hill is standable at 32 m. Treating them as absolute would put every wall
  top underground on any real slope.
- **Levels are distinct and ascending.** Two walls of the same height crossing
  one cell are one standable level, not two identical ones; and a route that
  varied with the order Overpass returned features would be unreproducible.
- **One obstacle appears once per cell**, however many of its segments cover it.
  The segments of one wall are one wall.
- **A mapped opening admits the step that goes through it, and nothing else**
  (DEC-R12-1, DEC-R12-3). Barriers and buildings reach that by different routes,
  and the difference is not arbitrary:
  - a **barrier** is cut in the shared geometry (`barrierCentrelines`), because
    the barrier is DRAWN from the same lines and the drawn-iff-indexed property
    would otherwise break;
  - a **building** keeps its rings and carries `passages` instead, because
    `segmentCrossesRing` closes a ring implicitly so it cannot be cut — and
    because a building's passability has always been index-only here
    (`min_height` and `building=roof` volumes are drawn exactly as before and
    simply do not obstruct).
- **The opening test is the only place in this module that is not
  affine-invariant.** It is a RADIUS in metres, so longitude is scaled by
  cos(latitude) before the distance is taken. Everything else compares crossings,
  which are affine-invariant and need no correction.
- **Every segment is indexed**, not just the first — an L-shaped wall that
  blocked along one leg and not the other is exactly the kind of defect a
  single-segment fixture cannot see. Mutation testing found that gap here.
- **Every PART of a multipolygon is indexed**, not just the first. An earlier
  version took `polygons[0][0]`: the inner index correctly ignores holes, but
  the outer one silently discarded `polygons[1..]`, which are disjoint parts of
  the same barrier. One part indexed and the other invisible is the very failure
  the multipolygon branch was added to remove, moved one level in. Raised in
  review on #260.
  - **A one-part relation takes the `polygon` branch, not this one**, and that
    is the commoner shape: `relationToGeometry` only returns `multipolygon` for
    **two or more** disjoint outers. Nothing else reaches the `polygon` branch
    either — osmtogeojson blacklists `barrier=wall` in `POLYGON_FEATURES`, so
    even a closed `barrier=wall` way is classified as a linestring — so a
    single-outer relation fixture is the only cover it has. Added on #263, where
    the branch had been rewritten with no test reaching it.
  - **Each outer ring is a CENTRELINE, not the boundary of a filled region.**
    `barrierFootprints` emits one `thicknessM`-wide quad per segment, so an
    area-mapped barrier is indexed as a wall along its **outline** and the
    interior stays walkable. Inner rings are therefore dropped because they are
    a second face of the same wall, **not** because holes must be kept closed —
    the interior would be walkable either way. The cost is real and accepted: an
    area-mapped `barrier=city_wall` normally has outer = outer face and
    inner = inner face with the material between them, and this indexes only a
    default-thickness band on the outer face. Corrected on #263, where the code
    comment claimed the hole rationale.
  - **`multilinestring` is deliberately not handled.** `toGeometry` never
    produces one — only `clip.ts` does, and clipping is not in this path — so a
    branch for it would be code no test could ever cover.
    - **The `[0]` assertions in `barrierCentrelines` are the same argument.**
      `wayToGeometry` builds `rings: [way.geometry]` and `relationToGeometry`
      returns `polygons[0]!` from rings `groupRingsIntoPolygons` seeds as
      `[outer]`, so an outer ring is always present and a `?? []` fallback would
      be an uncoverable branch. Changed on #263 for consistency with the rule
      above; it also drops three whole-ring array copies that existed only to
      satisfy mutability variance.
  - **All of the above now lives in `mesh/barriers.ts`, not here.** The rules
    moved to `barrierCentrelines` when the barriers became drawn, because
    [`barrier-volumes.ts`](../mesh/barrier-volumes.ts.md) needs the identical
    lines: an indexed wall that is not drawn is a detour around thin air, and a
    drawn wall that is not indexed is an agent walking through visible geometry.
    A property test pins **drawn iff indexed, at the same height**. This module
    keeps only the `LatLng` → `x = lng, y = lat` mapping its own ring format
    needs.

## Defensive behaviour

- **A non-finite ground height yields no levels at all.** A `NaN` level would
  reach `columnsAdjacent`, which refuses every step involving a non-finite
  height — an invisible wall with nothing on screen to explain it. A cell with
  _no_ levels is at least visibly unreachable.
- **Unusable geometry is skipped.** A one-node way and an empty way are both
  ordinary Overpass output, and neither may take the index down.
- Non-barrier features are ignored entirely, per
  [`barriers.ts`](../mesh/barriers.ts.md).

## Tests

`obstacles.test.ts` — coverage and its absence, barrier filtering, resolved vs
default heights, the no-ENU assertion, bent barriers (both legs, counted once),
unusable geometry, and every `obstacleLevelsAt` invariant above.

**Mutation-checked**, all eight caught, including the one that only became
catchable after a bent-barrier fixture was added.

**What these do NOT cover — and this is the larger gap:**

- **⚠️ THE TWO ENTRIES THAT USED TO HEAD THIS LIST WERE BOTH FALSE, and are
  corrected rather than deleted so the drift is visible** (2026-08-10). They read
  _"Nothing blocks anything yet"_ and _"Buildings are not indexed at all"_. Both
  described the state before `crossesObstacle` and `addBuildings` landed, and the
  second contradicted this file's own API section — which has said "barriers
  **and** buildings" for as long as the claim sat below it.
  - **Blocking works.** `crossesObstacle` is the veto, `planRouteWithIndex`
    passes it to `columnSpace` as `canCross`, and it is what makes a route go
    around a wall.
  - **Buildings are indexed**, via `solidBuildingFootprints`' parts-else-outline
    rule — the same selection `buildings.ts` extrudes.
  - Anyone planning work from those two lines would have planned a slice that
    already shipped. That is the second time in one week a stale sidecar
    sentence nearly did that, so the correction is named in place.
- **Blocking is 2D and height-blind, which is easy to misread from the rest of
  this file.** `crossesObstacle` never consults `heightM`; height enters only
  through `obstacleLevelsAt`, which **adds** a standable level and never removes
  one. Two consequences worth stating before anyone extends this:
  - an obstacle with `heightM = 0` blocks perfectly well — it simply contributes
    no extra level, which is what a footprint with no volume should do;
  - conversely, a veto applies at **every** level, so anything with a deck over
    it needs the passage mechanism rather than a height comparison.
- **The antimeridian.** A barrier crossing ±180° would be treated as spanning
  almost the whole world, because `enuFrameAt` and the stored rings both use
  canonical longitudes. This matches the package's existing stance rather than
  departing from it: `overpass-query.ts` **throws** `AntimeridianCellError` for
  a cell straddling the date line, so such data cannot reach this index through
  the normal ingest path at all, and `multipolygon-builder.ts` documents the
  same non-handling. Raised by CodeRabbit on #259; fixing it here alone would
  add wrap-aware coordinates to one module while every other module around it
  still refuses or ignores the case, which buys false confidence rather than
  correctness.
