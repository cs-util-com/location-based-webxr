# `barriers.ts` — which barriers are solid, and how big

**Purpose.** Read `barrier=*` tags into an obstacle decision plus a height and
thickness in metres.

## Why this exists

The navigation design's motivating complaint is an agent walking **up the
Tower's curtain wall**. DEC-R7b-14 records that the obstacle set is wider than
`BuildingVolume` — barriers count — and that the walls must be **drawn**, on the
grounds that an NPC pathing around geometry the viewer cannot see demonstrates
nothing.

Buildings alone would produce a demo that looks like it works everywhere except
the exact place the original session complained about.

## The numbers are decisions (DEC-R11-2)

OSM does not say how tall an untagged wall is. The owner settled it:

- `DEFAULT_BARRIER_HEIGHT_M = 2` — an untagged solid barrier.
- `DEFAULT_CITY_WALL_HEIGHT_M = 6` — **taller on purpose.** The design's example
  is an 8 m curtain wall, and 2 m would be wrong in the one case the feature
  exists for. A tagged `height` still wins.
- `DEFAULT_BARRIER_THICKNESS_M = 0.5` — from `width` when tagged. It exists
  mostly so the drawn geometry has extent; a zero-width quad is invisible
  edge-on, and an invisible obstacle is what DEC-R7b-14 rules out.

**Rejected:** obstruct only where a height is explicitly tagged. No invented
numbers, which is honest — but most walls are untagged, so the curtain wall
would have stayed passable.

## Public API

- `isSolidBarrier(feature) => boolean`
- `resolveBarrier(tags) => { heightM, thicknessM }`
- `barrierCentrelines(feature) => readonly (readonly LatLng[])[]` — every
  lat/lng line the barrier runs along. Empty when the geometry is unusable; a
  line of fewer than two nodes is dropped.
- The three defaults above.

## Invariants

- **`heightM` and `thicknessM` are always finite and above zero.** This is
  load-bearing rather than defensive housekeeping: a non-finite height reaching
  `columnsAdjacent` makes every step involving it non-adjacent — an invisible
  wall sealing the feature off, with nothing on screen to explain it.
  `height=tall` and `height=` are both real tagging.
- **The solid set is an explicit list, not a pattern.** `barrier=*` also covers
  gates, kerbs and bollards, and both failure directions are silent: too narrow
  leaves the wall walkable, too wide turns every gate into an obstacle — which
  reads as broken pathfinding rather than as a tagging call.
  - Solid: `wall`, `city_wall`, `retaining_wall`, `fence`, `hedge`.
  - **Plus `historic=citywalls`, which is not a `barrier=*` value at all.** All
    four such ways in the checked-in Cologne extract carry no `barrier` tag, so
    a selector keyed on `barrier` alone dropped every one of them — and a city
    wall is the design's motivating example, which made the one feature the work
    exists for the one it could not see. It resolves to
    `DEFAULT_CITY_WALL_HEIGHT_M`, because it is a city wall whichever tag
    records it. Narrow on purpose: `historic=castle` stays out, since a castle
    outline is a building question and banding it would wall off the bailey.
  - Not solid: `gate`, `lift_gate`, `entrance`, `cycle_barrier` — **a gate is a
    hole in a wall.** Sealing them would close the very route the design's own
    test case depends on: the path that reaches the gate instead of going over
    the wall.
  - Not solid: `kerb`, `bollard`, `block` — all inside `STEP_THRESHOLD_M`, so
    treating them as obstacles would contradict the column model rather than
    complement it.
- **A node is never a barrier.** It has no extent to obstruct, and
  `barrier=gate` on a node is the common tagging.
- **An unknown value is passable.** Failing towards passable is the cheaper
  error — an invented obstacle produces a detour with no visible cause, which
  reads as a bug, while a missed one looks like what it is.

## Length parsing is shared

`height` and `width` both go through `parseLengthMetres` from
[`building-heights.ts`](./building-heights.ts.md), which already handles the
unit forms OSM uses (`3`, `3 m`, `10'`). A second parser here would be a second
set of edge cases to keep in agreement.

## Why `barrierCentrelines` lives here

It has two consumers — [`barrier-volumes.ts`](./barrier-volumes.ts.md) draws the
lines and [`nav/obstacles.ts`](../nav/obstacles.ts.md) indexes them — and they
must agree exactly. A wall drawn where nothing is indexed is an agent walking
through visible geometry; a wall indexed where nothing is drawn is a detour
around thin air. Both are bugs a reader would diagnose in the wrong file, so the
"which rings of which geometry kinds" decision (settled over #259, #260 and
#263) lives in one place rather than being copied into each.

## Tests

`barriers.test.ts` — the solid set in all three directions (solid, openings,
below-threshold), nodes, unknown values, the defaults as literal numbers, tagged
heights winning, unit forms, unparseable and non-positive heights, and the
finite-and-positive invariant over `NaN`, `Infinity`, `1e400` and a negative
width.

The geometry is covered next door: `barrier-shape.*` for the quads,
`barrier-volumes.*` for the extrusion — including a property that a barrier is
**drawn if and only if it is indexed**, at the **same height**.

`testdata/sites/site-barriers.test.ts` runs the selector over the real corpus,
which is what caught the `historic=citywalls` miss: invented ways prove the
arithmetic, only real extracts prove the selector matches what mappers write.
