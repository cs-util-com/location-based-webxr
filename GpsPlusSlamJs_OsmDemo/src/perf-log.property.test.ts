import fc from "fast-check";
import { createWoodsGovernor, WOODS_GOVERNOR } from "gps-plus-slam-osm/three";
import { describe, expect, it } from "vitest";

import {
  buildPerfReport,
  createPerfRecorder,
  createRing,
  percentile,
  pickQueryKnobs,
  reportJson,
  summarizeFrames,
  type PerfRecorder,
  type PerfReportInput,
} from "./perf-log.js";
import { createWoodsMeter } from "./woods-readout.js";

/**
 * Properties of the `?perf=1` log: the bounds that keep a long session's
 * report pasteable, the order of the percentiles a reader compares, the
 * privacy promise for any link, and that the JSON block always parses.
 */

const frames = fc.array(
  fc.tuple(
    fc.oneof(
      fc.double({ min: 0, max: 1e7, noNaN: true }),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
    ),
    fc.boolean(),
  ),
  { maxLength: 400 },
);

/** Runs of frames: an opening frame after `gap`, then `count` chained ones. */
interface Segment {
  readonly gap: number;
  readonly chained: boolean;
  readonly count: number;
  readonly ms: number;
}

const segments: fc.Arbitrary<Segment[]> = fc.array(
  fc.record({
    // An idle pause of 400 s outlasts the governor's rests.
    gap: fc.oneof(fc.integer({ min: 0, max: 300 }), fc.constant(400_000)),
    chained: fc.boolean(),
    count: fc.integer({ min: 0, max: 60 }),
    // Fast, slow, past the gap, and not after the last frame.
    ms: fc.oneof(
      fc.integer({ min: 5, max: 40 }),
      fc.integer({ min: 40, max: 400 }),
      fc.integer({ min: -3, max: 0 }),
    ),
  }),
  { maxLength: 25 },
);

/** Slow until a step down, a long idle pause, then fast long enough to step up. */
const DOWN_AND_UP: Segment[] = [
  { gap: 0, chained: false, count: 25, ms: 100 },
  { gap: 400_000, chained: false, count: 0, ms: 16 },
  ...Array.from({ length: 15 }, () => ({
    gap: 16,
    chained: true,
    count: 60,
    ms: 16,
  })),
];

interface ReplayJson {
  readonly summary: { readonly replayable: boolean };
  readonly settings: { readonly governorOn: boolean };
  readonly timeline: {
    readonly intervals: readonly (readonly [number, number])[];
    readonly bursts: readonly { readonly atMs: number }[];
    readonly shareChanges: readonly unknown[];
  };
}

const tenth = (value: number | undefined): number | null =>
  value === undefined ? null : Math.round(value * 10) / 10;

/** The share changes a fresh governor makes on the report's frames. */
function replay(json: ReplayJson): unknown[] {
  const frames = [
    ...json.timeline.bursts.map((burst) => [burst.atMs, false] as const),
    ...json.timeline.intervals.map(([atMs]) => [atMs, true] as const),
  ].sort((a, b) => a[0] - b[0]);
  const governor = createWoodsGovernor({ auto: json.settings.governorOn });
  let share = governor.state().share;
  const changes: unknown[] = [];
  for (const [atMs, chained] of frames) {
    governor.frame(atMs, chained);
    const state = governor.state();
    if (state.share === share) continue;
    changes.push({
      atMs,
      from: share,
      to: state.share,
      mode: state.mode,
      averageMs: tenth(state.averageMs),
    });
    share = state.share;
  }
  return changes;
}

function replayInput(
  auto: boolean,
  recorder: PerfRecorder,
  settings: Partial<PerfReportInput["settings"]> = {},
): PerfReportInput {
  return {
    nowMs: 1,
    device: {
      userAgent: "UA",
      devicePixelRatio: 1,
      screenCss: null,
      screenDevice: null,
      canvasCss: null,
      canvasDevice: null,
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      gpuRenderer: null,
      gpuVendor: null,
      pointer: "unknown",
    },
    settings: {
      query: { woodsauto: null, treeform: null, perf: "1" },
      governorOn: auto,
      governor: WOODS_GOVERNOR,
      ...settings,
    },
    timeline: recorder.snapshot(),
    now: {
      share: 1,
      mode: "off",
      averageMs: undefined,
      readout: "",
      drawCost: undefined,
      inventedTrees: 0,
    },
  };
}

describe("perf log properties", () => {
  // A ring that grew past its bound would make a long phone session's report
  // too large to paste, which is the failure this whole buffer exists to avoid.
  it("a ring never holds more than its capacity, and counts every push", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.integer(), { maxLength: 200 }),
        (capacity, values) => {
          const ring = createRing<number>(capacity);
          for (const value of values) ring.push(value);
          expect(ring.items().length).toBeLessThanOrEqual(capacity);
          expect(ring.items().length + ring.dropped()).toBe(values.length);
          expect(ring.items()).toEqual(values.slice(-capacity));
        },
      ),
    );
  });

  it("the recorder's intervals stay bounded, positive and finite", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), frames, (cap, seq) => {
        const recorder = createPerfRecorder({
          intervals: cap,
          bursts: cap,
          shareChanges: cap,
        });
        for (const [atMs, chained] of seq) recorder.frame(atMs, chained);
        const timeline = recorder.snapshot();
        expect(timeline.intervals.length).toBeLessThanOrEqual(cap);
        expect(timeline.bursts.length).toBeLessThanOrEqual(cap);
        expect(timeline.intervals.length + timeline.droppedIntervals).toBe(
          timeline.intervalCount,
        );
        for (const [atMs, ms] of timeline.intervals) {
          expect(Number.isFinite(atMs)).toBe(true);
          expect(ms).toBeGreaterThan(0);
        }
      }),
    );
  });

  // A reader compares p50, p95 and p99; out of order they would say nothing.
  it("the percentiles are monotone and inside the range", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.001, max: 1e4, noNaN: true }), {
          minLength: 1,
          maxLength: 300,
        }),
        (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          const p50 = percentile(sorted, 0.5) ?? Number.NaN;
          const p95 = percentile(sorted, 0.95) ?? Number.NaN;
          const p99 = percentile(sorted, 0.99) ?? Number.NaN;
          expect(sorted[0]).toBeLessThanOrEqual(p50);
          expect(p50).toBeLessThanOrEqual(p95);
          expect(p95).toBeLessThanOrEqual(p99);
          expect(p99).toBeLessThanOrEqual(sorted.at(-1) ?? Number.NaN);
        },
      ),
    );
  });

  it("the summary's percentiles are monotone for any frame sequence", () => {
    fc.assert(
      fc.property(frames, (seq) => {
        const recorder = createPerfRecorder();
        for (const [atMs, chained] of seq) recorder.frame(atMs, chained);
        const summary = summarizeFrames(recorder.snapshot());
        const { retained, p50Ms, p95Ms, p99Ms } = summary;
        // Unmeasured exactly while nothing is kept, and ordered otherwise.
        expect(p50Ms === undefined).toBe(retained === 0);
        expect((p50Ms ?? 0) <= (p95Ms ?? 0)).toBe(true);
        expect((p95Ms ?? 0) <= (p99Ms ?? 0)).toBe(true);
      }),
    );
  });

  // THE PRIVACY PROMISE, end to end: a value the link carries under any
  // other key (the place, the camera) never reaches the built report.
  it("a value under any other query key never reaches the report", () => {
    const sentinel = "Z7Q-sentinel-place";
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string(), { maxKeys: 8 }),
        (params) => {
          const query = new URLSearchParams(params);
          query.append("where", sentinel);
          const report = buildPerfReport(
            replayInput(false, createPerfRecorder(), {
              query: pickQueryKnobs(`?${query.toString()}`),
            }),
          );
          expect(report).not.toContain(sentinel);
        },
      ),
    );
  });

  // WHY THIS TEST MATTERS. The log exists so the governor can be judged
  // from a phone without the phone: replaying its frames through a fresh
  // governor (with the logged auto setting) must give exactly the logged
  // share changes, mode and average included. A report that dropped,
  // reordered or mislabelled any of those fields would replay differently.
  // Times are whole milliseconds so the report's tenth-of-a-millisecond
  // rounding is exact.
  it("replaying the report through the governor gives its share changes", () => {
    fc.assert(
      fc.property(fc.boolean(), segments, (auto, segs) => {
        const recorder = createPerfRecorder();
        const meter = createWoodsMeter(auto, recorder);
        let t = 0;
        for (const seg of segs) {
          t += seg.gap;
          meter.frame(t, seg.chained);
          for (let i = 0; i < seg.count; i++) {
            t += seg.ms;
            meter.frame(t, true);
          }
        }
        const json = reportJson(
          buildPerfReport(replayInput(auto, recorder)),
        ) as ReplayJson;
        expect(json.summary.replayable).toBe(true);
        expect(replay(json)).toEqual(json.timeline.shareChanges);
      }),
      { examples: [[true, DOWN_AND_UP]] },
    );
  });

  it("the report's JSON block always parses", () => {
    fc.assert(
      fc.property(
        frames,
        fc.string(),
        fc.option(fc.double(), { nil: undefined }),
        (seq, text, averageMs) => {
          const recorder = createPerfRecorder();
          for (const [atMs, chained] of seq) recorder.frame(atMs, chained);
          const report = buildPerfReport({
            nowMs: 1,
            device: {
              userAgent: text,
              devicePixelRatio: 1,
              screenCss: null,
              screenDevice: null,
              canvasCss: null,
              canvasDevice: null,
              hardwareConcurrency: null,
              deviceMemoryGb: null,
              gpuRenderer: text,
              gpuVendor: null,
              pointer: "unknown",
            },
            settings: {
              query: { woodsauto: text, treeform: null, perf: "1" },
              governorOn: false,
              governor: {},
            },
            timeline: recorder.snapshot(),
            now: {
              share: 1,
              mode: "off",
              averageMs,
              readout: text,
              drawCost: undefined,
              inventedTrees: 0,
            },
          });
          expect(() => reportJson(report)).not.toThrow();
        },
      ),
    );
  });
});
