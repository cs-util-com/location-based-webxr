# synthetic-occupancy-grid.ts

## Purpose

Build a **deterministic, CI-safe** `OccupancyGrid` of a known solid box slab of
cells, of any chosen cell count, for the large-scene mesh perf/memory harness
(`occupancy-mesher.perf.test.ts`, F3 of the 2026-06-30 occluder-tuning session).
It replaces — for the _mesh budget gate_ — the local-only real-zip probe that is
skipped in CI.

## Public API

- `buildSyntheticSurfaceGrid(opts): SyntheticSurfaceResult`
  - **Inputs** (`SyntheticSurfaceOptions`): `cellsX`, `cellsZ` (positive ints),
    `thickness` (default 1), `cellSizeM` (default 0.15), `observationsPerCell`
    (default 5 — clears the re-tuned `minConfidence` floor), `centroidOffsetM`
    (default a fixed asymmetric sub-cell offset; each component must be
    `< cellSizeM/2`).
  - **Output** (`SyntheticSurfaceResult`): the populated `grid`, `cellCount`
    (`cellsX·thickness·cellsZ`), `expectedPerFaceTriangles`, `cellSizeM`, and the
    `centroidOffsetM` actually applied.
  - **Error modes**: `RangeError` on non-positive-integer dimensions, non-finite
    cell size, bad observation count, or an offset component `≥ cellSizeM/2`. It
    also throws if a cell falls outside the synthetic view (only reachable if the
    slab-depth heuristic is changed) — loud-fail rather than silently dropping
    cells.

## Invariants & assumptions

- **Exact placement via identity projection.** Camera at the origin, identity
  rotation, identity projection ⇒ `depth-unprojection.ts` collapses to
  `world = ((2·sx−1)·D, (1−2·sy)·D, −D)`, `D = depthM`. The builder inverts this
  to place each cell's point exactly. The slab is pushed to `kBase = −(A+B+C+16)`
  in −Z so every `screenX/screenY ∈ [0,1]` (the only constraint identity
  projection imposes). The budget covers BOTH transverse dimensions (A = width,
  B = thickness) — budgeting only A once made a tall slab trip the loud view
  guard (PR #145 review; pinned by `synthetic-occupancy-grid.test.ts`).
- **Carving disabled.** `carveStopCells = MAX_TRACE_STEPS`, so `carve()` visits
  only the origin cell (never a surface cell) and returns — the placed surface is
  _exactly_ the intended cells and construction stays cheap.
- **Solid box ⇒ exact budgets.** A perfect `A×B×C` box has `2·(A·B+B·C+C·A)`
  exposed faces ⇒ `expectedPerFaceTriangles = 4·(A·B+B·C+C·A)`. A one-cell-thick
  slab (`thickness = 1`, the floor case) is still a **closed** box for the cube
  meshers (top + bottom + perimeter), so the even-edge-cover watertight invariant
  holds. (Note: the F2 `'smooth'` surface-nets mesher produces an **open** sheet
  over a one-cell slab — that is by design and exempt from the closed-surface
  invariant; see the F2 plan.)
- **Known centroids.** Every observation for a cell lands at `centre + offset`,
  so `getCellPoint() = centre + offset` (within `cellSize/2`, ≠ centre) — the
  input the centroid-consuming meshers (F2 `'smooth'`, F2b `'corner-fit'`) need.
- **Performance:** `O(cells · observationsPerCell)` increments; ~20k cells builds
  in well under a second. The cell **count** is the scale proxy, not the metric
  extent.

## Examples

```ts
const { grid, cellCount, expectedPerFaceTriangles, cellSizeM } =
  buildSyntheticSurfaceGrid({ cellsX: 140, cellsZ: 140, thickness: 1 });
const cells = grid.getOccupiedCells(5);
const mesh = meshOccupiedCells(cells, cellSizeM); // per-face
// triangleCount(mesh) === expectedPerFaceTriangles, grid.size === cellCount
```

## Tests

- `../ar/occupancy-mesher.perf.test.ts` — the F3 harness: a tiny hand-verifiable
  box (helper sanity), the centroid check, the ~20k-cell budget/bench, and the
  linear-bytes-per-cell scale-up. Consumes this helper exclusively.
