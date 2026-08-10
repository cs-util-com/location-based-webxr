# `spatial/geometry-overlap.ts`

## Purpose

Does a feature overlap a query area — for **every** geometry kind, not only
areas. The narrow phase a spatial query actually needs.

## Public API

- `geometryOverlaps(geometry: PlanarGeometry, query: PlanarPolygon): boolean` —
  the exact predicate. `query` is a `[outer, ...holes]` polygon: the frustum's
  ground footprint.
- `toPlanarGeometry(geometry: OsmGeometry): PlanarGeometry` — the build-time
  conversion from lat/lng to `x = lng, y = lat`.
- `PlanarGeometry` — the five-kind union in planar degrees.

## Why it exists

[`ring-overlap.ts`](./ring-overlap.ts.md) answers for **polygons only**, and
over the site corpus that is a minority: **3 316 of 10 335 elements are nodes**,
and most of the 6 777 ways are open. A query built on the polygon predicate alone
would answer "nothing here" for most of the map — indistinguishable from an
empty area, which is the worst failure mode this package deals in.

## The contract: exact, zero tolerance

Decision 12.2 in `GpsPlusSlamJs_Docs/docs/2026-08-09-1728-osm-spatial-index-build-cost-plan.md`
(named rather than linked: it lives in the sibling `gps-plus-slam` repo, and a
relative path across repo roots breaks on any other checkout layout).

- A **point** overlaps when it is inside the query.
- A **line** overlaps when it enters or crosses the query.
- An **area** overlaps when it shares area — delegated to `polygonsOverlap`.

No width, no buffer, no epsilon.

- **It composes.** Tolerance belongs to the caller, who dilates the query polygon
  once, rather than to every predicate carrying a width that then has to stay in
  sync with what the renderer draws.
- **The accepted cost is real: a road you are standing on is a zero-width line.**
  "What am I looking at" will not return the street under your feet unless the
  caller dilates the query. This is a **caller obligation**, written down rather
  than discovered.

## Invariants & assumptions

- **Holes count for every kind.** A point in a courtyard is not in the building;
  a path across a clearing is not in the wood. The point and line cases agree
  with `polygonsOverlap` deliberately — otherwise one query would answer
  differently depending on how a feature happens to be tagged.
- **A line needs two witnesses, and both are load-bearing.**
  - a vertex on the solid part — the only witness for a line that ends inside;
  - a segment crossing any ring — the only witness for a line that passes clean
    through with both endpoints outside. Not an edge case: a road running past
    the camera whose OSM nodes fall either side of the view is exactly this.
  - **Crossing a HOLE's ring counts**, because a path leaving a courtyard moves
    onto solid ground even when every one of its vertices is in the hole or
    outside the polygon entirely.
- **Boundary cases are undefined for points and defined for areas**, and the
  inconsistency is inherited rather than chosen: `containsPoint` documents that a
  point exactly on an edge falls whichever way floating point puts it, while
  `segmentsIntersect` counts a touch as a crossing. Papering over it would take
  an epsilon — the tolerance this contract exists to refuse — so it is written
  down instead.
- **Degenerate lines are not fatal.** A one-point line is that point; a zero-point
  line overlaps nothing. Real Overpass output contains both.
- **Planar input, converted once.** `geometryOverlaps` takes `PlanarGeometry`, so
  a query allocates nothing. A predicate converting internally would look tidier
  and would allocate an array per ring per feature per frame — the opposite of
  what a narrow phase needs.
- **Exhaustive by construction.** Both `switch`es return in every branch over a
  discriminated union, so a sixth kind added to `osm-geometry.ts` fails to
  compile here rather than being silently dropped.

## Scope

**2D only** (decision 12.3): queries use the frustum's ground footprint. Height
and occlusion are out, so a query at a low wall returns the tower behind it. The
mesh layer knows building heights and a caller can filter afterwards.

## Examples

```ts
const query = [frustumFootprint]; // [outer, ...holes]
const planar = toPlanarGeometry(geometry); // once, at build time
if (geometryOverlaps(planar, query)) {
  /* in view */
}
```

## Tests

`geometry-overlap.test.ts` — per kind: a point inside and outside; a point in the
query's hole; a line with a vertex inside; **a line crossing clean through with no
vertex inside**; a line wholly inside a hole and one leaving across the rim; empty
and single-point lines; multi-kinds both ways; and polygons delegating with the
hole rule intact.

Two conversion tests pin `x = lng, y = lat` — backwards is a mistake that still
looks plausible near the equator — and that every kind survives the conversion.

`geometry-overlap.property.test.ts` carries the one generated run, per the
repo's `*.property.test.ts` convention (moved out of the example file
2026-08-10): the point case agrees with `containsPoint` exactly, which is the
guard on "no tolerance crept in".
