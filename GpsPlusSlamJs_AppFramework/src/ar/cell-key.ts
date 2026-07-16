/**
 * The single packed-cell-key implementation shared by every module that keys
 * integer grid cells (2026-07-04 code-health pass, plan step 3).
 *
 * Packs three integer coordinates into ONE safe-integer Map/Set key — three
 * 17-bit fields (`(c + 2^16) · 2^34/2^17/2^0`), keeping the packed key under
 * 2^53 — avoiding the per-lookup string allocation that dominated the grid /
 * mesher hot loops.
 *
 * Before this module the SAME algebra was hand-rolled three times
 * (`occupancy-grid.ts`, `occupancy-mesher.ts`, `occlusion-mesh-worker.ts`)
 * with two different envelopes, and the review-log's envelope-mismatch and
 * key-aliasing findings lived exactly in the gaps between the copies. The two
 * envelopes are now two documented constants over one packer:
 *
 * - {@link CELL_KEY_LIMIT} (±65 535) — the full field width. Keys of DIRECT
 *   cell coordinates (the occupancy grid) are collision-free within it
 *   (≈ ±9.8 km at the 0.15 m default cell size).
 * - {@link HALF_LATTICE_CELL_KEY_LIMIT} (±32 767) — the mesher tier. The
 *   corner-fit mesher also keys HALF-LATTICE corners (`2·coord ± 1`) and
 *   neighbour cells (`±1`), which must stay inside the same field, so cells
 *   fed to `meshOccupiedCells` need the 2× headroom (≈ ±4.9 km).
 *
 * Beyond an envelope the base-2^17 encoding ALIASES (e.g.
 * `packCellKey(0, 65537, z) === packCellKey(1, −65535, z)`) — callers must
 * range-check with {@link cellCoordsInKeyRange} before keying untrusted
 * coordinates, or an out-of-envelope cell reads/writes an unrelated record.
 *
 * @see cell-key.ts.md for detailed documentation
 */

import type { GridCell } from './bresenham3d';

/** Full-field envelope: direct cell keys are collision-free for `|c| ≤` this. */
export const CELL_KEY_LIMIT = 65535;

/**
 * Mesher-tier envelope: leaves headroom for the derived half-lattice
 * (`2·coord ± 1`) and neighbour (`±1`) keys the meshers build from a cell.
 */
export const HALF_LATTICE_CELL_KEY_LIMIT = 32767;

const KEY_OFFSET = 65536; // 2^16 — shift a packable coordinate to non-negative
const KEY_FIELD = 131072; // 2^17 — width of one packed field
const KEY_FIELD_SQ = KEY_FIELD * KEY_FIELD; // 2^34

/**
 * Pack three integer coordinates into the numeric key. Collision-free only
 * within the caller's envelope (see the module header); scalar form so hot
 * loops need no tuple.
 */
export function packCellKey(x: number, y: number, z: number): number {
  return (
    (x + KEY_OFFSET) * KEY_FIELD_SQ +
    (y + KEY_OFFSET) * KEY_FIELD +
    (z + KEY_OFFSET)
  );
}

/** Tuple convenience over {@link packCellKey}. */
export function cellKey(cell: GridCell): number {
  return packCellKey(cell[0], cell[1], cell[2]);
}

/** One axis of {@link unpackCellKey} without allocating the tuple (hot paths). */
export function unpackCellCoord(key: number, axis: 0 | 1 | 2): number {
  if (axis === 0) {
    return Math.floor(key / KEY_FIELD_SQ) - KEY_OFFSET;
  }
  if (axis === 1) {
    return (Math.floor(key / KEY_FIELD) % KEY_FIELD) - KEY_OFFSET;
  }
  return (key % KEY_FIELD) - KEY_OFFSET;
}

/**
 * Exact inverse of {@link cellKey} over the ±{@link CELL_KEY_LIMIT} envelope
 * (property-tested). Consumers that no longer store coordinate tuples recover
 * them from the key through this function.
 */
export function unpackCellKey(key: number): GridCell {
  return [
    unpackCellCoord(key, 0),
    unpackCellCoord(key, 1),
    unpackCellCoord(key, 2),
  ];
}

/**
 * Per-axis key strides: stepping one cell along an axis moves the packed key
 * by a constant (positional base-2^17 packing) — `packCellKey(x+1, y, z) ===
 * packCellKey(x, y, z) + CELL_KEY_STRIDE_X`, and the z stride is 1. Hot walks
 * (the occupancy grid's fused carve, the smooth mesher's dual-cell corners)
 * maintain keys incrementally with these instead of repacking per cell.
 * DERIVED from the packer itself so they can never drift from the encoding.
 */
export const CELL_KEY_STRIDE_X = packCellKey(1, 0, 0) - packCellKey(0, 0, 0);
/** See {@link CELL_KEY_STRIDE_X}. */
export const CELL_KEY_STRIDE_Y = packCellKey(0, 1, 0) - packCellKey(0, 0, 0);

/**
 * True iff every coordinate is within ±`limit` — the aliasing guard callers
 * must apply before keying untrusted coordinates. Defaults to the full-field
 * {@link CELL_KEY_LIMIT}; the meshers pass {@link HALF_LATTICE_CELL_KEY_LIMIT}.
 */
export function cellCoordsInKeyRange(
  cell: GridCell,
  limit: number = CELL_KEY_LIMIT
): boolean {
  return (
    Math.abs(cell[0]) <= limit &&
    Math.abs(cell[1]) <= limit &&
    Math.abs(cell[2]) <= limit
  );
}
