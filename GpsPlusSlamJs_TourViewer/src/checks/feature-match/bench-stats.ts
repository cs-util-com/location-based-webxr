/**
 * Median and p90 of the feature matching benchmark's timings.
 *
 * @see bench-stats.ts.md
 */
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";
import { nearestRankPercentile } from "gps-plus-slam-app-framework/utils/percentile";

/** One sample's summary; every field but `n` is NaN for an empty sample. */
export interface Summary {
  readonly n: number;
  readonly median: number;
  readonly p90: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Summarizes timings or counts: the interpolating median and the
 * nearest-rank p90 (both from the framework's one implementation).
 *
 * @throws RangeError for a non-finite sample: a timing is never NaN, so
 *   one is a bug upstream and must not be averaged away.
 */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) {
    return { n: 0, median: NaN, p90: NaN, min: NaN, max: NaN };
  }
  for (const v of samples) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`sample must be finite, got ${String(v)}`);
    }
  }
  return {
    n: samples.length,
    median: interpolatingMedian(samples),
    p90: nearestRankPercentile(samples, 0.9),
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

/** Milliseconds for the table and the log: "-" for NaN. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  return ms < 100 ? ms.toFixed(1) : ms.toFixed(0);
}
