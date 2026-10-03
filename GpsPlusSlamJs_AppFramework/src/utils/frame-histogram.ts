/**
 * Whole-run frame-interval statistics: a fixed-bin histogram for the
 * percentiles and exact cumulative counters for the hitch thresholds
 * (globe zoom performance plan 2026-10-03-2017, §4.1, PERF-0).
 *
 * A recorder run is 10,000-26,000 frames (about 3 minutes at 60-144 Hz),
 * which the live 300-frame ring (`frame-times.ts`) cannot hold; this holds
 * any run in constant memory.
 *
 * @see frame-histogram.ts.md
 */

import { nearestRank } from './percentile.js';

/**
 * The hitch thresholds the plan reports every verdict at (§4.3): 33, 50 and
 * 100 ms. A parameter of {@link createFrameHistogram}; this is its default.
 */
export const FRAME_HITCH_THRESHOLDS_MS: readonly number[] = [33, 50, 100];

/** Bin width, ms (plan §4.1: 0.25 ms bins up to 1 s). */
const DEFAULT_BIN_MS = 0.25;
/** Where the bins end and the one overflow bin begins, ms. */
const DEFAULT_RANGE_MS = 1000;
/** A guard against an accidental huge allocation, not a design limit. */
const MAX_BINS = 1_000_000;

export interface FrameHistogramOptions {
  /** Bin width, ms. Default 0.25. */
  readonly binMs?: number;
  /** Upper end of the bins, ms; longer intervals share one overflow bin. Default 1000. */
  readonly rangeMs?: number;
  /** Thresholds counted exactly ("strictly over"), ms. Default {@link FRAME_HITCH_THRESHOLDS_MS}. */
  readonly thresholdsMs?: readonly number[];
  /**
   * The display's refresh interval, ms, calibrated while idle
   * (`calibrateRefreshInterval` in `frame-run.ts`). Enables the dropped-frame
   * estimate; `null` or absent leaves it `null`.
   */
  readonly refreshIntervalMs?: number | null;
}

/** One exact cumulative count: the intervals strictly over `thresholdMs`. */
export interface FrameOverCount {
  readonly thresholdMs: number;
  readonly count: number;
}

/** A run's statistics; every ms value is `null` before the first frame. */
export interface FrameHistogramSnapshot {
  /** Accepted intervals. */
  readonly count: number;
  /** Refused intervals (non-finite or negative): a bad clock shows here. */
  readonly rejected: number;
  readonly minMs: number | null;
  readonly maxMs: number | null;
  readonly meanMs: number | null;
  /** Nearest-rank percentiles from the bins: observed intervals, see the sidecar. */
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  /** Exact counts at the declared thresholds, ascending. */
  readonly over: readonly FrameOverCount[];
  /** Intervals at or beyond `rangeMs`. */
  readonly overflowCount: number;
  /** Refresh periods the run skipped, or `null` without a refresh interval. */
  readonly droppedFrames: number | null;
  readonly refreshIntervalMs: number | null;
}

export interface FrameHistogram {
  /** Adds one frame interval, ms. `false` (and counted as rejected) for a non-finite or negative one. */
  push(ms: number): boolean;
  /** The nearest-rank percentile from the bins; `NaN` before the first frame. */
  percentile(p: number): number;
  /** The exact count strictly over a DECLARED threshold; `RangeError` for any other. */
  countOver(thresholdMs: number): number;
  snapshot(): FrameHistogramSnapshot;
}

function positiveFinite(name: string, value: number): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(
      `${name} must be finite and positive, got ${String(value)}`
    );
  }
  return value;
}

/** The thresholds deduplicated and ascending; `RangeError` for a non-finite or negative one. */
function parseThresholds(
  thresholdsMs: readonly number[] | undefined
): number[] {
  const thresholds = [...new Set(thresholdsMs ?? FRAME_HITCH_THRESHOLDS_MS)];
  for (const t of thresholds) {
    if (!(Number.isFinite(t) && t >= 0)) {
      throw new RangeError(
        `thresholdsMs must be finite and non-negative, got ${String(t)}`
      );
    }
  }
  return thresholds.sort((a, b) => a - b);
}

/** The options, validated, with their defaults applied. */
function parseOptions(options: FrameHistogramOptions) {
  const binMs = positiveFinite('binMs', options.binMs ?? DEFAULT_BIN_MS);
  const rangeMs = positiveFinite(
    'rangeMs',
    options.rangeMs ?? DEFAULT_RANGE_MS
  );
  if (rangeMs <= binMs) {
    throw new RangeError(
      `rangeMs (${rangeMs}) must be wider than one bin (${binMs})`
    );
  }
  const binCount = Math.ceil(rangeMs / binMs);
  if (binCount > MAX_BINS) {
    throw new RangeError(
      `${binCount} bins (rangeMs / binMs) exceed the limit of ${MAX_BINS}`
    );
  }
  const thresholds = parseThresholds(options.thresholdsMs);
  const refresh = options.refreshIntervalMs;
  const refreshIntervalMs =
    refresh === undefined || refresh === null
      ? null
      : positiveFinite('refreshIntervalMs', refresh);
  return { binMs, rangeMs, binCount, thresholds, refreshIntervalMs };
}

/**
 * Creates a whole-run histogram. Each bin keeps its own largest interval,
 * so a percentile is an interval that happened: never below the exact
 * nearest-rank value and less than one bin above it.
 *
 * @throws RangeError for a non-positive or non-finite bin width, range or
 *   refresh interval, a range not wider than one bin, more than a million
 *   bins, or a non-finite or negative threshold.
 */
export function createFrameHistogram(
  options: FrameHistogramOptions = {}
): FrameHistogram {
  const { binMs, rangeMs, binCount, thresholds, refreshIntervalMs } =
    parseOptions(options);

  const counts = new Uint32Array(binCount + 1); // the last one is the overflow bin
  const binMax = new Float64Array(binCount + 1);
  const over = new Array<number>(thresholds.length).fill(0);
  let count = 0;
  let rejected = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let dropped = 0;

  const percentile = (p: number): number => {
    if (count === 0) return Number.NaN;
    const rank = nearestRank(count, p);
    let cumulative = 0;
    for (let b = 0; b < counts.length; b++) {
      cumulative += counts[b]!;
      if (cumulative >= rank) return binMax[b]!;
    }
    return max; // unreachable: the counts sum to `count`
  };

  return {
    push(ms) {
      if (!(Number.isFinite(ms) && ms >= 0)) {
        rejected++;
        return false;
      }
      const b =
        ms >= rangeMs
          ? binCount
          : Math.min(binCount - 1, Math.floor(ms / binMs));
      counts[b]!++;
      if (ms > binMax[b]!) binMax[b] = ms;
      count++;
      sum += ms;
      if (ms < min) min = ms;
      if (ms > max) max = ms;
      for (let i = 0; i < thresholds.length; i++) {
        if (ms > thresholds[i]!) over[i]!++;
      }
      if (refreshIntervalMs !== null) {
        dropped += Math.max(0, Math.round(ms / refreshIntervalMs) - 1);
      }
      return true;
    },
    percentile,
    countOver(thresholdMs) {
      const i = thresholds.indexOf(thresholdMs);
      if (i < 0) {
        throw new RangeError(
          `${String(thresholdMs)} ms is not a counted threshold (${thresholds.join(', ')})`
        );
      }
      return over[i]!;
    },
    snapshot() {
      const empty = count === 0;
      return {
        count,
        rejected,
        minMs: empty ? null : min,
        maxMs: empty ? null : max,
        meanMs: empty ? null : sum / count,
        p50Ms: empty ? null : percentile(0.5),
        p95Ms: empty ? null : percentile(0.95),
        p99Ms: empty ? null : percentile(0.99),
        over: thresholds.map((thresholdMs, i) => ({
          thresholdMs,
          count: over[i]!,
        })),
        overflowCount: counts[binCount]!,
        droppedFrames: refreshIntervalMs === null ? null : dropped,
        refreshIntervalMs,
      };
    },
  };
}
