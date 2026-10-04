/**
 * Tests for the frame-hitch recorder's per-frame core (globe zoom frame-hitch
 * plan 2026-10-03-2017 §4.1, PERF-1).
 *
 * Why this file matters: an event must land in the frame whose interval it
 * lengthened. The recorder closes a frame at the NEXT frame's start, with
 * that start minus its own as the interval and the events marked in between
 * as its events; a run feeds exactly those pairs to the frame run (PERF-0's
 * `createFrameRun`, injected here as a recording fake). The count-only
 * factors (§4.3) are summed per run and their worst frame kept, and the
 * time inside the lab's frame is kept apart from the gap outside it.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createPerfRecorder } from "./globe-perf-recorder.js";

/** A frame run that records what it was fed. */
function fakeRun() {
  const frames = [];
  return {
    frames,
    endFrame(intervalMs, events = []) {
      frames.push({ intervalMs, events: [...events].sort() });
    },
    summary: () => ({ frames: frames.length }),
  };
}

describe("createPerfRecorder", () => {
  it("closes each frame at the next one's start, with the events marked in it", () => {
    const runs = [];
    const rec = createPerfRecorder({
      createRun: () => {
        const r = fakeRun();
        runs.push(r);
        return r;
      },
    });
    rec.startRun("alps 1");
    rec.frameStart(1000);
    rec.mark("relief.load");
    rec.mark("relief.load");
    rec.mark("e.step");
    rec.frameEnd(1010);
    rec.frameStart(1016);
    rec.frameEnd(1020);
    rec.frameStart(1080);
    rec.mark("raycast", 3);
    rec.frameEnd(1085);
    rec.frameStart(1100);
    const done = rec.stopRun();
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].frames, [
      { intervalMs: 16, events: ["e.step", "relief.load"] },
      { intervalMs: 64, events: [] },
      { intervalMs: 20, events: ["raycast"] },
    ]);
    assert.equal(done.label, "alps 1");
    assert.deepEqual(done.summary, { frames: 3 });
    // Counts: totals and the most in any one frame.
    assert.deepEqual(done.counts["relief.load"], {
      total: 2,
      maxPerFrame: 2,
      frames: 1,
    });
    assert.deepEqual(done.counts.raycast, {
      total: 3,
      maxPerFrame: 3,
      frames: 1,
    });
    // Time inside the lab's frame against the gap outside it.
    assert.deepEqual(done.work, { insideMs: 10 + 4 + 5, frames: 3 });
  });

  it("records nothing outside a run, and a run's first frame has no interval", () => {
    const fed = [];
    const rec = createPerfRecorder({
      createRun: () => ({
        endFrame: (ms, ev) => fed.push([ms, ev]),
        summary: () => null,
      }),
    });
    rec.frameStart(0);
    rec.mark("relief.load");
    rec.frameStart(16);
    assert.equal(fed.length, 0);
    rec.startRun("x");
    rec.frameStart(32);
    rec.frameStart(48);
    rec.stopRun();
    assert.deepEqual(fed, [[16, []]]);
  });

  it("collects idle intervals for the refresh calibration, apart from any run", () => {
    const rec = createPerfRecorder({ createRun: fakeRun });
    rec.startIdle();
    for (const t of [0, 16, 33, 50, 66]) rec.frameStart(t);
    assert.deepEqual(rec.stopIdle(), [16, 17, 17, 16]);
  });

  it("keeps numeric samples per run (a count taken on its own frame)", () => {
    const rec = createPerfRecorder({ createRun: fakeRun });
    rec.startRun("nodes");
    rec.frameStart(0);
    rec.sample("relief.nodes", 120);
    rec.frameStart(16);
    rec.sample("relief.nodes", 180);
    rec.frameStart(32);
    const done = rec.stopRun();
    assert.deepEqual(done.samples["relief.nodes"], [120, 180]);
  });

  it("refuses a mark with a count that is not a positive integer", () => {
    const rec = createPerfRecorder({ createRun: fakeRun });
    assert.throws(() => rec.mark("x", 0), RangeError);
    assert.throws(() => rec.mark("x", 1.5), RangeError);
    assert.throws(() => rec.mark("", 1), RangeError);
  });
});
