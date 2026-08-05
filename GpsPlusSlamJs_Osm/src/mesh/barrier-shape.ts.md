# `barrier-shape.ts` — giving a barrier line an extent

**Purpose.** Turn an open barrier way into closed rings with area.

## Why it is needed

A barrier is a **line** in OSM, and everything downstream wants a polygon:
`extrudeBuilding` takes closed rings, and pass B's point-in-obstacle test needs
something that actually contains the wall. The `width` tag — or
`DEFAULT_BARRIER_THICKNESS_M` from [`barriers.ts`](./barriers.ts.md) — is what
gives the line an extent.

## One quad per segment, not one buffered outline

This is the design decision worth stating, because the obvious alternative is
worse in a specific and non-obvious way.

Offsetting a polyline as a **single** outline needs a join rule at every vertex,
and the usual one is a mitre. As a turn approaches 180°, the mitre point runs
towards **infinity** — a hairpin in a fence would obstruct ground nobody walled
off and draw a spike across the scene. A hairpin is not exotic tagging: it is
what a fence around a narrow strip looks like.

Per-segment quads cannot do that. Every vertex is within half a thickness of its
own segment, so the whole footprint stays within half a thickness of the line,
whatever the way does. A test pins that with a ~0.06° hairpin, where a mitre
would land ~57× the thickness away.

The cost is **overlapping quads at each joint**, which is invisible for opaque
walls and harmless for a point-in-polygon test that asks "any of them".

## Public API

- `barrierFootprints(line, thicknessM) => EnuPoint[][]` — one 4-point ring per
  non-degenerate segment.
- `ringArea(ring) => number` — signed shoelace area, positive counter-clockwise.

## Invariants

- **Centred on the line**, because the way _is_ the wall's centreline in OSM. A
  footprint offset to one side would put the obstacle beside the wall the viewer
  sees.
- **Consistent winding across all quads.** `triangulate` reads the sign of a
  ring's area as its orientation, so quads disagreeing with each other would
  extrude with their faces pointing opposite ways — a wall lit from inside,
  which reads as a rendering bug rather than a geometry one. The vertex order is
  expressed in the segment's own frame, so it is counter-clockwise for every
  segment regardless of direction.
- **Zero-length segments are skipped, not normalised.** A segment with no
  direction has no normal, and dividing by its length yields `NaN` vertices —
  which propagate into the mesh, where three.js draws nothing and reports no
  error. Duplicated consecutive nodes are ordinary in OSM, so this is a live
  path rather than a defensive formality.

## Defensive behaviour

- **A non-finite or non-positive thickness throws.** A zero-width footprint has
  no area, so triangulation yields nothing and the barrier silently fails to
  exist — the failure mode with no symptom at all. `barriers.ts` already
  guarantees a positive thickness, so this is defence in depth against a future
  second caller.
- **A degenerate way returns `[]`** — fewer than two distinct points is not a
  wall.

## Tests

`barrier-shape.test.ts` — segment area and count, straddling rather than
offsetting, per-segment quads for a polyline, the hairpin locality bound, zero-
length segments, degenerate ways, thickness validation, and winding consistency.

**Mutation-checked**, all seven caught: offsetting to one side, using the full
thickness as the half-offset, dropping the zero-length guard, accepting a
non-positive thickness, flipping the winding on alternate segments, failing to
normalise the segment normal, and making `ringArea` unsigned.

**What these do NOT cover:** the extrusion itself, and whether a point is inside
the footprint. Both are the next slice.
