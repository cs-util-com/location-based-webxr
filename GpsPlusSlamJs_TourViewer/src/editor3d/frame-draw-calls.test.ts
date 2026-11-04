import { describe, expect, it } from "vitest";

import { createFrameDrawCalls } from "./frame-draw-calls.js";

/** The part of `renderer.info` the counter reads, as three.js keeps it:
 *  each render adds its calls, and resets first only with `autoReset`. */
function fakeInfo() {
  const info = {
    autoReset: true,
    render: { calls: 0 },
    reset() {
      info.render.calls = 0;
    },
    draw(calls: number) {
      if (info.autoReset) info.reset();
      info.render.calls += calls;
    },
  };
  return info;
}

describe("createFrameDrawCalls", () => {
  // Why: the globe frame renders several passes (the sky, the scene, the
  // air's composites, the interface pass); with three.js's automatic reset
  // the status bar read only the last pass's calls. The counter must sum
  // the whole frame and report the last finished frame between frames.
  it("counts every pass of a frame, not only the last", () => {
    const info = fakeInfo();
    const counter = createFrameDrawCalls(info);
    expect(info.autoReset).toBe(false);
    expect(counter.calls()).toBe(0);
    counter.begin();
    info.draw(3);
    info.draw(40);
    info.draw(2);
    counter.end();
    expect(counter.calls()).toBe(45);
    counter.begin();
    info.draw(5);
    // Mid-frame the last finished frame is still what is reported.
    expect(counter.calls()).toBe(45);
    counter.end();
    expect(counter.calls()).toBe(5);
  });

  // Why: dispose hands the renderer back as it was given.
  it("puts the automatic reset back on dispose", () => {
    const info = fakeInfo();
    const counter = createFrameDrawCalls(info);
    counter.dispose();
    expect(info.autoReset).toBe(true);
  });
});
