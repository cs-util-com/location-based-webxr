# `regions/connected-components.ts`

## Purpose

Groups cells into maximal sets connected under `gridDisk(cell, 1)`. Replaces the
C# reference's `FloodFill`.

## Public API

- `connectedComponents(cells, minSize = 2): string[][]`

## Invariants & assumptions

- **The hex grid makes this smaller, not just different.** The reference's flood
  fill ran on a geohash grid, which is rectangular, which forced two things this
  does not need:
  - a **rectangularity invariant** (`throw "The input map is not rectangular"`)
    and a dense fill of empty tiles with neutral heat that existed only to
    satisfy it;
  - an **8-neighbourhood**, because a rectangular grid has two kinds of adjacency
    (edge and corner) and choosing between them is a judgement call.

  A hex grid has exactly one adjacency and no bounding rectangle, so
  `gridDisk(cell, 1)` is the entire neighbourhood definition and sparse, ragged
  input is the natural input.

- **Deterministic.** Components come back sorted by their lowest member and each
  component's cells are sorted. Region identity is derived from component
  membership, so a nondeterministic grouping would produce nondeterministic ids.
- **`minSize` defaults to 2**, matching the reference's `minTileCount`. A single
  isolated above-threshold cell is almost always one small mapped object rather
  than a region, and emitting it buries the real regions in noise.
- **Explicit stack, not recursion.** A component can span a whole working set
  (931 cells) and far more in any future coarser mode. Recursion here is a stack
  overflow waiting for a big park.
- Duplicate input cells are collapsed.

## Examples

```ts
const components = connectedComponents(
  cellsAboveThreshold(scored, "walkable", 1),
);
```

## Tests

`regions.test.ts` — grouping and separation, `minSize`, ragged/sparse input,
determinism under input order, deduplication, empty input, and the reachability
property that defines a component.
