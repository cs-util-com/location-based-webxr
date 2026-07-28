# `spatial/clip.ts`

## Purpose

Clips geometry to a bounding box, so coverage cost is bounded by the area of
interest rather than by the feature.

## Public API

- `clipToBbox(geometry, bbox): OsmGeometry | undefined`
- `boundsOf(positions): Bbox | undefined`
- `positionsOf(geometry): Generator<LatLng>`
- `padBbox(bbox, margin)`, `bboxesIntersect(a, b)`

## Invariants & assumptions

- **Not an optimisation — a correctness requirement in practice.** Without it,
  indexing the `beach` fixture (a single element containing the entire North
  Sea) attempts a res-13 cover on the order of 10^10 cells. This was found by the
  per-chunk cost test hanging, not by review.
- **Sutherland–Hodgman, which is convex-clip-only — and a bbox is convex**, so
  that limitation does not apply here. It can emit degenerate "seams" for concave
  subjects; that is a rendering artefact and is irrelevant here, because the
  result is immediately rasterised to cells and a zero-width seam covers only
  cells its neighbours already cover.
- **Linestring clipping is a deliberately coarse SEGMENT test**: a segment is
  kept, with both its endpoints, when Cohen–Sutherland says it touches the box —
  not the exact intersection points, and not a test on the vertices. The earlier
  vertex rule ("keep a vertex if it or either neighbour is inside") dropped any
  segment that crossed the box with no vertex near it, which silently deleted
  every long way crossing the working set. Over-keeping costs a few cells that
  are then filtered; under-keeping would lose road.
- **The kept segments are returned as CONTIGUOUS RUNS, never flattened into one
  line.** A way that crosses the box, wanders off and comes back keeps indices
  `{0,1,2, 5,6}`; joining those into a single linestring fabricates the chord
  `2→5`, a segment the way never had, running straight across the box.
  `addLineString` supercovers every consecutive pair, so that chord becomes
  cells **inside** the working set — where, unlike the over-kept ones, nothing
  filters them, and the feature scores ground it never crossed.
  - Hence `MultiLineStringGeometry`: several runs need to be representable as
    _disconnected_. A single run still collapses back to a plain `linestring`,
    so the common case is unchanged for every consumer.
  - `coverCells` covers each run separately and unions the result — covering
    them as one sequence would simply move the fabrication downstream.
- Callers should pad the box (`padBbox`) by more than one cell so the clip cannot
  cut inside a cell the restriction actually asks about. `h3-feature-index` uses
  `0.0005°` (~55 m at the equator) against a 28.7 m res-11 edge.
- Returns `undefined` rather than an empty geometry when nothing remains, so the
  caller's `continue` is unambiguous.

## Examples

```ts
const interest = padBbox(boundsOf(cells.map(cellCentre))!, 0.0005);
const clipped = clipToBbox(geometry, interest);
if (clipped === undefined) continue; // nothing of this feature is in range
```

## Tests

Covered through `h3-feature-index.test.ts` and `chunk-cost.test.ts` — the
behaviour that matters is "indexing a continental feature against a working set
terminates and yields only working-set cells".
