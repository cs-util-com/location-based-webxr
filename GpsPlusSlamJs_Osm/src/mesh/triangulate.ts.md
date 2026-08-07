# `mesh/triangulate.ts`

## Purpose

Hole-aware ear-clipping triangulation of a footprint, in the ENU frame.

## Public API

- `triangulate(rings): TriangulationResult` — `{ vertices, indices, forcedEars }`
- `dropClosingPoint(ring): EnuPoint[]`
- `triangulatedArea(result): number`

## Invariants & assumptions

- **Ours, not `earcut`** — production takes no runtime dependency but `h3-js`.
  `earcut` is a devDependency ORACLE (plan §4.2.1): a differential test compares
  total area on generated convex polygons and on a footprint with a hole. That
  harness is what found the winding inversion described in `enu.ts.md`.
- **Holes are bridged into the outer ring, rightmost-first.** The ordering is
  load-bearing: bridging a left-hand hole first can lay its bridge across a
  right-hand one, giving a self-intersecting ring whose triangles overlap —
  which renders as flicker rather than as an error.
- **Winding is normalised**: outer counter-clockwise, holes clockwise. Real OSM
  rings arrive both ways.
- **A progress guard forces an ear after two fruitless passes.**
  Non-termination is the failure mode that costs most here — this package
  already lost a run to a coverage call that never finished. `forcedEars > 0`
  reports that the input was degenerate, rather than hiding it.
- **Collinear triples are rejected as ears** (`<= 0`, not `< 0`), because a
  zero-area triangle renders as nothing and breaks normal computation.
- Input that cannot form a triangle returns an empty result rather than
  throwing. A hole too small to be a ring is dropped, not allowed to corrupt the
  outline.
- Output is index triples into the returned vertex list, so the caller owns the
  vertex buffer and no coordinates are copied.

## Examples

```ts
const cap = triangulate([outerRing, courtyardRing]);
```

## Tests

`triangulate.test.ts` — area conservation for convex and concave footprints,
winding independence, closed-ring input, one and two holes, degenerate input,
the progress guard on collinear runs and on a fully degenerate ring, and two
differential tests against `earcut`.
