/**
 * A multi-level uniform grid over host-candidate bounding boxes, so a marker
 * only meets the candidates that could possibly contain it.
 *
 * WHY THIS EXISTS. `annotatePoiHosts` walked every (marker, candidate) pair. Its
 * broad phase is four float compares, so the constant is tiny — but the shape is
 * `markers × candidates` and BOTH grow with the working set, so four times the
 * data is sixteen times the work. Measured 2026-08-22 on the replicated
 * `london-westminster` fixture: 240 × 4 768 pairs cost 10.5 ms and 960 × 19 072
 * cost 197.2 ms — 16× the pairs for 18.9× the time, which is the quadratic
 * stated plainly. It was 17.3 % of the demo's whole mesh build.
 *
 * **WHY MULTI-LEVEL, WHICH IS THE ONE DESIGN DECISION HERE.** OSM footprint size
 * is unbounded, so a single pitch cannot serve both a 12 m house and a 400 m
 * relation: a candidate far larger than the pitch has to be written into
 * hundreds of cells. The obvious guard — hold oversized candidates out in a flat
 * list checked by every marker — was implemented first and MEASURED, and it
 * reintroduced the very quadratic this file exists to remove:
 *
 * - at 1 copy of the fixture, 1 candidate overflowed; at 9 copies, 9 did
 * - so `markers × overflow` was 60 pairs against **4 860** — **72 % of all
 *   remaining pairs at 9 copies**, growing as the product again
 *
 * Levels fix it at the root. A candidate is inserted at the finest level whose
 * cells it does not flood, so a big footprint lands in one or two coarse cells
 * instead of hundreds of fine ones, and every level is still a point lookup. The
 * flat overflow list survives only as a backstop for geometry too large for even
 * the coarsest level, which at the factors below means wider than ~27 km.
 *
 * **ORDER IS THE HARD CONSTRAINT, NOT SPEED.** `annotatePoiHosts` must produce
 * each marker's hosts in CANDIDATE order, because the caller orders candidates
 * buildings-first and takes the first enabled host — a café inside a building
 * that stands on a landuse plate belongs to the building. So this index cannot
 * return a bag of hits: candidates are inserted in index order, so every cell's
 * list is ascending, and the per-level lists are **merged** rather than
 * concatenated, because concatenating would place a coarse-level plate after a
 * fine-level building that follows it in candidate order.
 *
 * @see host-grid.ts.md
 */

/** Axis-aligned bounds, ENU metres, as `footprintAnchor` already returns them. */
export interface CandidateBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Cells one candidate may occupy at a level before it is promoted to the next.
 *
 * 64 is two orders of magnitude above the typical building — the measured
 * median footprint occupies ONE cell at the chosen pitch, and the 99th
 * percentile 18 — and well below the point where insertion costs more than
 * scanning. It bounds the build at `64 × candidates` writes however
 * pathological the geometry is.
 */
const MAX_CELLS_PER_CANDIDATE = 64;

/**
 * Pitch multiplier between levels, and how many levels there are.
 *
 * 16× per level, three levels. A candidate that floods the fine grid at 64 cells
 * covers at most 4 cells one level up, so two promotions are enough for anything
 * short of continental geometry: at a measured fine pitch of ~13 m the coarsest
 * level is ~3.4 km, and 64 of those cells is ~27 km. Wider than that is the
 * backstop's business.
 */
const LEVEL_FACTOR = 16;
const LEVEL_COUNT = 3;

/**
 * Smallest grid pitch, metres.
 *
 * A floor rather than a pure average, because a working set of only tiny
 * footprints would otherwise pick a pitch so fine that a marker's own cell
 * lookup dominates. 8 m is below a small building and above the point where the
 * cell count explodes over a 4.8 km extent.
 */
const MIN_PITCH_M = 8;

/** The index. Opaque to callers — build it, then ask it about points. */
export interface HostGrid {
  /**
   * Candidate indices whose bounds could contain `point`, ASCENDING.
   *
   * Ascending is the contract, not an implementation detail — see the module
   * docstring for why the caller depends on it.
   *
   * The result is a **shared scratch array, valid until the next call.** Callers
   * read it and move on; the alternative is one allocation per marker, which is
   * part of the cost this index exists to remove.
   */
  candidatesAt(point: {
    readonly x: number;
    readonly y: number;
  }): readonly number[];
}

/** One pitch and the cells at it. */
interface Level {
  readonly pitch: number;
  readonly cells: Map<number, number[]>;
}

/**
 * Indexes `bounds` by position.
 *
 * An empty input, or one where every candidate is oversized, needs no special
 * case: the levels are simply empty and every query returns the backstop list.
 */
export function buildHostGrid(bounds: readonly CandidateBounds[]): HostGrid {
  const base = pitchFor(bounds);
  const levels: Level[] = [];
  for (let i = 0; i < LEVEL_COUNT; i++) {
    levels.push({ pitch: base * LEVEL_FACTOR ** i, cells: new Map() });
  }
  const oversized: number[] = [];

  for (let i = 0; i < bounds.length; i++) {
    const box = bounds[i] as CandidateBounds;
    // An empty footprint yields an INVERTED box, which contains nothing — it
    // must not reach a grid, where min > max would produce a negative span.
    if (box.minX > box.maxX || box.minY > box.maxY) continue;
    if (!insert(levels, box, i)) oversized.push(i);
  }

  // Reused across queries; see `candidatesAt`.
  const scratch: number[] = [];
  // Sized once: one list per level, plus the backstop.
  const heads: (readonly number[])[] = [];
  const cursors: number[] = [];

  return {
    candidatesAt(point) {
      heads.length = 0;
      for (const level of levels) {
        const list = level.cells.get(
          cellKey(
            Math.floor(point.x / level.pitch),
            Math.floor(point.y / level.pitch),
          ),
        );
        if (list !== undefined) heads.push(list);
      }
      if (oversized.length > 0) heads.push(oversized);
      if (heads.length === 0) return EMPTY;
      // The common case by a wide margin: one non-empty level and no backstop,
      // so the merge is skipped and the cell's own list is returned as it is.
      if (heads.length === 1) return heads[0] as readonly number[];
      return merge(heads, cursors, scratch);
    },
  };
}

/**
 * Writes `index` into the finest level it does not flood.
 *
 * Returns false when it floods every level, which makes it the caller's
 * backstop's problem.
 */
function insert(
  levels: readonly Level[],
  box: CandidateBounds,
  index: number,
): boolean {
  for (const { pitch, cells } of levels) {
    const minCol = Math.floor(box.minX / pitch);
    const maxCol = Math.floor(box.maxX / pitch);
    const minRow = Math.floor(box.minY / pitch);
    const maxRow = Math.floor(box.maxY / pitch);
    if (
      (maxCol - minCol + 1) * (maxRow - minRow + 1) >
      MAX_CELLS_PER_CANDIDATE
    ) {
      continue;
    }
    for (let col = minCol; col <= maxCol; col++) {
      for (let row = minRow; row <= maxRow; row++) {
        const key = cellKey(col, row);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [index]);
        else list.push(index);
      }
    }
    return true;
  }
  return false;
}

/**
 * Ascending merge of already-ascending lists, into a reused buffer.
 *
 * A k-way merge by repeated minimum rather than a concatenate-and-sort: k is at
 * most four, so scanning the heads beats a comparison sort, and no candidate can
 * appear twice because each is inserted at exactly one level.
 */
function merge(
  lists: readonly (readonly number[])[],
  cursors: number[],
  out: number[],
): readonly number[] {
  cursors.length = lists.length;
  cursors.fill(0);
  out.length = 0;
  for (;;) {
    let best = -1;
    let bestValue = Infinity;
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i] as readonly number[];
      const at = cursors[i] as number;
      if (at >= list.length) continue;
      const value = list[at] as number;
      if (value < bestValue) {
        bestValue = value;
        best = i;
      }
    }
    if (best === -1) return out;
    out.push(bestValue);
    cursors[best] = (cursors[best] as number) + 1;
  }
}

const EMPTY: readonly number[] = [];

/**
 * Column/row packed into one integer.
 *
 * The offset keeps negative coordinates — ENU is centred on the frame origin, so
 * half the world is negative — out of the sign bit's way, and the stride is
 * comfortably wider than any grid these pitches produce over a rendered extent.
 * A template-literal key would add a string hash to a lookup that happens once
 * per marker per level.
 */
const CELL_OFFSET = 1 << 20;
const CELL_STRIDE = 1 << 21;
function cellKey(col: number, row: number): number {
  return (col + CELL_OFFSET) * CELL_STRIDE + (row + CELL_OFFSET);
}

/**
 * The finest pitch, from the candidates themselves rather than a constant.
 *
 * The MEAN box extent. A pitch near the typical footprint puts most candidates
 * in one cell — measured median 1, 99th percentile 18 — while the outliers that
 * would drag a mean upward are promoted to a coarser level rather than
 * distorting this one.
 *
 * The mean rather than the median because it needs no sort, and this runs over
 * every candidate on the mesh path.
 */
function pitchFor(bounds: readonly CandidateBounds[]): number {
  let total = 0;
  let counted = 0;
  for (const box of bounds) {
    if (box.minX > box.maxX || box.minY > box.maxY) continue;
    total += box.maxX - box.minX + (box.maxY - box.minY);
    counted += 1;
  }
  if (counted === 0) return MIN_PITCH_M;
  // `total` holds width + height per box, so this is the mean of both extents.
  return Math.max(MIN_PITCH_M, total / (2 * counted));
}
