# `segment-crossing.ts` — the "walk around, not through" primitive

## Purpose

Answers whether a straight step crosses a piece of obstacle geometry. This is
the second of the two primitives the navigation design reduces all of pass B to;
[`point-in-ring.ts`](./point-in-ring.ts.md) is the first.

## Public API

- `segmentsIntersect(a, b, c, d) => boolean` — do segments `a→b` and `c→d` meet?
  Touching and collinear overlap both count as `true`.
- `segmentCrossesRing(a, b, ring) => boolean` — does `a→b` cross the ring's
  **boundary**? The ring is closed implicitly.

Points are `PlanarPoint` (`{x, y}`). In this package's navigation path they are
`x = lng, y = lat` degrees. **Error modes: none** — a ring with fewer than two
vertices returns `false` rather than throwing, because a one-node way is
ordinary Overpass output.

## Invariants & assumptions

- **Blocking is a property of the STEP, not of the cell.** A res-13 cell is
  ~8 m across and a wall is ~0.5 m thick, so a wall almost never contains a
  cell's centre — an index that only reported what is standable let an agent
  walk straight through. That is the defect this module removes.
- **Affine-invariant**, so degrees need no metric correction: a crossing in
  lat/lng is a crossing in metres. Same argument `point-in-ring.ts` records.
- **Touching counts as crossing.** The safe direction: refusing a path that
  grazes a wall's corner beats admitting one that clips through geometry.
- **A segment wholly inside a ring crosses nothing.** This predicate is not
  containment, and a caller that needs "is this position inside solid geometry"
  must also ask `containsPoint`. The pair is what the design asks for.
- Collinear overlap is handled explicitly — an orientation-only test reports all
  four cross products as zero and concludes "no intersection", which is wrong
  for the ordinary case of a way running along a wall.

## Examples

```ts
const wall = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
segmentCrossesRing({ x: -1, y: 0.5 }, { x: 2, y: 0.5 }, wall); // true
segmentCrossesRing({ x: -1, y: 2 }, { x: 2, y: 2 }, wall); // false
```

## Tests

- `segment-crossing.test.ts` — the X crossing, the miss, the
  infinite-lines-would-cross case, T-junctions, collinear overlap and
  non-overlap, shared endpoints, the implicit ring close, the inside-only
  segment, degenerate rings, and corner grazing.
- `segment-crossing.property.test.ts` — symmetry in both segments and both
  directions; **inside→outside always crosses**, which ties this predicate to
  `containsPoint` so the two cannot disagree about the same wall; never crossing
  from well outside; and invariance under rotating the ring's vertex order,
  which is what pins the implicit close.
