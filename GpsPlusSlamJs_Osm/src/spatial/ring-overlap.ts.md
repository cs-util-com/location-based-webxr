# `spatial/ring-overlap.ts`

## Purpose

Do two shapes share any area? The exact **narrow phase** for spatial queries —
what a broad phase's candidates get tested with.

## Public API

- `ringsOverlap(a, b): boolean` — two rings, holes not considered.
- `polygonsOverlap(a, b): boolean` — two `[outer, ...holes]` polygons.
- `PlanarPolygon` — `readonly (readonly PlanarPoint[])[]`, the `[outer, ...holes]`
  shape `osm-geometry.ts` produces and h3's polygon format uses, so no caller
  re-shapes anything.

Coordinates are `x = lng, y = lat` degrees, the convention
[`point-in-ring.ts`](./point-in-ring.ts.md) and
[`segment-crossing.ts`](./segment-crossing.ts.md) already use. Rings are treated
as closed and winding does not matter.

## Invariants & assumptions

- **Three witnesses, all required.** Two rings share area when a vertex of B is
  inside A, **or** a vertex of A is inside B, **or** an edge of each cross. Each
  is the only witness for a case the others miss: the first two are the two
  containment directions (checking one is wrong exactly half the time), and the
  third catches a partial overlap whose shared region holds no vertex of either —
  two boxes crossing in a plus shape.
- **Complete for simple polygons, NOT once holes exist.** That incompleteness is
  the entire reason `polygonsOverlap` is a separate function rather than a loop
  over rings, and nothing about the witnesses announces it — which is the silent
  wrongness this package treats as the worst failure mode.
- **The hole rule: outers must overlap, and neither shape may be swallowed by a
  hole of the other.** "Swallowed" means every vertex inside the hole **and** no
  edge crossing the hole's boundary — the second clause catching a ring whose
  vertices all sit in the hole while an edge bulges across the rim. A shape only
  _partly_ inside a hole still overlaps, because the part outside is on solid
  ground.
  - Checked in **both directions**, because either shape can be the one sitting
    in the other's courtyard.
- **Touching counts as overlapping**, inherited from `segmentsIntersect` and
  deliberate: OSM is full of shared edges — terraced buildings, a fence along a
  parcel boundary — and admitting a grazing shape is the safe direction for the
  navigation and query uses here.
- **A ring of fewer than three points bounds no area and overlaps nothing.** Real
  Overpass output contains two-node ways; a library that must survive the planet
  cannot make one fatal.
- **Planar arithmetic on lat/lng is correct here** for the reason
  `point-in-ring.ts` gives: containment and crossing are invariant under the
  affine map from degrees to local metres, so a boolean answer needs no
  projection.
- **Known divergence from NTS `Intersects`, stated rather than discovered later:**
  for an invalid or self-intersecting ring, NTS raises `TopologyException` and
  this predicate silently answers. Real OSM contains such rings.

## Where it came from

[`cell-overlap.ts`](./cell-overlap.ts.md) has covered a ring against an H3
hexagon since 2026-08-09, and every line of that test below the boundary lookup
already operated on two plain point arrays — the cell was incidental. This is
that predicate, named for what it does, plus the hole case it could not express.

`cell-overlap.ts` now calls `ringsOverlap`, so there is **one** copy, and its
corpus differential becomes this file's regression guard: **7 141 polygons and
40 000 generated rings, verified against h3 with zero differences.**

## Examples

```ts
ringsOverlap(square, otherSquare); // true if they share any area, touching included

// A courtyard: the small shape is inside the donut's hole, so no shared area.
polygonsOverlap([outer, hole], [smallRingInsideTheHole]); // false
```

## Tests

`ring-overlap.test.ts` — disjoint, partial overlap, containment **both ways**,
identical rings, a shared edge, and degenerate rings; then the hole cases:
swallowed by a hole (**with the ring-only predicate asserted to disagree**, so the
distinction cannot be optimised away), straddling a hole's rim, on the solid part,
each inside the other's hole, and a hole-free shape containing a whole donut.

Two properties: `ringsOverlap` is **symmetric** for arbitrary boxes — the property
most likely to break if a witness is dropped or reordered — and `polygonsOverlap`
with no holes agrees with `ringsOverlap`, which is the regression guard on the
generalisation itself.

The strongest evidence is indirect and lives elsewhere: `cell-overlap.test.ts`
and the corpus differential exercise this predicate against h3 over every ring
the obstacle sweep covers.
