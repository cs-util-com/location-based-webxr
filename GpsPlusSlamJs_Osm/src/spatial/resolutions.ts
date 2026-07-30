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
 * Edge 1406.5 m, area 5.161 km², 2.81 km across, inradius (centre to edge
 * midpoint) 1218 m.
 *
 * RAISED FROM 8 TO 7 on 2026-07-28 (owner decision, plan §2.3 / §5.1.1): fetch
 * and cache too much around the user rather than too little, because bytes are
 * cheap and Overpass requests are not. One res-7 cell covers what a 7-tile ring
 * of res-8 cells covered, so this is one request per move instead of seven —
 * and moves are ~7x rarer because a res-7 cell is crossed far less often.
 *
 * Measured the same day: a res-7 tile fetches in 18.2 s and 28.31 MB of
 * decompressed JSON (21,847 elements, Cologne). That 28 MB — not the request —
 * is the number to design against; it is why parsing belongs in a worker.
 *
 * One res-7 tile contains ~117,649 (7^6) res-13 cells, so scoring must NEVER be
 * eager over a whole fetch tile.
 */
export const FETCH_RES = 7;

/**
 * The unit of scoring, of caching computed scores, and of cache eviction.
 *
 * Edge 28.66 m, area ~2,150 m², centre-to-centre step 49.6 m. This is
 * deliberately the same value as the app framework's `H3_RESOLUTION`, reused
 * for what it is genuinely good at: a coarse identity / cache key.
 */
export const SCORE_CHUNK_RES = 11;

/** The affordance cell itself. Edge 4.09 m, area 43.9 m². */
export const AFFORDANCE_RES = 13;

/**
 * Radius (in `gridDisk` rings) of fetch tiles for the EXPLICIT prefetch API
 * ("download this area for offline use").
 *
 * NOT used by the movement trigger any more. A fixed ring is a guess: at
 * FETCH_RES = 7 it over-fetches ~140 MB in the interior while still not being
 * provably sufficient at a boundary. The trigger uses
 * {@link fetchTilesForScoreWorkingSet} instead, which derives the answer.
 */
export const FETCH_DISK_RADIUS = 1;

/**
 * Radius (in `gridDisk` rings) of res-11 chunks scored around the user.
 * 2 rings = 19 chunks = 931 res-13 cells, reaching ~128 m from the user for a
 * ~250 m span.
 */
export const SCORE_DISK_RADIUS = 2;

/**
 * How far scoring eventually reaches, in `gridDisk` rings (W16, DEC-R2-30).
 *
 * 4 rings = 61 chunks = ~2 989 res-13 cells, reaching ~250 m from the user.
 *
 * **`SCORE_DISK_RADIUS` is still what the FIRST pass scores, and that is the
 * point rather than an implementation detail.** The rings beyond it are scored
 * afterwards and emitted as they finish, so the extra reach costs nothing at the
 * moment the user is actually waiting. Making the first answer slower in order
 * to make the rings uniform would trade the thing people notice for the thing
 * they do not.
 *
 * The C# reference's analogue is one ring of ~153 m tiles around a ~153 m
 * centre; two extra rings here is the same shape at this grid's scale.
 */
export const SCORE_DISK_MAX_RADIUS = 4;

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

/**
 * The fetch tiles a fixed-radius prefetch would load around `fetchTile`.
 *
 * For the EXPLICIT prefetch API only — see {@link FETCH_DISK_RADIUS}. The
 * movement trigger must use {@link fetchTilesForScoreWorkingSet}.
 */
export function fetchWorkingSet(fetchTile: string): string[] {
  return gridDisk(fetchTile, FETCH_DISK_RADIUS);
}

/** The res-11 chunks that must be scored for a user standing in `chunk`. */
export function scoreWorkingSet(
  chunk: string,
  radius: number = SCORE_DISK_RADIUS,
): string[] {
  // Clamped rather than trusted. A negative radius makes `gridDisk` throw and a
  // large one is a working set nobody asked for — this is called with a ring
  // counter, and a counter is exactly the kind of value that goes wrong by one.
  return gridDisk(
    chunk,
    Math.max(0, Math.min(SCORE_DISK_MAX_RADIUS, Math.floor(radius))),
  );
}

/**
 * The fetch tiles that must be loaded so every chunk in the score working set
 * around `chunk` has data — derived, not guessed.
 *
 * Returns 1 tile when the working set sits inside one fetch cell, 2 when it
 * straddles an edge, 3 near a vertex. This replaces "the tile I am in, plus a
 * ring": a ring both over-fetches in the interior (~140 MB at FETCH_RES = 7)
 * and is only heuristically sufficient at a boundary, whereas asking the
 * working set what it needs is exact by construction.
 *
 * It also absorbs H3's non-nesting slop for free. A res-11 chunk is not
 * geometrically inside its `cellToParent` fetch tile, so predicting coverage
 * from the user's position needs a fudge factor; enumerating the chunks does
 * not, because each chunk reports its own parent.
 *
 * INVARIANT (pinned by property test): for any position, every chunk in
 * `scoreWorkingSet` maps to a tile in this result.
 */
export function fetchTilesForScoreWorkingSet(chunk: string): string[] {
  const tiles = new Set<string>();
  for (const c of scoreWorkingSet(chunk)) {
    tiles.add(toFetchTile(c));
  }
  return [...tiles];
}
