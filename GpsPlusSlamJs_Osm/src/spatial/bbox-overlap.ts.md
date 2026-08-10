# `spatial/bbox-overlap.ts`

## Purpose

The cheap **"definitely not"** a spatial query's narrow phase asks before running
the exact predicate. Conservative by construction: `false` proves disjoint,
`true` means "maybe — run the exact test".

## Public API

- `bboxOverlapsPolygon(bbox: Bbox, query: PlanarPolygon): boolean`
  - `bbox` — [`clip.ts`](./clip.ts.md)'s `{ west, south, east, north }`, which
    the index already holds because a tree needs it to insert.
  - `query` — an `[outer, ...holes]` polygon in `x = lng, y = lat`. **Only the
    outer ring is read.**
  - Never throws. No allocation.

## Why it exists — the 37× asymmetry

Measured over a realistic frustum query (`spatial-query.bench.ts`):

- a candidate that **overlaps** costs **0.30 µs** — the predicate returns on the
  first witness that fires;
- one that **does not** costs **11.4 µs** — it must exhaust all three witnesses,
  and the third is an O(n·m) scan over every edge pair. `london-westminster`
  holds a 1 031-point ring.

So a query's cost is its **rejections**, and answering them in a handful of
comparisons is the whole optimisation. The narrow phase is **92 %** of query
cost; the tree itself is 3–6 µs and effectively free.

## The one thing to understand before changing it

**This is not the bounding-box guard it looks like.**

- A packed R-tree broad phase (`flatbush`) already performs an exact
  box-versus-box test at leaf level. Re-testing the candidate's bbox against the
  **query's bbox** therefore rejects _nothing_ — measured at **371 of 371** and
  **1 239 of 1 239** survivors on box queries.
- What pays is testing the candidate's bbox against the **query POLYGON**. A view
  frustum is a trapezoid whose bounding box is ~2× its area, so the corners the
  broad phase hands over are genuine false positives — and those are the 37×
  rejections.
- [`cell-overlap.ts`](./cell-overlap.ts.md) runs the _ordinary_ form of the guard
  and is **not** this: its candidates come from an unfiltered grid disk, so there
  the plain box test throws most of them away.

## Invariants & assumptions

- **Conservative, never exact.** `false` ⟹ disjoint. `true` ⟹ unknown. For a
  non-convex query the axis set may fail to separate two genuinely disjoint
  shapes; that is a false `true`, costing one exact test and losing nothing.
  A false `false` is impossible because a ring lies wholly inside its own bbox.
- **Touching counts as overlapping**, matching `bboxesIntersect` and
  `segmentsIntersect`. A guard stricter than the predicate it guards would reject
  shapes the exact test admits — the one way a conservative test stops being
  conservative.
- **Holes are ignored, deliberately.** A hole only shrinks the query, so reading
  one could reject a candidate over it that the exact test would still find on
  solid ground. Pinned by a property, because "also check the holes" reads like
  an obvious improvement and is a correctness regression.
- **Non-finite input is passed through as `true`**, not decided. Declining is
  always safe; asserting is not. Same reasoning as `cell-overlap.ts` returning
  `undefined` for "ask h3 instead".
- **An outer ring of fewer than three points bounds no area** and overlaps
  nothing, so it answers `false`.
- **No allocation, by design.** `geometry-overlap.ts` states the invariant this
  plugs into: a narrow phase allocating per candidate per frame is the opposite
  of what it needs. The box is projected onto each axis in O(1) from its min/max
  and the normal's signs, rather than materialising four corner points.
- **Normals are unnormalised.** Scaling an axis cannot change whether two
  intervals on it overlap, so the square root is wasted work.

## Algorithm

Separating axes. One axis on which the two projections do not overlap proves
disjointness. Tried in this order, cheapest first:

1. the box's own two axes (x, y) — rejects the common far-away candidate;
2. every edge normal of the query's outer ring — this is what a box-versus-box
   test cannot do, and what sees a frustum's diagonal edges.

## Examples

```ts
// A candidate in the frustum's bottom-left corner: inside its BOUNDING BOX,
// outside the trapezoid. The case this module exists for.
bboxOverlapsPolygon({ west: -0.95, south: 0.05, east: -0.6, north: 0.3 },
                    [frustum]); // false — skip the exact test

// Anything else: run the exact test.
if (bboxOverlapsPolygon(bbox, query) && geometryOverlaps(geometry, query)) { … }
```

## Tests

- `bbox-overlap.property.test.ts` — **safety**: the implication
  `geometryOverlaps(g, q) ⟹ bboxOverlapsPolygon(bboxOf(g), q)` over generated
  points, lines and polygons against generated rotated quads. The converse is
  deliberately not asserted; requiring it would be requiring the guard to _be_
  the exact predicate. Plus the hole-blindness property.
- `bbox-overlap.test.ts` — **usefulness**: that it actually rejects, and
  specifically the inside-the-bbox / outside-the-polygon case. Needed because a
  guard returning `true` unconditionally passes every line of the property file.

The two bracket the implementation from opposite sides; **either alone admits a
trivially wrong version** — always-`true` is safe and useless, always-`false` is
fast and empties the map.

## Related

- [`ring-overlap.ts`](./ring-overlap.ts.md) / [`geometry-overlap.ts`](./geometry-overlap.ts.md)
  — the exact predicates this stands in front of.
- `GpsPlusSlamJs_Docs/docs/2026-08-09-1728-osm-spatial-index-build-cost-plan.md`
  §13.1a (the 37× measurement) and §15.4 (why the obvious form is a no-op).
