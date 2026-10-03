/**
 * A ring of the last frame times with nearest-rank percentiles (moved from
 * OsmDemo's `ar-sun-shadow.ts` on 2026-10-03, DEC-H3; globe zoom
 * performance plan 2026-10-03-2017, PERF-0).
 *
 * For a LIVE readout only: it holds the last `capacity` frames, so it
 * cannot describe a whole run. A run's statistics come from
 * `frame-histogram.ts`, which counts every frame.
 *
 * @see frame-times.ts.md
 */

import { percentileOfSorted } from './percentile.js';

/** p50 / p95 / p99 / max of the frames in the ring, ms, and how many. */
export interface FrameTimesSummary {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly count: number;
}

/**
 * The last `capacity` frame times, ms, with nearest-rank percentiles: a
 * window mean (an fps readout) is blind to the one slow frame.
 *
 * `push` ignores a non-finite or negative value. `summary()` is `null`
 * before the first accepted value.
 *
 * @throws RangeError when `capacity` is not a positive integer.
 */
export function createFrameTimes(capacity = 300): {
  push(ms: number): void;
  summary(): FrameTimesSummary | null;
} {
  if (!(Number.isInteger(capacity) && capacity > 0)) {
    throw new RangeError(
      `capacity must be a positive integer, got ${String(capacity)}`
    );
  }
  const ring = new Float64Array(capacity);
  let count = 0;
  let next = 0;
  return {
    push(ms) {
      if (!(Number.isFinite(ms) && ms >= 0)) return;
      ring[next] = ms;
      next = (next + 1) % capacity;
      count = Math.min(count + 1, capacity);
    },
    summary() {
      if (count === 0) return null;
      const sorted = ring.slice(0, count).sort();
      return {
        p50: percentileOfSorted(sorted, 0.5),
        p95: percentileOfSorted(sorted, 0.95),
        p99: percentileOfSorted(sorted, 0.99),
        max: sorted[count - 1]!,
        count,
      };
    },
  };
}
