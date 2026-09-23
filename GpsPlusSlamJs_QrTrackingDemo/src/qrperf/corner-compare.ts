/**
 * Native-vs-zxing corner comparison for the `?qrperf=zxing` corner-order
 * check (plan 2026-09-23 §5 step 3). Pure. See corner-compare.ts.md.
 */

export interface Point {
  x: number;
  y: number;
}

function nearestIndex(p: Point, candidates: readonly Point[]): number {
  let best = 0;
  let bestD = Infinity;
  candidates.forEach((c, i) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * For each native corner, the index of the nearest zxing corner, as a string
 * ("0123" = both report the same order).
 */
export function cornerPermutation(
  native: readonly Point[],
  zxing: readonly Point[],
): string {
  return native.map((p) => nearestIndex(p, zxing)).join("");
}

/** Largest distance from a native corner to its nearest zxing corner, px. */
export function maxCornerDistance(
  native: readonly Point[],
  zxing: readonly Point[],
): number {
  let max = 0;
  for (const p of native) {
    const q = zxing[nearestIndex(p, zxing)]!;
    max = Math.max(max, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return max;
}

/** An in-image rotation in degrees, rounded to 0 / 90 / 180 / 270. */
export function rollBin(rotationDeg: number): 0 | 90 | 180 | 270 {
  const wrapped = ((rotationDeg % 360) + 360) % 360;
  return ((Math.round(wrapped / 90) * 90) % 360) as 0 | 90 | 180 | 270;
}

export interface RollBinTally {
  identity: number;
  other: number;
  /** Distinct permutations seen in this bin, sorted. */
  permutations: string[];
}

export interface CornerOrderTally {
  add(bin: number, permutation: string): void;
  summary(): Record<number, RollBinTally>;
  reset(): void;
}

export function createCornerOrderTally(): CornerOrderTally {
  const bins = new Map<
    number,
    { identity: number; other: number; seen: Set<string> }
  >();
  return {
    add(bin, permutation) {
      const entry = bins.get(bin) ?? { identity: 0, other: 0, seen: new Set() };
      if (permutation === "0123") entry.identity += 1;
      else entry.other += 1;
      entry.seen.add(permutation);
      bins.set(bin, entry);
    },
    summary() {
      const out: Record<number, RollBinTally> = {};
      for (const [bin, e] of [...bins].sort((a, b) => a[0] - b[0])) {
        out[bin] = {
          identity: e.identity,
          other: e.other,
          permutations: [...e.seen].sort(),
        };
      }
      return out;
    },
    reset() {
      bins.clear();
    },
  };
}
