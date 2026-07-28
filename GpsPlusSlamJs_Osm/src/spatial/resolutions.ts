/**
 * THE resolution ladder — the single source of truth for every H3 resolution
 * this package uses.
 *
 * Getting these wrong is the most likely source of subtle bugs in the whole
 * package (a fetch keyed at the wrong level silently never hits cache; a score
 * chunk at the wrong level silently blows the frame budget), so the values are
 * stated exactly once, exported as named constants, and asserted in tests.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-07-28-0624-osm-h3-affordance-index-plan.md §4.4
 */

import { cellToParent, gridDisk, getResolution } from "h3-js";

/**
 * The unit of network fetching and raw-data caching.
 *
 * Edge 531 m, area 0.737 km², roughly 1.06 km across. Comparable to the C#
 * reference's geohash-p6 download tile (~1.2 × 0.61 km).
 *
 * NOTE the edge figure: the plan quotes 461 m, which comes from the pre-v4.1 H3
 * documentation table. h3-js 4.4 reports 531.41 m, which agrees with the value
 * derived geometrically from the average area, so the newer number is the right
 * one. Areas were correct in the plan all along; only edge lengths were stale.
 *
 * One res-8 tile contains ~16,807 (7^5) res-13 cells, so scoring must NEVER be
 * eager over a whole fetch tile.
 */
export const FETCH_RES = 8;

/**
 * The unit of scoring, of caching computed scores, and of cache eviction.
 *
 * Edge 28.7 m, area ~2,150 m². (The plan says 24.9 m — same stale-table issue
 * as FETCH_RES above.) This is deliberately the same value as the app
 * framework's `H3_RESOLUTION`, reused for what it is genuinely good at: a
 * coarse identity / cache key.
 */
export const SCORE_CHUNK_RES = 11;

/**
 * The affordance cell itself. Edge 4.09 m, area 43.9 m². (The plan says 3.56 m —
 * same stale-table issue as FETCH_RES above; the 43.9 m² area is correct.)
 */
export const AFFORDANCE_RES = 13;

/**
 * Radius (in `gridDisk` rings) of res-8 tiles kept loaded around the user.
 * 1 ring = 7 tiles ≈ 5.2 km², mirroring the C# reference's "centre +
 * neighbours so a finer algorithm can roam without hitting borders".
 */
export const FETCH_DISK_RADIUS = 1;

/**
 * Radius (in `gridDisk` rings) of res-11 chunks scored around the user.
 * 2 rings = 19 chunks = 931 res-13 cells, covering roughly a 250 m span.
 */
export const SCORE_DISK_RADIUS = 2;

/**
 * Number of res-13 children a res-11 chunk normally has: 7^2, two levels down.
 *
 * NOT a hard invariant. The 12 pentagons per resolution have 6 children rather
 * than 7, so a chunk descending from a pentagon yields fewer. Pentagons sit in
 * the ocean by design and no target area is near one, but callers must size
 * records from `cellToChildren(...).length` and treat this constant as the
 * expected common case, never as a guaranteed count.
 */
export const RES13_CELLS_PER_CHUNK = 49;

/** Approximate average area of one res-13 cell, in square metres. */
export const AFFORDANCE_CELL_AREA_M2 = 43.9;

/**
 * Coarsens a cell to the fetch-tile level.
 *
 * @throws if `cell` is finer-resolution than {@link FETCH_RES} would allow —
 *   i.e. if it is already coarser than res 8, because `cellToParent` only ever
 *   coarsens.
 */
export function toFetchTile(cell: string): string {
  return coarsenTo(cell, FETCH_RES);
}

/** Coarsens a cell to the score-chunk level. See {@link toFetchTile}. */
export function toScoreChunk(cell: string): string {
  return coarsenTo(cell, SCORE_CHUNK_RES);
}

/**
 * `cellToParent` with a defensive, named error instead of h3-js's generic
 * throw.
 *
 * **Never string-truncate an H3 id to coarsen it.** The resolution lives in the
 * high bits of the 64-bit index, so slicing the hex string yields an INVALID
 * cell, not a parent. This is an already-documented, already-verified gotcha in
 * the app framework's `h3-proximity.ts`; it is restated here because this
 * package changes resolution far more often than that one does.
 */
function coarsenTo(cell: string, targetRes: number): string {
  const res = getResolution(cell);
  if (res < targetRes) {
    throw new Error(
      `Cannot coarsen ${cell} (res ${res}) to res ${targetRes}: cellToParent only coarsens. ` +
        `Pass a cell at res >= ${targetRes}.`,
    );
  }
  return cellToParent(cell, targetRes);
}

/** The res-8 tiles that must be loaded for a user standing in `fetchTile`. */
export function fetchWorkingSet(fetchTile: string): string[] {
  return gridDisk(fetchTile, FETCH_DISK_RADIUS);
}

/** The res-11 chunks that must be scored for a user standing in `chunk`. */
export function scoreWorkingSet(chunk: string): string[] {
  return gridDisk(chunk, SCORE_DISK_RADIUS);
}
