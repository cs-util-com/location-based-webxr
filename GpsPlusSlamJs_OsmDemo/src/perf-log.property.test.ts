import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildPerfReport,
  createPerfRecorder,
  createRing,
  percentile,
  pickQueryKnobs,
  reportJson,
  summarizeFrames,
} from "./perf-log.js";

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

  // THE PRIVACY PROMISE for any link, not only the examples: whatever the
  // query carries, only the three knob names leave the page.
  it("the picked knobs never carry another key", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.string(), { maxKeys: 8 }),
        (params) => {
          const search = `?${new URLSearchParams(params).toString()}`;
          expect(Object.keys(pickQueryKnobs(search)).sort()).toEqual([
            "perf",
            "treeform",
            "woodsauto",
          ]);
        },
      ),
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
