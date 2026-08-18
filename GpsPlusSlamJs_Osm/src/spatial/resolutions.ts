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

import {
  cellToParent,
  gridDisk,
  getResolution,
  getHexagonEdgeLengthAvg,
  UNITS,
} from "h3-js";
import { metresToDegrees } from "./clip.js";

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
 * **A res-7 tile is ~21 MB of decompressed JSON.** That figure — not the
 * request — is the number to design against; it is why parsing belongs in a
 * worker. It is the sturdiest number in this package: 21.1 MB in the 2026-08-01
 * matrix sweep and 20.97–21.11 MB in the 2026-08-03 re-run, replicating to
 * three significant figures across three separate runs under `areal-only`.
 *
 * **LATENCY IS A RANGE, DELIBERATELY NOT A MEDIAN: ~15–90 s, and it does not
 * replicate.** The four successful `areal-only` res-7 fetches in
 * `docs/overpass-matrix-sweep.json` are 15.1 / 32.9 / 82.9 / 91.1 s, alongside
 * two 504s — and the 2026-08-03 re-run's own §2b records medians 4.6x the
 * morning's on identical work, concluding that **"the bytes replicate to three
 * significant figures; the timings do not replicate at all"**. Design for the
 * 90 s end. A single latency quoted here is quoting noise.
 *
 * SUPERSEDED FIGURES, kept because this comment has now been wrong three times
 * and every wrong version is still quotable elsewhere:
 *
 * - **"~68 MB, 23–110 s" is retracted** — that is the pre-F32 `nwr` form, which
 *   took every relation touching the bbox. `overpass-query.ts` adopted
 *   areal-only on 2026-08-03; the payload fell 3.2x, provably without changing
 *   a single cell score. **Whether latency moved with it is unknown** — the two
 *   forms were never timed under comparable load.
 * - **"18.2 s and 28.31 MB (21,847 elements)" is retracted** (N2, W2). It was
 *   under half even the `nwr` payload and had no host, query or artefact behind
 *   it; where it came from is not recoverable, most plausibly a narrower key
 *   list than `OVERPASS_SELECT_KEYS` at the time.
 * - **"~20 s median" is retracted, and it lasted one day (2026-08-11).** This
 *   comment carried it and fifteen other sites copied it. It came from
 *   `overpass-query.ts`'s own prose rather than from an artefact; it was the
 *   fastest sample of three non-replicating runs rather than a median; and the
 *   (itself retracted) `18–110 s` string it replaced bracketed the real
 *   distribution better than it did.
 *   **A correction sourced from another comment is not a correction.**
 *
 * See `GpsPlusSlamJs_Docs/docs/2026-08-01-1324-overpass-matrix-sweep-results.md`
 * §1 for the per-form byte table — it has no latency column at all, and that
 * absence is what the third retraction above turned on —
 * `GpsPlusSlamJs_Docs/docs/2026-08-03-0802-overpass-matrix-sweep-rerun-results.md`
 * §2b for the non-replication finding, and
 * `GpsPlusSlamJs_Docs/docs/2026-08-11-0717-osm-demo-click-path-stage-timing-plan.md`
 * §8 for why a stale figure here is a defect rather than untidiness: this
 * comment is the most quotable source for the number, so a plan written from it
 * inherits whatever it says.
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
 * FETCH_RES = 7 it over-fetches ~150 MB (7 tiles x ~21 MB) in the interior while still not being
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

/**
 * The tile a geo-event is quantised to (round 9 §2, DEC-R9-4).
 *
 * EVERY DEVICE IN THE SAME TILE AT THE SAME QUARTER-HOUR COMPUTES THE SAME
 * EVENT, with no network between them. That is the whole feature, and the tile
 * is what makes it possible: the position is drawn from a seeded hash of
 * (tile, time, candidate), so two devices agree exactly when they agree on the
 * tile.
 *
 * **Res 8 is the nearest rung, and the size is a free choice.** The C# uses
 * geohash precision 6, and an earlier draft justified res 8 as being within
 * ~1 % of it — which is true only at the equator. A geohash cell is a fixed
 * 0.010986° x 0.005493°, so its width shrinks with cos(latitude): 0.743 km² at
 * the equator but 0.468 km² at Cologne, against res 8's 0.7373 km² — about
 * 1.58x, not 1 %. Nothing interoperates with the C# (DEC-R6-14d/e), so the
 * comparison never mattered; what matters is that res 7 is the whole fetch tile
 * at 5.16 km² and res 9 is 0.105 km², seven times too small.
 *
 * **It reintroduces a rung the package dropped**: `FETCH_RES` was 8 until
 * 2026-07-28. The ladder is now 7 → 8 → 11 → 13, still whole levels apart.
 *
 * **Derive it from a POSITION, never by coarsening a res-13 cell.** H3's index
 * hierarchy is not geometric containment, and `demo-pipeline.ts` measures that
 * biting at four of sixty sweep points over Cologne. {@link toEventTile} exists
 * for cells that are already coarse enough; a position goes through
 * `latLngToCell`.
 */
export const EVENT_TILE_RES = 8;

/** Coarsens a cell to the event-tile level. See {@link toFetchTile}. */
export function toEventTile(cell: string): string {
  return coarsenTo(cell, EVENT_TILE_RES);
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
 * Returns a small handful: 1 tile when the working set sits inside one fetch
 * cell, more when it straddles an edge or a vertex. This replaces "the tile I am
 * in, plus a ring": a ring both over-fetches in the interior (~150 MB (7 tiles x ~21 MB) at
 * FETCH_RES = 7) and is only heuristically sufficient at a boundary, whereas
 * asking the working set what it needs is exact by construction.
 *
 * It also absorbs H3's non-nesting slop for free. A res-11 chunk is not
 * geometrically inside its `cellToParent` fetch tile, so predicting coverage
 * from the user's position needs a fudge factor; enumerating the chunks does
 * not, because each chunk reports its own parent.
 *
 * **`radius` MUST match what is about to be scored (W4, finding N1).** The
 * default is the WIDEST disk, because a caller that does not know about
 * progressive passes must not be handed a gap. A caller that scores ring by ring
 * passes its own ring, and that matters in the other direction: with the default
 * the fetch loop blocks the FIRST answer on a tile only the outer rings need,
 * which is ~15–90 s at a res-7 boundary and undoes exactly the property W16 was
 * built for (see {@link SCORE_DISK_MAX_RADIUS}).
 *
 * This parameter arrived because scoring outgrew fetching silently: W16 widened
 * the scored disk to `SCORE_DISK_MAX_RADIUS` while this function still derived
 * from `SCORE_DISK_RADIUS`, so within ~250 m of a res-7 boundary the outer rings
 * were scored against data that had never been downloaded — and an unfetched
 * cell scores as the identity, which reads as "nothing is mapped here".
 *
 * INVARIANT (pinned by property test, at EVERY radius): every chunk in
 * `scoreWorkingSet(chunk, radius)` maps to a tile in this result.
 */
export function fetchTilesForScoreWorkingSet(
  chunk: string,
  radius: number = SCORE_DISK_MAX_RADIUS,
): string[] {
  const tiles = new Set<string>();
  for (const c of scoreWorkingSet(chunk, radius)) {
    tiles.add(toFetchTile(c));
  }
  return [...tiles];
}

/**
 * How far, in DEGREES, a cell at `resolution` can reach beyond its own centre.
 *
 * WHAT IT IS FOR. Code that bounds a set of cells by the bbox of their CENTRES
 * has bounded the centres, not the cells: geometry can pass through a cell while
 * lying outside that bbox, and clipping to it would drop coverage the cell
 * genuinely has. Padding by this closes the gap.
 *
 * WHY A FACTOR OF 2, AND WHY IT IS A BOUND RATHER THAN A GUESS. A regular
 * hexagon's circumradius equals its edge length, so `getHexagonEdgeLengthAvg` is
 * the right scale; real H3 cells vary around that average, so it is scaled up.
 * Measured 2026-07-31 over 60 000 cells sampled uniformly on the sphere at
 * res 13: the largest centre→vertex distance is 4.514 m against a 4.092 m
 * average edge, a ratio of **1.103**. The twelve pentagons and their two-rings —
 * the known distortion case — are SMALLER (0.859×), not larger. A factor of 2
 * therefore clears the measured worst case by 1.8×, and `resolutions.property.test.ts`
 * pins the ratio so an h3 upgrade that changed cell geometry fails there rather
 * than silently dropping coverage.
 *
 * WHY THE TWO AXES DIFFER. A degree of longitude shortens with latitude, so the
 * same distance is MORE degrees the further from the equator — which is why a
 * single fixed degree margin cannot be correct everywhere. `worstLatitudeDeg`
 * should be the bbox corner furthest from the equator, so the padding is
 * sufficient across the whole box.
 *
 * AT THE POLES this degrades safely rather than breaking: `cos` approaches zero,
 * so the longitude padding grows without bound and the clip keeps everything.
 * Over-keeping costs time (and the caller's own oversize guard still applies);
 * under-keeping would lose real coverage, which is the failure this exists to
 * prevent.
 */
export function cellPaddingDegrees(
  resolution: number,
  worstLatitudeDeg: number,
): { lat: number; lng: number } {
  const reach = 2 * getHexagonEdgeLengthAvg(resolution, UNITS.m);
  // The metres→degrees conversion itself lives in `clip.ts`, so this function
  // and the demo's plate-clip box cannot drift apart (PR #236).
  return metresToDegrees(worstLatitudeDeg, reach);
}
