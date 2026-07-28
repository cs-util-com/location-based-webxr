# `spatial/resolutions.ts`

## Purpose

The single source of truth for every H3 resolution in this package, plus the
two `gridDisk` radii that define the working sets, plus safe coarsening
helpers.

## Public API

- `FETCH_RES = 8` — unit of network fetching and raw-data caching.
- `SCORE_CHUNK_RES = 11` — unit of scoring, score caching and eviction.
- `AFFORDANCE_RES = 13` — the affordance cell itself.
- `FETCH_DISK_RADIUS = 1` / `SCORE_DISK_RADIUS = 2` — working-set radii.
- `RES13_CELLS_PER_CHUNK = 49` — expected common case, **not** an invariant.
- `AFFORDANCE_CELL_AREA_M2 = 43.9`.
- `toFetchTile(cell)` / `toScoreChunk(cell)` → `string`. Coarsen a cell to res 8
  / res 11. **Throws** a named `Error` if the input is already coarser than the
  target, because `cellToParent` only ever coarsens.
- `fetchWorkingSet(fetchTile)` → 7 res-8 cells.
- `scoreWorkingSet(chunk)` → 19 res-11 cells.

## Invariants & assumptions

- **`cellToParent`, never string truncation.** H3 stores resolution in the high
  bits of the 64-bit index, so slicing the hex string produces an invalid cell
  rather than a parent. Already a verified gotcha in the framework's
  `h3-proximity.ts`; restated here because this package changes resolution
  constantly.
- **`RES13_CELLS_PER_CHUNK` is not guaranteed.** The 12 pentagons per
  resolution have 6 children, not 7, so a chunk descending from a pentagon has
  fewer than 49 res-13 children. Pentagons are placed over ocean by design and
  no target area is near one, but sizing a typed array from this constant rather
  than from `cellToChildren(...).length` would be a latent out-of-bounds bug.
- The ladder is 8 → 11 → 13; each step is a whole number of levels
  (3 and 2 respectively), which is what makes `cellToParent`/`cellToChildren`
  round-trip exactly.
- The ratios that matter: one res-8 tile has ~16,807 (7^5) res-13 cells — which
  is why scoring is **never** eager over a fetch tile — and one res-11 chunk has
  49 (7^2).

## Examples

```ts
import { toFetchTile, scoreWorkingSet, AFFORDANCE_RES } from "./resolutions.js";
import { latLngToCell } from "h3-js";

const cell = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);
const tile = toFetchTile(cell); // res-8 cell to fetch OSM data for
const chunks = scoreWorkingSet(toScoreChunk(cell)); // 19 res-11 chunks to score
```

## Tests

- `resolutions.test.ts` — pins every constant's H3 metrics against `h3-js`'s own
  `getHexagonEdgeLengthAvg` / `getHexagonAreaAvg`, so a future h3-js change that
  moved the grid would fail here rather than silently shifting the whole
  package; pins the 7^5 / 7^2 child counts; asserts the working-set sizes; and
  covers the "already coarser" throw.
- `resolutions.property.test.ts` — over random world coordinates: coarsening is
  idempotent at the target resolution, `toFetchTile` agrees with a direct
  `latLngToCell(..., 8)`, and the ladder round-trips (a res-13 cell's res-11
  parent's res-8 parent equals its direct res-8 parent).
