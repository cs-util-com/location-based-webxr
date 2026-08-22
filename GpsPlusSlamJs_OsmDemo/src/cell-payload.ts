/**
 * Packs the scored-cell array into typed arrays, so it can be TRANSFERRED
 * across the worker boundary instead of structured-cloned (round 10 §3).
 *
 * WHY THIS EXISTS. `refresh-payload.test.ts` measures the clone of the plain
 * object array at 3.2 ms for one ring and **35.1 ms for the 24 206 cells the
 * 488-chunk cache holds** — three times per move, against a 16 ms frame budget.
 *
 * ⚠️ **THOSE FIGURES WERE MEASURED AT A 488-CHUNK CAP, AND THE CAP IS NOW
 * 1 016** (DEC-K1 raised the scoring radius from 4 to 6, and the cap derives
 * from it). The measurement is kept as recorded rather than rescaled — a
 * doubled cell count is not necessarily a doubled clone cost — but it now
 * UNDERSTATES today's worst case, which is the direction that matters for an
 * argument about a frame budget.
 * The demo already moves mesh geometry zero-copy through typed arrays; the cell
 * array was the one large payload still being copied.
 *
 * NOTHING IS DROPPED. An earlier version of the plan proposed sending less —
 * no `contributors`, one category — which would have made the cell popup
 * asynchronous and moved provenance out of a click that has it today. Packing
 * keeps every field, so that trade never has to be made.
 *
 * THE ARRAYS MUST BE FRESHLY ALLOCATED, and that is not an implementation
 * detail: transferring **detaches** a buffer on the sender's side. Everything
 * here is built per call from the retained store rather than aliasing it, so
 * handing it over cannot leave the worker holding a zero-length array — the
 * failure `transferablesOf` in `demo-worker.ts` documents for the terrain field.
 *
 * @see cell-payload.ts.md
 */

import type { CellScore } from "gps-plus-slam-osm";

/**
 * The wire form: flat arrays plus the two small string tables needed to read
 * them.
 *
 * The tables stay plain arrays deliberately. They are per-payload dictionaries
 * of at most a few dozen short strings, so cloning them costs nothing measurable
 * — and encoding strings into a buffer to save that would be the kind of
 * optimisation that adds a decoder for no gain.
 */
export interface PackedCells {
  /** H3 index per cell, as the 64-bit integer it actually is. */
  readonly ids: BigUint64Array;
  /** Column order for `scores`. */
  readonly categories: readonly string[];
  /** `cells × categories`, row-major. Absent categories read as the identity. */
  readonly scores: Float32Array;
  /** Dictionary for `contributorKeys`. */
  readonly featureKeys: readonly string[];
  /**
   * Where each cell's contributor run starts, with a trailing total —
   * `cells + 1` entries, the usual compressed-row layout.
   *
   * The trailing entry is what lets cell `n`'s run be read as
   * `[offsets[n], offsets[n + 1])` without a special case for the last cell.
   */
  readonly contributorOffsets: Uint32Array;
  /** Category column index, per contributor entry. */
  readonly contributorCategories: Uint8Array;
  /** Index into `featureKeys`, per contributor entry. */
  readonly contributorKeys: Uint32Array;
  /** The factor that feature contributed, per contributor entry. */
  readonly contributorFactors: Float32Array;
}

/** Encodes an H3 index string as the 64-bit integer it is. */
const idToBits = (cell: string): bigint => BigInt(`0x${cell}`);

/**
 * The inverse, PADDED BACK TO WIDTH.
 *
 * `BigInt.prototype.toString(16)` drops leading zeros, and an id that comes back
 * one character short is a different cell — the map would colour a hexagon that
 * does not exist and nothing would throw.
 *
 * **The padding is unreachable for real H3 input, and that is worth stating
 * rather than leaving as a comfortable assumption.** A cell index sets mode bits
 * 59-56 to 1, so every valid index is `0x8…` and always renders as 15 hex
 * characters. Removing the `padStart` was mutation-tested against the whole
 * suite and changed nothing.
 *
 * It stays because it costs one call and makes the function correct as written
 * rather than correct-by-coincidence-of-its-caller. **Exported so it can be
 * tested directly**, since no round-trip through real H3 ids can reach it — a
 * guard that only ever runs on input that does not need it is untested by
 * definition unless it is called on input that does.
 */
export const decodeCellId = (bits: bigint, width = 15): string =>
  bits.toString(16).padStart(width, "0");

export function packCells(cells: readonly CellScore[]): PackedCells {
  const categories: string[] = [];
  const categoryIndex = new Map<string, number>();
  const featureKeys: string[] = [];
  const featureIndex = new Map<string, number>();

  // ONE PASS TO BUILD THE DICTIONARIES, because the score matrix cannot be
  // allocated until the column count is known, and the contributor arrays
  // cannot be sized until the total entry count is.
  let contributorCount = 0;
  for (const entry of cells) {
    for (const category of Object.keys(entry.scores)) {
      if (!categoryIndex.has(category)) {
        categoryIndex.set(category, categories.length);
        categories.push(category);
      }
    }
    for (const [category, byFeature] of Object.entries(entry.contributors)) {
      if (!categoryIndex.has(category)) {
        categoryIndex.set(category, categories.length);
        categories.push(category);
      }
      for (const key of Object.keys(byFeature)) {
        if (!featureIndex.has(key)) {
          featureIndex.set(key, featureKeys.length);
          featureKeys.push(key);
        }
        contributorCount += 1;
      }
    }
  }

  const ids = new BigUint64Array(cells.length);
  const scores = new Float32Array(cells.length * categories.length);
  const contributorOffsets = new Uint32Array(cells.length + 1);
  const contributorCategories = new Uint8Array(contributorCount);
  const contributorKeys = new Uint32Array(contributorCount);
  const contributorFactors = new Float32Array(contributorCount);

  let cursor = 0;
  for (let n = 0; n < cells.length; n += 1) {
    const entry = cells[n];
    if (entry === undefined) continue;
    ids[n] = idToBits(entry.cell);
    contributorOffsets[n] = cursor;

    for (const [category, score] of Object.entries(entry.scores)) {
      scores[n * categories.length + (categoryIndex.get(category) ?? 0)] =
        score;
    }
    for (const [category, byFeature] of Object.entries(entry.contributors)) {
      for (const [key, factor] of Object.entries(byFeature)) {
        contributorCategories[cursor] = categoryIndex.get(category) ?? 0;
        contributorKeys[cursor] = featureIndex.get(key) ?? 0;
        contributorFactors[cursor] = factor;
        cursor += 1;
      }
    }
  }
  contributorOffsets[cells.length] = cursor;

  return {
    ids,
    categories,
    scores,
    featureKeys,
    contributorOffsets,
    contributorCategories,
    contributorKeys,
    contributorFactors,
  };
}

export function unpackCells(packed: PackedCells, idWidth = 15): CellScore[] {
  const cells: CellScore[] = [];
  const columns = packed.categories.length;

  for (let n = 0; n < packed.ids.length; n += 1) {
    const scores: Record<string, number> = {};
    for (let column = 0; column < columns; column += 1) {
      const score = packed.scores[n * columns + column];
      // ZERO MEANS ABSENT, not "scored zero". The matrix is dense and a cell
      // that has no entry for a category simply never wrote to its column; a
      // real score cannot be 0 because the table's factors are multiplicative
      // and the identity is 1.
      if (score === undefined || score === 0) continue;
      const category = packed.categories[column];
      if (category !== undefined) scores[category] = score;
    }

    const contributors: Record<string, Record<string, number>> = {};
    const from = packed.contributorOffsets[n] ?? 0;
    const to = packed.contributorOffsets[n + 1] ?? from;
    for (let entry = from; entry < to; entry += 1) {
      const category =
        packed.categories[packed.contributorCategories[entry] ?? 0];
      const key = packed.featureKeys[packed.contributorKeys[entry] ?? 0];
      const factor = packed.contributorFactors[entry];
      if (category === undefined || key === undefined || factor === undefined) {
        continue;
      }
      (contributors[category] ??= {})[key] = factor;
    }

    cells.push({
      cell: decodeCellId(packed.ids[n] ?? 0n, idWidth),
      scores,
      contributors,
    });
  }

  return cells;
}

/**
 * Every buffer in the payload, for `postMessage`'s transfer list.
 *
 * DERIVED FROM THE OBJECT rather than written out field by field, because a
 * buffer left out of the list is silently COPIED instead of moved — invisible
 * except as the cost this module exists to remove. A hand-maintained list would
 * go stale the first time a field is added.
 */
export function cellPayloadBuffers(packed: PackedCells): ArrayBuffer[] {
  return Object.values(packed)
    .filter((value): value is ArrayBufferView => ArrayBuffer.isView(value))
    .map((view) => view.buffer)
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
