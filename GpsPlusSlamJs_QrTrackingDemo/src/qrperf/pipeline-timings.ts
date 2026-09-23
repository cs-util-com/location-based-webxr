/**
 * Rolling per-stage timings and event rates for the `?qrperf` instrument.
 * Pure: no clock of its own, callers pass timestamps. See pipeline-timings.ts.md.
 */

import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";

/** Summary of one stage's durations over the window, milliseconds. */
export interface StageSummary {
  n: number;
  median: number;
  p95: number;
  max: number;
}

export interface PipelineSnapshot {
  stages: Record<string, StageSummary>;
  /**
   * Weighted events per second over the rate window ending at `nowMs` (a
   * plain `count` weighs 1; a weighted one, e.g. ms of capture work, sums).
   */
  ratesPerSec: Record<string, number>;
  /** All-time event counts (weights summed) since creation or `reset`. */
  totals: Record<string, number>;
  /**
   * XR frame intervals (stage `xr-frame`) longer than 1.5x / 2x their own
   * median - relative, because a 30 fps and a 60 fps session differ by 2x.
   */
  longFrames: { over1_5x: number; over2x: number };
}

export interface PipelineTimings {
  record(stage: string, ms: number): void;
  count(event: string, atMs: number, weight?: number): void;
  snapshot(nowMs: number): PipelineSnapshot;
  reset(): void;
}

export interface PipelineTimingsOptions {
  /** Samples kept per stage. Default 120 (~15 s at 8 Hz). */
  windowSize?: number;
  /** Per-stage window overrides, e.g. a longer `xr-frame` series. */
  stageWindows?: Record<string, number>;
  /** Window for event rates, ms. Default 10 000. */
  rateWindowMs?: number;
}

/** Nearest-rank percentile of a sample (`p` in [0, 1]); NaN when empty. */
export function nearestRankPercentile(
  values: readonly number[],
  p: number,
): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

function summarize(xs: number[]): StageSummary {
  return {
    n: xs.length,
    median: interpolatingMedian(xs),
    p95: nearestRankPercentile(xs, 0.95),
    max: Math.max(...xs),
  };
}

function longFramesOf(frames: number[]): PipelineSnapshot["longFrames"] {
  if (frames.length === 0) return { over1_5x: 0, over2x: 0 };
  const median = interpolatingMedian(frames);
  return {
    over1_5x: frames.filter((ms) => ms > 1.5 * median).length,
    over2x: frames.filter((ms) => ms > 2 * median).length,
  };
}

export function createPipelineTimings(
  options: PipelineTimingsOptions = {},
): PipelineTimings {
  const windowSize = Math.max(1, Math.floor(options.windowSize ?? 120));
  const stageWindows = options.stageWindows ?? {};
  const rateWindowMs = options.rateWindowMs ?? 10_000;
  const stages = new Map<string, number[]>();
  const events = new Map<string, { at: number; weight: number }[]>();
  const totals = new Map<string, number>();

  return {
    record(stage, ms) {
      if (!Number.isFinite(ms) || ms < 0) return;
      const limit = Math.max(1, Math.floor(stageWindows[stage] ?? windowSize));
      const xs = stages.get(stage) ?? [];
      xs.push(ms);
      if (xs.length > limit) xs.splice(0, xs.length - limit);
      stages.set(stage, xs);
    },
    count(event, atMs, weight = 1) {
      if (!Number.isFinite(weight)) return;
      const es = events.get(event) ?? [];
      es.push({ at: atMs, weight });
      events.set(event, es);
      totals.set(event, (totals.get(event) ?? 0) + weight);
    },
    snapshot(nowMs) {
      const summary: Record<string, StageSummary> = {};
      for (const [stage, xs] of stages) summary[stage] = summarize(xs);
      const rates: Record<string, number> = {};
      const from = nowMs - rateWindowMs;
      for (const [event, es] of events) {
        // Drop what fell out of the window so the arrays stay bounded.
        const kept = es.filter((e) => e.at > from);
        events.set(event, kept);
        const sum = kept.reduce((acc, e) => acc + e.weight, 0);
        rates[event] = sum / (rateWindowMs / 1000);
      }
      return {
        stages: summary,
        ratesPerSec: rates,
        totals: Object.fromEntries(totals),
        longFrames: longFramesOf(stages.get("xr-frame") ?? []),
      };
    },
    reset() {
      stages.clear();
      events.clear();
      totals.clear();
    },
  };
}
