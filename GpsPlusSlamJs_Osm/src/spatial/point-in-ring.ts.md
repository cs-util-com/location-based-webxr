# `point-in-ring.ts` — ray-casting containment

**Purpose.** Decide whether a planar point lies inside a ring.

## Why it is shared

It was private to `mesh/buildings.ts`, covered only indirectly through building
assignment, and the navigation obstacle test needs exactly the same predicate. A
second copy would be a second set of edge cases to keep in agreement — and the
two callers disagreeing about what "inside a building" means is the kind of
divergence that produces an agent walking through a wall with nothing in the
logs.

## Generic over `{ x, y }`, and why that is safe

`buildings.ts` asks in **ENU metres**; the obstacle index asks in **lat/lng**.
One implementation serves both, because **crossing parity is invariant under any
affine transform** and lat/lng → local ENU is affine at the scale of a building.

So the anisotropy between a degree of latitude and a degree of longitude
**does not have to be corrected for**. Correcting for it is the obvious instinct
and it is wasted work — worth stating, because the next person to read this will
have the same instinct.

## Public API

- `PlanarPoint` — `{ x, y }`. Lng/lat map to x/y.
- `containsPoint(ring, point) => boolean`

## Invariants

- **The ring is treated as closed**, whether or not the last vertex repeats the
  first. OSM ways repeat it; ENU rings here usually do not. A ring with one open
  edge is one every ray escapes through.
- **Winding does not matter.** That is a triangulation concern, and callers hand
  rings from several sources with no common convention.
- **A degenerate ring contains nothing.** A zero-area barrier that reported
  `true` would block the ground it stands on.

## What is deliberately undefined

**Points exactly on an edge.** They land on whichever side the floating-point
comparison falls, and no caller has a stake in which. An agent standing
precisely on a wall's face is not a case the navigation model needs to
adjudicate; a state a millimetre either way is, and that one is well defined.

## Tests

`point-in-ring.test.ts` — interior and exterior points, the **concave** case (a
C shape, where the bite is inside the bounding box and outside the ring — this
is what separates ray casting from a box test), winding independence, explicit
and implicit closure, degenerate rings, and containment in degrees.
