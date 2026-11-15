import { describe, expect, it } from "vitest";

import {
  buildPerfReport,
  createPerfRecorder,
  createRing,
  percentile,
  pickQueryKnobs,
  reportJson,
  summarizeFrames,
  type PerfReportInput,
} from "./perf-log.js";

/**
 * The `?perf=1` "Copy perf log" report: what a phone tester pastes into a
 * chat so someone else can judge the woods governor without screenshots.
 * These pin the recorder's bounds and rules (only chained intervals are
 * frame times), the summary's numbers, and the report's privacy promise:
 * nothing of the URL but the three knobs.
 */

const DEVICE = {
  userAgent: "TestPhone/1.0",
  devicePixelRatio: 2,
  screenCss: { width: 400, height: 800 },
  screenDevice: { width: 800, height: 1600 },
  canvasCss: { width: 400, height: 600 },
  canvasDevice: { width: 800, height: 1200 },
  hardwareConcurrency: 8,
  deviceMemoryGb: 4,
  gpuRenderer: "Test GPU",
  gpuVendor: "Test Vendor",
  pointer: "coarse",
} as const;

function input(overrides: Partial<PerfReportInput> = {}): PerfReportInput {
  const recorder = createPerfRecorder();
  recorder.frame(0, false);
  recorder.frame(16, true);
  recorder.frame(48, true);
  return {
    nowMs: 1000,
    device: DEVICE,
    settings: {
      query: { woodsauto: null, treeform: "trunk", perf: "1" },
      governorOn: true,
      governor: { slowMs: 50, shares: [1, 0.5, 0.25] },
    },
    timeline: recorder.snapshot(),
    now: {
      share: 0.5,
      mode: "thinned",
      averageMs: 41.25,
      readout: "frame 41.3 ms · p95 60.0 ms",
      drawCost: { calls: 12, triangles: 3456 },
      inventedTrees: 789,
    },
    ...overrides,
  };
}

describe("createRing", () => {
  // The ring is what keeps a long session's log pasteable: the newest N
  // survive, and the report says how many older ones were dropped.
  it("keeps the newest items, oldest first, and counts the dropped ones", () => {
    const ring = createRing<number>(3);
    for (let i = 1; i <= 5; i++) ring.push(i);
    expect(ring.items()).toEqual([3, 4, 5]);
    expect(ring.dropped()).toBe(2);
  });

  it("refuses a capacity that could not hold one item", () => {
    expect(() => createRing(0)).toThrow(RangeError);
    expect(() => createRing(Number.NaN)).toThrow(RangeError);
  });
});

describe("createPerfRecorder", () => {
  // The same rule as the governor's: only a CHAINED frame's interval is a
  // frame time; an unchained frame starts a burst after an idle pause, and
  // an idle pause must never read as a slow frame.
  it("records chained intervals and unchained burst starts", () => {
    const recorder = createPerfRecorder();
    recorder.frame(100, false);
    recorder.frame(116, true);
    recorder.frame(5000, false);
    recorder.frame(5033, true);
    const timeline = recorder.snapshot();
    expect(timeline.intervals).toEqual([
      [116, 16],
      [5033, 33],
    ]);
    expect(timeline.bursts.map((b) => b.atMs)).toEqual([100, 5000]);
    expect(timeline.intervalCount).toBe(2);
  });

  it("ignores non-finite times and intervals that are not positive", () => {
    const recorder = createPerfRecorder();
    recorder.frame(Number.NaN, false);
    recorder.frame(10, false);
    recorder.frame(10, true);
    recorder.frame(Number.POSITIVE_INFINITY, true);
    recorder.frame(26, true);
    expect(recorder.snapshot().intervals).toEqual([[26, 16]]);
    expect(recorder.snapshot().bursts.map((b) => b.atMs)).toEqual([10]);
  });

  // The governor ignores a frame not after the last one entirely, so the
  // recorder must too: a log that measured the next interval from the
  // ignored time would not replay to the governor's share changes.
  it("ignores a frame not after the last one, as the governor does", () => {
    const recorder = createPerfRecorder();
    recorder.frame(100, false);
    recorder.frame(116, true);
    recorder.frame(90, true);
    recorder.frame(80, false);
    recorder.frame(132, true);
    const timeline = recorder.snapshot();
    expect(timeline.intervals).toEqual([
      [116, 16],
      [132, 16],
    ]);
    expect(timeline.bursts.map((b) => b.atMs)).toEqual([100]);
  });

  // WHY THIS TEST MATTERS. A steady slow stretch after a zoom-out and one
  // long frame read the same as timing alone; the draw cost per burst tells
  // them apart. The burst keeps the cost of its first frame, and its
  // slowest interval keeps the cost of the frame drawn just before it, the
  // frame that interval measured.
  it("keeps the draw cost at each burst start and at its slowest frame", () => {
    const recorder = createPerfRecorder();
    recorder.frame(0, false);
    recorder.drawn({ calls: 10, triangles: 1000 });
    recorder.frame(16, true);
    recorder.drawn({ calls: 40, triangles: 9000 });
    recorder.frame(116, true);
    recorder.drawn({ calls: 12, triangles: 1200 });
    recorder.frame(132, true);
    recorder.drawn({ calls: 12, triangles: 1200 });
    recorder.frame(5000, false);
    recorder.drawn({ calls: 7, triangles: 700 });
    expect(recorder.snapshot().bursts).toEqual([
      {
        atMs: 0,
        drawCost: { calls: 10, triangles: 1000 },
        slowest: {
          atMs: 116,
          ms: 100,
          drawCost: { calls: 40, triangles: 9000 },
        },
      },
      { atMs: 5000, drawCost: { calls: 7, triangles: 700 }, slowest: null },
    ]);
  });

  it("hands out snapshots that later frames do not change", () => {
    const recorder = createPerfRecorder();
    recorder.frame(0, false);
    const before = recorder.snapshot();
    recorder.drawn({ calls: 3, triangles: 30 });
    recorder.frame(16, true);
    expect(before.bursts).toEqual([{ atMs: 0, drawCost: null, slowest: null }]);
  });

  // The raw mean counts a hidden tab's one long interval, so the report
  // says how many intervals over the governor's gap it includes.
  it("counts the intervals longer than the gap the governor leaves out", () => {
    const recorder = createPerfRecorder(undefined, 250);
    recorder.frame(0, false);
    recorder.frame(16, true);
    recorder.frame(60_016, true);
    recorder.frame(60_032, true);
    expect(recorder.snapshot().longGapCount).toBe(1);
  });

  it("keeps the share changes with their mode and average", () => {
    const recorder = createPerfRecorder();
    recorder.shareChange({
      atMs: 2500,
      from: 1,
      to: 0.5,
      mode: "thinned",
      averageMs: 61.2,
    });
    expect(recorder.snapshot().shareChanges).toEqual([
      { atMs: 2500, from: 1, to: 0.5, mode: "thinned", averageMs: 61.2 },
    ]);
  });

  it("bounds the intervals and counts every one in the mean", () => {
    const recorder = createPerfRecorder({
      intervals: 2,
      bursts: 2,
      shareChanges: 2,
    });
    recorder.frame(0, false);
    recorder.frame(10, true);
    recorder.frame(30, true);
    recorder.frame(60, true);
    const timeline = recorder.snapshot();
    expect(timeline.intervals).toEqual([
      [30, 20],
      [60, 30],
    ]);
    expect(timeline.droppedIntervals).toBe(1);
    const summary = summarizeFrames(timeline);
    expect(summary.frames).toBe(3);
    expect(summary.retained).toBe(2);
    expect(summary.rawMeanMs).toBe(20);
  });
});

describe("percentile", () => {
  it("is the nearest rank, undefined while empty", () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(percentile([7], 0.99)).toBe(7);
  });

  // 0.95 * 11 is 10.45: the nearest rank rounds UP (rank 11), where a
  // rounding rule would give rank 10.
  it("takes the rank upwards, not to the nearest integer", () => {
    const values = Array.from({ length: 11 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBe(11);
  });
});

describe("pickQueryKnobs", () => {
  // THE PRIVACY PROMISE: the link carries the place (lat, lng, the camera),
  // and the pasted report must carry none of it.
  it("keeps only woodsauto, treeform and perf", () => {
    expect(
      pickQueryKnobs("?lat=50.9&lng=6.9&perf=1&cam=1,2,3&treeform=trunk"),
    ).toEqual({ woodsauto: null, treeform: "trunk", perf: "1" });
  });
});

describe("buildPerfReport", () => {
  // The report is read by a person first (the summary lines) and by a tool
  // second (the JSON block), so both halves are pinned.
  it("carries every section and a JSON block that parses", () => {
    const report = buildPerfReport(input());
    for (const heading of [
      "== Summary ==",
      "== Readout ==",
      "== Device ==",
      "== Settings ==",
      "== JSON ==",
    ]) {
      expect(report).toContain(heading);
    }
    expect(report).toContain("woods 50 % (thinned)");
    expect(report).toContain("TestPhone/1.0");
    expect(report).toContain("Test GPU");
    expect(report).toContain("12 draws");
    expect(report).toContain("789 invented trees");
    const json = reportJson(report) as {
      summary: { frames: number; p50Ms: number };
      timeline: { intervals: number[][]; bursts: number[] };
      settings: { query: Record<string, string | null> };
    };
    expect(json.summary.frames).toBe(2);
    expect(json.timeline.intervals).toEqual([
      [16, 16],
      [48, 32],
    ]);
    expect(json.timeline.bursts).toEqual([
      {
        atMs: 0,
        drawCost: null,
        slowest: { atMs: 48, ms: 32, drawCost: null },
      },
    ]);
    expect(json.settings.query).toEqual({
      woodsauto: null,
      treeform: "trunk",
      perf: "1",
    });
  });

  it("reads unmeasured values as '-' and null rather than failing", () => {
    const empty = createPerfRecorder().snapshot();
    const report = buildPerfReport(
      input({
        timeline: empty,
        device: {
          ...DEVICE,
          hardwareConcurrency: null,
          deviceMemoryGb: null,
          gpuRenderer: null,
          gpuVendor: null,
        },
        now: {
          share: 1,
          mode: "off",
          averageMs: undefined,
          readout: "frame - ms",
          drawCost: undefined,
          inventedTrees: 0,
        },
      }),
    );
    expect(report).toContain("frames 0");
    expect(report).toContain("p95 - ms");
    const json = reportJson(report) as {
      now: { averageMs: null; drawCost: null };
    };
    expect(json.now.averageMs).toBeNull();
    expect(json.now.drawCost).toBeNull();
  });

  it("rounds times to a tenth of a millisecond", () => {
    const recorder = createPerfRecorder();
    recorder.frame(0.123456, false);
    recorder.frame(16.789012, true);
    const json = reportJson(
      buildPerfReport(input({ timeline: recorder.snapshot() })),
    ) as { timeline: { intervals: number[][] } };
    expect(json.timeline.intervals).toEqual([[16.8, 16.7]]);
  });
});

describe("buildPerfReport, the replay and the draw cost", () => {
  // The governor-relevant fields, each with a value no other field has, so
  // a report that put one in another's place fails here.
  it("pins every summary number to its own value", () => {
    const recorder = createPerfRecorder();
    recorder.frame(0, false);
    let t = 0;
    for (let i = 1; i <= 100; i++) {
      t += i;
      recorder.frame(t, true);
    }
    const report = buildPerfReport(input({ timeline: recorder.snapshot() }));
    const json = reportJson(report) as { summary: Record<string, unknown> };
    expect(json.summary).toEqual({
      frames: 100,
      retained: 100,
      rawMeanMs: 50.5,
      longGaps: 0,
      p50Ms: 50,
      p95Ms: 95,
      p99Ms: 99,
      replayable: true,
    });
    expect(report).toContain(
      "raw mean 50.5 ms (0 over 250 ms included) · p50 50.0 ms · p95 95.0 ms · p99 99.0 ms",
    );
    expect(report).toContain("replayable yes");
  });

  // After the first dropped entry the timeline no longer starts at the
  // session's start, so a replay through the governor would not match.
  it("says the log is not replayable once a ring dropped an entry", () => {
    const replayable = (report: string): unknown =>
      (reportJson(report) as { summary: { replayable: unknown } }).summary
        .replayable;
    const recorder = createPerfRecorder({
      intervals: 1,
      bursts: 10,
      shareChanges: 10,
    });
    recorder.frame(0, false);
    recorder.frame(16, true);
    expect(
      replayable(buildPerfReport(input({ timeline: recorder.snapshot() }))),
    ).toBe(true);
    recorder.frame(32, true);
    const report = buildPerfReport(input({ timeline: recorder.snapshot() }));
    expect(replayable(report)).toBe(false);
    expect(report).toContain("replayable no");
  });

  it("carries each burst's draw cost in the JSON and the newest in the text", () => {
    const recorder = createPerfRecorder();
    recorder.frame(1000, false);
    recorder.drawn({ calls: 109, triangles: 1_760_000 });
    recorder.frame(1100.04, true);
    recorder.drawn({ calls: 109, triangles: 1_760_000 });
    const report = buildPerfReport(input({ timeline: recorder.snapshot() }));
    const json = reportJson(report) as {
      format: string;
      timeline: { bursts: unknown[] };
    };
    expect(json.format).toBe("osmdemo-perf-log/2");
    expect(json.timeline.bursts).toEqual([
      {
        atMs: 1000,
        drawCost: { calls: 109, triangles: 1_760_000 },
        slowest: {
          atMs: 1100,
          ms: 100,
          drawCost: { calls: 109, triangles: 1_760_000 },
        },
      },
    ]);
    expect(report).toContain("== Bursts ==");
    expect(report).toContain(
      "at 1.0 s: start 109 draws / 1,760,000 tri · slowest 100.0 ms at 1.1 s after 109 draws / 1,760,000 tri",
    );
  });

  // A query value is free text from the link: a URL-encoded newline must
  // not start a line of its own that a reader takes for part of the report.
  it("keeps a knob value with a newline on its own line", () => {
    const report = buildPerfReport(
      input({
        settings: {
          ...input().settings,
          query: { woodsauto: "x\n== JSON ==\n{}", treeform: null, perf: "1" },
        },
      }),
    );
    expect(report).toContain(
      "query woodsauto=x == JSON == {} treeform=(unset)",
    );
    expect(report.split("\n").filter((l) => l === "== JSON ==")).toHaveLength(
      1,
    );
  });
});

describe("reportJson", () => {
  // A Windows clipboard returns CRLF; a pasted copy must still parse.
  it("reads a copy with CRLF line ends", () => {
    const report = buildPerfReport(input()).replace(/\n/g, "\r\n");
    expect(reportJson(report)).toMatchObject({ format: "osmdemo-perf-log/2" });
  });

  it("throws on a text without the JSON block", () => {
    expect(() => reportJson("no json here")).toThrow();
  });
});
