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

- `Obstacle` — `{ feature, heightM, rings }`. `rings` are `x = lng, y = lat`,
  ready for `containsPoint` (crossing parity is affine-invariant, so the
  lat/lng anisotropy needs no correction — see
  [`point-in-ring.ts.md`](../spatial/point-in-ring.ts.md)).
- `ObstacleIndex` — `obstaclesIn(cell)`, `cells`.
- `buildObstacleIndex(features, resolution?) => ObstacleIndex`
- `obstacleLevelsAt(index, cell, groundAt) => number[]`

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
    - **The `[0]` assertions in `barrierLines` are the same argument.**
      `wayToGeometry` builds `rings: [way.geometry]` and `relationToGeometry`
      returns `polygons[0]!` from rings `groupRingsIntoPolygons` seeds as
      `[outer]`, so an outer ring is always present and a `?? []` fallback would
      be an uncoverable branch. Changed on #263 for consistency with the rule
      above; it also drops three whole-ring array copies that existed only to
      satisfy mutability variance.

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

- **Nothing blocks anything yet.** `Obstacle.rings` is built, stored and
  exported, but no code in this slice ever asks `containsPoint` about it. The
  only consumer surface is `obstacleLevelsAt`, which **adds** a level and never
  removes one. So wiring this into `columnSpace` today gives an agent the wall
  top as an extra state and leaves the ground under the wall fully traversable
  — agents walk through walls that are walls, not merely through walls that are
  houses. Review on #259 caught an earlier version of this section claiming
  otherwise. **The footprint test is the next slice.**
- **Buildings are not indexed at all.** Only barriers are, so even once the
  footprint test lands, a house is not an obstacle until the building half is
  built.
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
