/**
 * Tests for the recorder's guards: the lost graphics context and the
 * frame watchdog.
 *
 * Why this file matters: a phone sweep is run once. On a desktop the GPU
 * dropped the page's context during an items' warm-up, outside any held
 * run, and every later run measured a GPU drawing nothing (no draw calls,
 * no GPU name) while the table looked plausible. A loss must be noticed
 * whenever it happens, named by where the sweep was, and checked before
 * every run; a page whose frames stop while it is on screen must end the
 * sweep with what it has rather than hang forever.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createContextWatch, createFrameWatchdog } from "./globe-perf-guard.js";

/** A canvas that fires the two context events the test asks for. */
function fakeCanvas() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn({ type });
    },
  };
}

describe("createContextWatch", () => {
  it("records a loss whenever it happens, with where the sweep was", () => {
    const canvas = fakeCanvas();
    let t = 100;
    const gl = { isContextLost: () => false };
    const watch = createContextWatch({ canvas, gl, now: () => t });
    assert.equal(watch.isLost(), false);
    watch.setLabel("items warm-up 1km n=50 r1");
    t = 2_500;
    canvas.fire("webglcontextlost");
    // A later label does not rename the loss.
    watch.setLabel("1km n=50 r1");
    assert.equal(watch.isLost(), true);
    assert.deepEqual(watch.report(), {
      lost: { atMs: 2_500, at: "items warm-up 1km n=50 r1", by: "event" },
      restored: null,
    });
    t = 4_000;
    canvas.fire("webglcontextrestored");
    // Restored is recorded; the sweep's numbers since the loss stay void.
    assert.equal(watch.isLost(), true);
    assert.deepEqual(watch.report().restored, { atMs: 4_000 });
  });
  it("notices a loss the event did not report, from the context itself", () => {
    const canvas = fakeCanvas();
    let lost = false;
    const watch = createContextWatch({
      canvas,
      gl: { isContextLost: () => lost },
      now: () => 7,
    });
    watch.setLabel("space n=0 r2");
    lost = true;
    assert.equal(watch.isLost(), true);
    assert.deepEqual(watch.report().lost, {
      atMs: 7,
      at: "space n=0 r2",
      by: "check",
    });
  });
  it("keeps the first loss only", () => {
    const canvas = fakeCanvas();
    let t = 1;
    const watch = createContextWatch({
      canvas,
      gl: { isContextLost: () => true },
      now: () => t,
    });
    watch.setLabel("a");
    canvas.fire("webglcontextlost");
    t = 2;
    watch.setLabel("b");
    canvas.fire("webglcontextlost");
    assert.deepEqual(watch.report().lost, { atMs: 1, at: "a", by: "event" });
  });
  // WHY: the export reads "restored" as "a loss came back"; a stray
  // restore event with no loss before it must not claim one.
  it("ignores a restore that no loss came before", () => {
    const canvas = fakeCanvas();
    const watch = createContextWatch({
      canvas,
      gl: { isContextLost: () => false },
      now: () => 1,
    });
    canvas.fire("webglcontextrestored");
    assert.deepEqual(watch.report(), { lost: null, restored: null });
  });
});

describe("createFrameWatchdog", () => {
  it("expires when no frame came for its timeout while visible", () => {
    const dog = createFrameWatchdog({ timeoutMs: 5_000 });
    dog.frame(0);
    assert.equal(dog.expired(4_999, true), false);
    assert.equal(dog.expired(5_001, true), true);
    dog.frame(5_002);
    assert.equal(dog.expired(6_000, true), false);
  });
  // WHY: a hidden page gets no frames by design; the time it spent hidden
  // must not count against it when it comes back.
  it("never expires while the page is hidden, and counts afresh after", () => {
    const dog = createFrameWatchdog({ timeoutMs: 5_000 });
    dog.frame(0);
    assert.equal(dog.expired(60_000, false), false);
    assert.equal(dog.expired(64_000, true), false);
    assert.equal(dog.expired(65_001, true), true);
  });
  it("refuses a timeout that is not finite and > 0", () => {
    for (const v of [0, -1, NaN, Infinity]) {
      assert.throws(() => createFrameWatchdog({ timeoutMs: v }), RangeError);
    }
  });
});
