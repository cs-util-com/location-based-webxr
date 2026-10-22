/**
 * The cloud map's date-line seam (round-3 plan 2026-10-08-2345 §16, §18):
 * NASA's `cloud_combined_8192.tif` does not wrap, its left and right edge
 * columns were never made to match, so the globe drew a line down the date
 * line. The fetch script eases both edges to their per-row average before
 * it cuts the map into pieces, and the committed pieces are judged by the
 * same measure the script logs.
 *
 * @see cloud-seam.ts.md
 */

/** The weight of the edge's offset `k` columns in from it: 1 at the edge. */
const ease = (k: number, columns: number): number =>
  0.5 * (1 + Math.cos((Math.PI * k) / columns));

/** A grey level, rounded and clamped (a Uint8Array would wrap, not clamp). */
const toByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

function checkMap(grey: Uint8Array, width: number, height: number): void {
  if (!(Number.isInteger(width) && width > 1)) {
    throw new RangeError(`width must be an integer above 1, got ${width}`);
  }
  if (!(Number.isInteger(height) && height > 0)) {
    throw new RangeError(`height must be a positive integer, got ${height}`);
  }
  if (grey.length !== width * height) {
    throw new RangeError(
      `a ${width} x ${height} map has ${width * height} values, got ${grey.length}`,
    );
  }
}

/**
 * A copy of the one-channel map `grey` (row-major, `width` x `height`)
 * whose wrap is continuous: in each row, both edge columns become their
 * average, and the `columns` next to each edge move by the same offset,
 * eased (a half cosine) to nothing at `columns` in. Outside the two bands
 * nothing changes; inside, a row keeps its own detail, shifted.
 *
 * @throws RangeError when the sizes do not match `grey`, or `columns` is
 *   not an integer from 1 to half the width.
 */
export function blendWrapSeam(
  grey: Uint8Array,
  width: number,
  height: number,
  columns: number,
): Uint8Array {
  checkMap(grey, width, height);
  if (!(Number.isInteger(columns) && columns >= 1 && 2 * columns <= width)) {
    throw new RangeError(
      `the band must be 1 to ${width / 2} whole columns, got ${columns}`,
    );
  }
  const out = Uint8Array.from(grey);
  const weights = Array.from({ length: columns }, (_, k) => ease(k, columns));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const west = grey[row]!;
    const east = grey[row + width - 1]!;
    const middle = (west + east) / 2;
    for (let k = 0; k < columns; k++) {
      const w = weights[k]!;
      const i = row + k;
      const j = row + width - 1 - k;
      out[i] = toByte(grey[i]! + w * (middle - west));
      out[j] = toByte(grey[j]! + w * (middle - east));
    }
  }
  return out;
}

/** How much one pair of neighbouring columns differs, over every row. */
export interface ColumnJump {
  /** The mean absolute difference, grey levels. */
  readonly mean: number;
  /** The largest absolute difference. */
  readonly max: number;
}

/**
 * Column `left` against the next one, the last column against the first
 * (the wrap). @throws RangeError for a column outside the map.
 */
export function columnJump(
  grey: Uint8Array,
  width: number,
  height: number,
  left: number,
): ColumnJump {
  checkMap(grey, width, height);
  if (!(Number.isInteger(left) && left >= 0 && left < width)) {
    throw new RangeError(`no column ${left} in a map ${width} wide`);
  }
  const right = (left + 1) % width;
  let sum = 0;
  let max = 0;
  for (let y = 0; y < height; y++) {
    const d = Math.abs(grey[y * width + left]! - grey[y * width + right]!);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / height, max };
}

/** The value at quantile `q` (0-1), interpolated between neighbours. */
const quantileOf = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low]! + (at - low) * (sorted[high]! - sorted[low]!);
};

/**
 * A typical neighbouring-column jump: over every pair at least `away`
 * columns from either edge, the `quantile` (the median by default) of the
 * pairs' mean jumps and of their largest jumps. The seam and its blended
 * bands are left out by `away`.
 *
 * @throws RangeError when no pair is that far from the edges, or the
 *   quantile is outside 0-1.
 */
export function typicalColumnJump(
  grey: Uint8Array,
  width: number,
  height: number,
  away: number,
  quantile = 0.5,
): ColumnJump {
  if (!(quantile >= 0 && quantile <= 1)) {
    throw new RangeError(`the quantile must be in [0, 1], got ${quantile}`);
  }
  const means: number[] = [];
  const maxes: number[] = [];
  for (let left = away; left < width - 1 - away; left++) {
    const jump = columnJump(grey, width, height, left);
    means.push(jump.mean);
    maxes.push(jump.max);
  }
  if (means.length === 0) {
    throw new RangeError(`no pair ${away} columns from the edges`);
  }
  return {
    mean: quantileOf(means, quantile),
    max: quantileOf(maxes, quantile),
  };
}
