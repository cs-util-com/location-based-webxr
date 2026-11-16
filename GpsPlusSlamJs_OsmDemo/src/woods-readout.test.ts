import { describe, expect, it } from "vitest";

import {
  createFrameWindow,
  createWoodsMeter,
  describeWoodsReadout,
  readWoodsKnobs,
} from "./woods-readout.js";
import { createPerfRecorder } from "./perf-log.js";

/**
 * The woods governor's link knobs and its `?perf=1` readout: what the owner
 * reads on his phone to learn whether the woods push it over 50 ms, which
 * share it settles at, and whether the worthwhile test fires. The knobs are
 * read-only boot overrides; the readout's numbers are pure so the sentence
 * can be pinned without a GPU.
 */
describe("readWoodsKnobs", () => {
  // Active only on a phone (a coarse pointer), and switchable off for a
  // measurement with `woodsauto=off`.
  it("runs the governor on a coarse pointer unless the link says woodsauto=off", () => {
    expect(readWoodsKnobs("", true).auto).toBe(true);
    expect(readWoodsKnobs("", false).auto).toBe(false);
    expect(readWoodsKnobs("?woodsauto=off", true).auto).toBe(false);
    expect(readWoodsKnobs("?woodsauto=on", true).auto).toBe(true);
  });

  // The trunk form is an option, off by default; any other value is the
  // default rather than an error, as an old or mistyped link should open.
  it("draws the trunk form only for treeform=trunk", () => {
    expect(readWoodsKnobs("", false).treeForm).toBe("crown");
    expect(readWoodsKnobs("?treeform=trunk", false).treeForm).toBe("trunk");
    expect(readWoodsKnobs("?treeform=palm", false).treeForm).toBe("crown");
  });

  it("shows the readout only for perf=1", () => {
    expect(readWoodsKnobs("", false).perf).toBe(false);
    expect(readWoodsKnobs("?perf=1", false).perf).toBe(true);
    expect(readWoodsKnobs("?perf=0", false).perf).toBe(false);
    expect(readWoodsKnobs("?lat=1&perf=1&lng=2", false).perf).toBe(true);
  });
});

describe("createFrameWindow", () => {
  // The p95 the plan asks for is over the last 10 s of counted frames, so a
  // stall a minute ago no longer colours the reading.
  it("gives the 95th percentile of the intervals in the last ten seconds", () => {
    const window = createFrameWindow();
    expect(window.p95()).toBeUndefined();
    for (let i = 1; i <= 100; i++) window.add(i * 10, i);
    expect(window.p95()).toBe(95);
    // Twenty seconds later the old intervals have left the window.
    window.add(21_000, 7);
    expect(window.p95()).toBe(7);
  });

  it("ignores intervals that are not positive and finite", () => {
    const window = createFrameWindow();
    window.add(0, Number.NaN);
    window.add(1, -5);
    window.add(2, Number.POSITIVE_INFINITY);
    expect(window.p95()).toBeUndefined();
  });
});

describe("describeWoodsReadout", () => {
  it("says the frame time, the woods' share and mode, the invented trees and the cost", () => {
    expect(
      describeWoodsReadout({
        averageMs: 61.24,
        p95Ms: 88,
        share: 0.5,
        mode: "thinned",
        inventedTrees: 1234,
        drawCost: { calls: 120, triangles: 456789 },
      }),
    ).toBe(
      "frame 61.2 ms · p95 88.0 ms · woods 50 % (thinned) · 1,234 invented trees · 120 draws / 456,789 tri",
    );
  });

  // Before the first counted frame there is no frame time to show, and a
  // zero would claim a frame that never happened.
  it("shows a dash before the first counted frame and drops an unmeasured cost", () => {
    expect(
      describeWoodsReadout({
        averageMs: undefined,
        p95Ms: undefined,
        share: 1,
        mode: "off",
        inventedTrees: 0,
        drawCost: undefined,
      }),
    ).toBe("frame - ms · p95 - ms · woods 100 % (off) · 0 invented trees");
  });
});

describe("createWoodsMeter", () => {
  // WHY THIS TEST MATTERS. The view hands the meter each frame and applies a
  // share only when it CHANGES: re-applying an unchanged share every frame
  // would re-sort the trunk form's trees on every drag frame, the cost the
  // 2 m re-sort rule exists to avoid. And the readout must count only chained
  // intervals, or an idle pause between drags reads as a slow frame.
  it("reports a new share once, when the governor moves it", () => {
    const meter = createWoodsMeter(true);
    const changes: number[] = [];
    // 60 ms a frame at full woods, 40 ms once thinned: the step buys time,
    // so the governor keeps it (a steady 60 ms would send it back to full).
    for (let t = 0; t <= 8_000; t += meter.share() === 1 ? 60 : 40) {
      const share = meter.frame(t, t > 0);
      if (share !== undefined) changes.push(share);
    }
    expect(changes).toEqual([0.5]);
    expect(meter.share()).toBe(0.5);
  });

  it("never moves the share with auto off, and still reads the frame time", () => {
    const meter = createWoodsMeter(false);
    for (let t = 0; t <= 5_000; t += 60) {
      expect(meter.frame(t, t > 0)).toBeUndefined();
    }
    expect(meter.describe(0, undefined)).toMatch(
      /^frame 60\.0 ms · p95 60\.0 ms · woods 100 % \(off\)/,
    );
  });

  it("leaves an idle pause out of the percentile", () => {
    const meter = createWoodsMeter(false);
    meter.frame(0, false);
    meter.frame(16, true);
    // Ten seconds idle, then a new burst: the first frame is not chained.
    meter.frame(10_016, false);
    meter.frame(10_032, true);
    expect(meter.describe(3, undefined)).toBe(
      "frame 16.0 ms · p95 16.0 ms · woods 100 % (off) · 3 invented trees",
    );
  });

  // WHY THIS TEST MATTERS. The `?perf=1` log is fed by the meter, so a share
  // change reaches it with the governor's mode and average at that moment,
  // and the frames it records follow the same chained rule.
  it("feeds a perf recorder its frames and each share change", () => {
    const recorder = createPerfRecorder();
    const meter = createWoodsMeter(true, recorder);
    for (let t = 0; t <= 8_000; t += meter.share() === 1 ? 60 : 40) {
      meter.frame(t, t > 0);
    }
    const timeline = recorder.snapshot();
    expect(timeline.bursts.map((burst) => burst.atMs)).toEqual([0]);
    expect(timeline.intervalCount).toBeGreaterThan(100);
    expect(timeline.shareChanges).toHaveLength(1);
    const change = timeline.shareChanges[0];
    expect(change).toMatchObject({ from: 1, to: 0.5, mode: "thinned" });
    expect(change?.averageMs).toBeGreaterThan(50);
    expect(meter.state()).toMatchObject({ share: 0.5, mode: "thinned" });
  });

  // A meter that recorded only step-downs would leave a log in which the
  // woods never come back: the step up must reach the recorder too.
  it("records a step down and the step back up", () => {
    const recorder = createPerfRecorder();
    const meter = createWoodsMeter(true, recorder);
    let t = 0;
    meter.frame(t, false);
    while (meter.share() === 1 && t < 10_000) {
      t += 100;
      meter.frame(t, true);
    }
    // An idle pause longer than the rest, then fast frames for 13 s.
    t += 400_000;
    meter.frame(t, false);
    for (let i = 0; i < 13_000 / 16; i++) {
      t += 16;
      meter.frame(t, true);
    }
    expect(
      recorder.snapshot().shareChanges.map(({ from, to, mode }) => ({
        from,
        to,
        mode,
      })),
    ).toEqual([
      { from: 1, to: 0.5, mode: "thinned" },
      { from: 0.5, to: 1, mode: "full" },
    ]);
    expect(meter.share()).toBe(1);
  });
});
