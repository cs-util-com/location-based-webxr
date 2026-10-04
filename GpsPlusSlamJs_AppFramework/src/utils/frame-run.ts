/**
 * One recorder run: a whole-run histogram, the hitch attribution join and
 * the worst frames, fed by one `endFrame` per frame; and the idle refresh
 * calibration (globe zoom performance plan 2026-10-03-2017, §4.1, PERF-0).
 *
 * @see frame-run.ts.md
 */

import {
  createHitchAttribution,
  type AttributionCounts,
} from './frame-attribution.js';
import {
  createFrameHistogram,
  type FrameHistogramOptions,
  type FrameHistogramSnapshot,
} from './frame-histogram.js';
import { interpolatingMedian } from './median.js';

/** How many slow frames a run keeps with their events (plan §4.1: the 20 worst). */
const DEFAULT_WORST_COUNT = 20;

/**
 * The idle calibration needs at least this many intervals (half a second
 * at 60 Hz; the plan's 2 s idle window gives 120 or more).
 */
export const REFRESH_CALIBRATION_MIN_SAMPLES = 30;

export interface FrameRunOptions extends FrameHistogramOptions {
  /** Lag windows for the attribution join; default 0 / 1 / 2 frames. */
  readonly lags?: readonly number[];
  /** Slow frames kept with their events. Default 20. */
  readonly worstCount?: number;
}

/** A slow frame: its index in the run (every `endFrame` call), its interval and its events. */
interface WorstFrame {
  readonly frame: number;
  readonly ms: number;
  readonly events: readonly string[];
}

export interface FrameRunSummary {
  readonly stats: FrameHistogramSnapshot;
  readonly attribution: AttributionCounts;
  /** Slowest first; ties keep the earlier frame first. */
  readonly worst: readonly WorstFrame[];
}

export interface FrameRun {
  /**
   * Ends one frame: its interval (from this frame's start to the next's),
   * ms, and the events that fell in it. A non-finite or negative interval
   * is refused by every part and still advances the frame index.
   */
  endFrame(intervalMs: number, events?: readonly string[]): void;
  summary(): FrameRunSummary;
}

/**
 * Creates one run. The histogram and the join share the same thresholds.
 *
 * @throws RangeError for a bad `worstCount` (not a non-negative integer)
 *   or any option its parts refuse.
 */
export function createFrameRun(options: FrameRunOptions = {}): FrameRun {
  const worstCount = options.worstCount ?? DEFAULT_WORST_COUNT;
  if (!(Number.isInteger(worstCount) && worstCount >= 0)) {
    throw new RangeError(
      `worstCount must be a non-negative integer, got ${String(worstCount)}`
    );
  }
  const histogram = createFrameHistogram(options);
  const attribution = createHitchAttribution({
    ...(options.thresholdsMs === undefined
      ? {}
      : { thresholdsMs: options.thresholdsMs }),
    ...(options.lags === undefined ? {} : { lags: options.lags }),
  });
  /** Slowest first, at most `worstCount`. */
  const worst: WorstFrame[] = [];
  let frame = 0;

  return {
    endFrame(intervalMs, events = []) {
      const index = frame++;
      const accepted = histogram.push(intervalMs);
      attribution.endFrame(intervalMs, events); // refuses the same intervals
      if (!accepted || worstCount === 0) return;
      const last = worst[worst.length - 1];
      if (
        worst.length === worstCount &&
        last !== undefined &&
        intervalMs <= last.ms
      ) {
        return;
      }
      let at = worst.length;
      while (at > 0 && worst[at - 1]!.ms < intervalMs) at--;
      worst.splice(at, 0, {
        frame: index,
        ms: intervalMs,
        events: [...events],
      });
      if (worst.length > worstCount) worst.pop();
    },
    summary() {
      return {
        stats: histogram.snapshot(),
        attribution: attribution.counts(),
        worst: worst.map((w) => ({ ...w, events: [...w.events] })),
      };
    },
  };
}

/**
 * The display's refresh interval from frame intervals taken while the page
 * is IDLE (the camera held, the tiles settled; plan §4.1, review Minor 10):
 * the median of the finite positive intervals, or `null` when fewer than
 * `minSamples` remain. Never calibrate inside the band, where the frame
 * rate is the thing being measured.
 *
 * @throws RangeError when `minSamples` is not a positive integer.
 */
export function calibrateRefreshInterval(
  intervalsMs: readonly number[],
  minSamples = REFRESH_CALIBRATION_MIN_SAMPLES
): number | null {
  if (!(Number.isInteger(minSamples) && minSamples > 0)) {
    throw new RangeError(
      `minSamples must be a positive integer, got ${String(minSamples)}`
    );
  }
  const usable = intervalsMs.filter((ms) => Number.isFinite(ms) && ms > 0);
  return usable.length < minSamples ? null : interpolatingMedian(usable);
}
