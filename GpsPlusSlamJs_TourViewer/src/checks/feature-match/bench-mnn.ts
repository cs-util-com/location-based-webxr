/**
 * Mutual nearest neighbour matching for the feature matching benchmark.
 *
 * @see bench-mnn.ts.md
 */

function checkSizes(
  lenA: number,
  nA: number,
  lenB: number,
  nB: number,
  dim: number,
): void {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new RangeError(
      `descriptor size must be a positive integer, got ${String(dim)}`,
    );
  }
  if (lenA < nA * dim || lenB < nB * dim) {
    throw new RangeError(
      `descriptor buffers too short: ${String(lenA)}/${String(nA * dim)}, ${String(lenB)}/${String(nB * dim)}`,
    );
  }
}

/** Index of each row's best column, by a score where larger is better. */
function bestPerRow(
  nA: number,
  nB: number,
  score: (ia: number, ib: number) => number,
): { bestB: Int32Array; bestA: Int32Array; bestScoreB: Float64Array } {
  const bestB = new Int32Array(nA).fill(-1);
  const bestScoreA = new Float64Array(nA).fill(-Infinity);
  const bestA = new Int32Array(nB).fill(-1);
  const bestScoreB = new Float64Array(nB).fill(-Infinity);
  for (let ia = 0; ia < nA; ia++) {
    for (let ib = 0; ib < nB; ib++) {
      const v = score(ia, ib);
      if (v > bestScoreA[ia]!) {
        bestScoreA[ia] = v;
        bestB[ia] = ib;
      }
      if (v > bestScoreB[ib]!) {
        bestScoreB[ib] = v;
        bestA[ib] = ia;
      }
    }
  }
  return { bestB, bestA, bestScoreB };
}

function mutualPairs(
  bestB: Int32Array,
  bestA: Int32Array,
  keep: (ib: number) => boolean,
): Int32Array {
  const out: number[] = [];
  for (let ia = 0; ia < bestB.length; ia++) {
    const ib = bestB[ia]!;
    if (ib >= 0 && bestA[ib] === ia && keep(ib)) {
      out.push(ia, ib);
    }
  }
  return Int32Array.from(out);
}

/**
 * Mutual nearest pairs of float descriptors by dot product (cosine for
 * L2-normalized rows), flat `[ia, ib, ...]` in A's order; pairs whose
 * similarity is below `minSimilarity` are dropped.
 *
 * @throws RangeError when a buffer is shorter than its count x `dim`.
 */
export function mutualNearestFloat(
  a: Float32Array,
  nA: number,
  b: Float32Array,
  nB: number,
  dim: number,
  minSimilarity = -Infinity,
): Int32Array {
  checkSizes(a.length, nA, b.length, nB, dim);
  const { bestB, bestA, bestScoreB } = bestPerRow(nA, nB, (ia, ib) => {
    let s = 0;
    const oa = ia * dim;
    const ob = ib * dim;
    for (let k = 0; k < dim; k++) {
      s += a[oa + k]! * b[ob + k]!;
    }
    return s;
  });
  return mutualPairs(bestB, bestA, (ib) => bestScoreB[ib]! >= minSimilarity);
}

/**
 * Mutual nearest pairs of byte descriptors by squared distance, flat
 * `[ia, ib, ...]` in A's order.
 *
 * @throws RangeError when a buffer is shorter than its count x `dim`.
 */
export function mutualNearestBytes(
  a: Uint8Array,
  nA: number,
  b: Uint8Array,
  nB: number,
  dim: number,
): Int32Array {
  checkSizes(a.length, nA, b.length, nB, dim);
  const { bestB, bestA } = bestPerRow(nA, nB, (ia, ib) => {
    let s = 0;
    const oa = ia * dim;
    const ob = ib * dim;
    for (let k = 0; k < dim; k++) {
      const d = a[oa + k]! - b[ob + k]!;
      s += d * d;
    }
    return -s;
  });
  return mutualPairs(bestB, bestA, () => true);
}
