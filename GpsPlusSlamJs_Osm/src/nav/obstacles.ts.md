# `obstacles.ts` — what blocks an agent, and at what height

**Purpose.** Index solid barriers by H3 cell, and turn that index into the
`levelsAt` that [`column-space.ts`](./column-space.ts.md) consumes.

## The ENU hazard, made structural

The navigation design names this twice: `BuildingVolume.footprint` is in ENU
metres in a frame rebuilt on **every publish**, so every recentre invalidates
every coordinate in it. An index keyed that way silently rebuilds itself, or
worse, silently doesn't.

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
