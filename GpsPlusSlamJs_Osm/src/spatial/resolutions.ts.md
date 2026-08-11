# `spatial/resolutions.ts`

## Purpose

The single source of truth for every H3 resolution in this package, plus the
`gridDisk` radii that define the working sets, plus safe coarsening helpers and
the derived fetch-coverage function the movement trigger uses.

## Public API

- `FETCH_RES = 7` — unit of network fetching and raw-data caching. 2.81 km
  across, 5.16 km², **~21 MB** of decompressed JSON per tile, fetched in
  **~15–90 s that does not replicate**. See the constant's own JSDoc for the
  three figures this line has carried and retracted.
- `SCORE_CHUNK_RES = 11` — unit of scoring, score caching and eviction.
- `AFFORDANCE_RES = 13` — the affordance cell itself.
- `SCORE_DISK_RADIUS = 2` — score working-set radius (19 chunks, ~128 m reach).
- `FETCH_DISK_RADIUS = 1` — **explicit prefetch only**, see below.
- `RES13_CELLS_PER_CHUNK = 49` — expected common case, **not** an invariant.
- `AFFORDANCE_CELL_AREA_M2 = 43.9`.
- `toFetchTile(cell)` / `toScoreChunk(cell)` → `string`. Coarsen a cell to res 7
  / res 11. **Throws** a named `Error` if the input is already coarser than the
  target, because `cellToParent` only ever coarsens.
- `scoreWorkingSet(chunk)` → 19 res-11 cells.
- `fetchTilesForScoreWorkingSet(chunk, radius?)` → 1–3 res-7 cells. **This is
  what the movement trigger calls.** `radius` defaults to
  `SCORE_DISK_MAX_RADIUS` — the widest disk anything scores — so a caller that
  knows nothing about progressive passes cannot be handed a gap. **A caller that
  scores ring by ring must pass its own ring** (W4): the default would make the
  first, user-visible ring wait on a tile only the outer rings need.
- `fetchWorkingSet(fetchTile)` → 7 res-7 cells. Fixed-radius; for the explicit
  "download this area" prefetch API only.
- `cellPaddingDegrees(resolution, worstLatitudeDeg)` → `{ lat, lng }` (converts via `metresToDegrees` in `clip.ts`, so the arithmetic has one home). How far,
  in degrees, a cell at `resolution` can reach beyond its own centre — the
  amount by which a bbox built from cell CENTRES must grow to contain the cells
  themselves.

## Invariants & assumptions

- **`cellToParent`, never string truncation.** H3 stores resolution in the high
  bits of the 64-bit index, so slicing the hex string produces an invalid cell
  rather than a parent. Already a verified gotcha in the framework's
  `h3-proximity.ts`; restated here because this package changes resolution
  constantly.
- **Fetch coverage is derived, not guessed.** `fetchTilesForScoreWorkingSet`
  maps every chunk we are about to score to its own fetch tile and deduplicates.
  The invariant, pinned by property test **at every radius**: **every chunk in
  `scoreWorkingSet(chunk, radius)` maps to a tile in the result**, and therefore
  so does the user's own affordance cell.
  - **At EVERY radius is the part that was missing (W4, finding N1).** The
    property was written when scoring reached exactly `SCORE_DISK_RADIUS`, and it
    kept passing when W16 made scoring progressive out to
    `SCORE_DISK_MAX_RADIUS` — because it only ever asked about the default. Rings
    3 and 4 were therefore scored against tiles nobody had fetched, and an
    unfetched cell scores as the identity: indistinguishable on screen from "no
    rule has ever mentioned this ground", within ~250 m of any res-7 boundary.
  - A fixed `gridDisk(tile, 1)` ring cannot state that. It over-fetches ~150 MB (7 tiles x ~21 MB)
    in the tile interior while remaining only heuristically sufficient at a
    boundary — and at `FETCH_RES = 7` a boundary position is ~20 % of the tile's
    area (inradius 1218 m, working-set reach ~128 m).
  - Deriving also absorbs H3's non-nesting slop for free, because each chunk
    reports its own parent instead of the code predicting it from a position.
  - Result size is bounded at 3 (interior 1, edge 2, vertex 3) and this is
    asserted, because a larger number would mean one-request-per-move is false.
- **`RES13_CELLS_PER_CHUNK` is not guaranteed.** The 12 pentagons per resolution
  have 6 children, not 7, so a chunk descending from a pentagon has fewer than
  49 res-13 children. Pentagons are placed over ocean by design and no target
  area is near one, but sizing a typed array from this constant rather than from
  `cellToChildren(...).length` would be a latent out-of-bounds bug.
- The ladder is 7 → 11 → 13; each step is a whole number of levels (4 and 2),
  which is what makes `cellToParent`/`cellToChildren` round-trip exactly.
- The ratio that matters: one res-7 tile has ~117,649 (7^6) res-13 cells — which
  is why scoring is **never** eager over a fetch tile — and one res-11 chunk has
  49 (7^2).

## History

`FETCH_RES` was 8 until 2026-07-28. It was raised to 7 by owner decision (plan
§2.3, §5.1.1) on the principle of over-fetching rather than under-fetching:
bytes and storage are cheap, Overpass requests are not. One res-7 cell covers
what a 7-tile ring of res-8 cells covered, so the movement trigger issues **one**
request per move instead of seven, and moves are ~7× rarer.

The change is safe because the same day's re-measurement showed a res-7 tile
fetches at all — the earlier belief that large queries were infeasible traced
to a pathological key **regex**, not to area. (That run's "18.2 s" is retracted
with the payload beside it; today's range is ~15–90 s.) See
`GpsPlusSlamJs_Docs/docs/2026-07-28-1040-overpass-remeasurement-findings.md`.

**Any change to `FETCH_RES` must bump `OVERPASS_SCHEMA_VERSION`**, since a
cached tile at one resolution is not a substitute for one at another.

## Examples

```ts
import {
  toScoreChunk,
  scoreWorkingSet,
  fetchTilesForScoreWorkingSet,
  AFFORDANCE_RES,
} from "./resolutions.js";
import { latLngToCell } from "h3-js";

const cell = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);
const chunk = toScoreChunk(cell);

const chunks = scoreWorkingSet(chunk); // 19 res-11 chunks to score
const tiles = fetchTilesForScoreWorkingSet(chunk); // 1-3 res-7 tiles to fetch
```

## Tests

- `resolutions.test.ts` — pins every constant against `h3-js`'s own
  `getHexagonEdgeLengthAvg` / `getHexagonAreaAvg` (so a future h3-js grid change
  fails here rather than silently shifting the package); pins the 7^6 / 7^2
  child counts and the res-7 ≈ 7 × res-8 area equivalence that justifies the
  resolution change; pins the border-band arithmetic (~20 % at res 7 vs ~48 % at
  res 8); asserts working-set sizes; covers the "already coarser" throw; and
  covers `fetchTilesForScoreWorkingSet` for the interior, coverage and
  straddling cases.
- `resolutions.property.test.ts` — over random world coordinates: coarsening is
  idempotent and lands at the target resolution, the ladder round-trips, the
  **non-nesting** property is documented with its one-grid-step bound, and the
  **fetch-coverage invariant** holds including the bounded 1–3 tile result.
  - Also the **padding invariant**: every vertex of a real cell's own boundary
    falls inside `cellPaddingDegrees` of its centre, at any latitude and across
    the antimeridian. This is what the clip in `h3-feature-index` rests on, and
    its failure mode is silent — a dropped cell, not an exception.
  - And the **headroom check**: the worst measured centre→vertex distance stays
    under 2× the average edge length, so an h3 upgrade that changed cell
    geometry enough to eat the factor of 2 fails here rather than in production.
