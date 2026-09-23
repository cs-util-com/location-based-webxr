/**
 * Why these tests matter: the rolling collector turns per-capture timings into
 * the numbers the owner reads off a phone screenshot (plan 2026-09-23 M2, §5).
 * A wrong percentile or a rate over the wrong window would decide the zxing
 * and PBO-readback questions on bad numbers, so the arithmetic is pinned here
 * and its invariants are property-tested in the sibling file.
 */

import { describe, expect, it } from "vitest";
import {
  createPipelineTimings,
  nearestRankPercentile,
} from "./pipeline-timings.js";

describe("nearestRankPercentile", () => {
  it("returns the nearest-rank value of a sorted copy", () => {
    const xs = [5, 1, 4, 2, 3];
    expect(nearestRankPercentile(xs, 0.5)).toBe(3);
    expect(nearestRankPercentile(xs, 0.95)).toBe(5);
    expect(nearestRankPercentile(xs, 0)).toBe(1);
    expect(xs).toEqual([5, 1, 4, 2, 3]); // input untouched
  });

  it("is NaN for an empty sample", () => {
    expect(nearestRankPercentile([], 0.5)).toBeNaN();
  });
});

describe("createPipelineTimings", () => {
  it("summarises each stage as n / median / p95 / max over the window", () => {
    const t = createPipelineTimings({ windowSize: 4 });
    for (const ms of [10, 20, 30, 40, 50]) t.record("detect", ms);
    const s = t.snapshot(0).stages.detect;
    // Window of 4 keeps 20..50.
    expect(s).toEqual({ n: 4, median: 35, p95: 50, max: 50 });
  });

  it("reports event rates per second over the rate window only", () => {
    const t = createPipelineTimings({ rateWindowMs: 1000 });
    for (const at of [0, 100, 200, 1500, 1600]) t.count("capture", at);
    // At 2000 ms only the events after 1000 ms count: 2 in 1 s.
    expect(t.snapshot(2000).ratesPerSec.capture).toBe(2);
    expect(t.snapshot(2000).ratesPerSec.hit ?? 0).toBe(0);
  });

  it("ignores non-finite or negative durations instead of poisoning the stats", () => {
    const t = createPipelineTimings();
    t.record("detect", Number.NaN);
    t.record("detect", -1);
    t.record("detect", 7);
    expect(t.snapshot(0).stages.detect).toEqual({
      n: 1,
      median: 7,
      p95: 7,
      max: 7,
    });
  });

  it("counts frame intervals longer than a multiple of the median interval", () => {
    const t = createPipelineTimings();
    for (const ms of [33, 33, 34, 33, 60, 80, 33]) t.record("xr-frame", ms);
    const snap = t.snapshot(0);
    // median 33 -> 1.5x = 49.5 (60, 80 exceed), 2x = 66 (80 exceeds)
    expect(snap.longFrames).toEqual({ over1_5x: 2, over2x: 1 });
  });

  it("sums weighted events into a per-second rate (e.g. capture cost in ms/s)", () => {
    const t = createPipelineTimings({ rateWindowMs: 1000 });
    t.count("capture-ms", 100, 4);
    t.count("capture-ms", 200, 6);
    expect(t.snapshot(500).ratesPerSec["capture-ms"]).toBe(10);
  });

  it("keeps all-time totals that the rolling windows forget", () => {
    const t = createPipelineTimings({ rateWindowMs: 1000 });
    t.count("hit", 0);
    t.count("hit", 100);
    t.count("hit", 5000);
    const snap = t.snapshot(6000);
    expect(snap.ratesPerSec.hit).toBe(0);
    expect(snap.totals.hit).toBe(3);
  });

  it("gives a stage its own window size when asked (long frame series)", () => {
    const t = createPipelineTimings({
      windowSize: 2,
      stageWindows: { "xr-frame": 5 },
    });
    for (const ms of [1, 2, 3, 4, 5]) {
      t.record("xr-frame", ms);
      t.record("detect", ms);
    }
    const snap = t.snapshot(0);
    expect(snap.stages["xr-frame"]!.n).toBe(5);
    expect(snap.stages.detect!.n).toBe(2);
  });

  it("clears everything on reset", () => {
    const t = createPipelineTimings();
    t.record("detect", 5);
    t.count("capture", 0);
    t.reset();
    const snap = t.snapshot(0);
    expect(snap.stages).toEqual({});
    expect(snap.ratesPerSec).toEqual({});
  });
});
