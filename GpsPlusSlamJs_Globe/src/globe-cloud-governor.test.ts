/**
 * The step-down.
 *
 * Why this file matters: nobody measured a phone, so this is what stands
 * between an unknown device and a slide show; and a step-down that
 * flickers between two settings costs more than either.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLOUD_GOVERNOR,
  createGlobeCloudGovernor,
} from "./globe-cloud-governor.js";

/** `count` frames of `ms` each. */
function run(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  ms: number,
  seconds: number,
) {
  for (let t = 0; t < seconds * 1000; t += ms) governor.frame(ms);
}

/** `seconds` of frames as long as `ms` at all pixels and shorter with fewer. */
function runOnPixels(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  ms: number,
  seconds: number,
) {
  for (let t = 0; t < seconds * 1000;) {
    const frame = ms * governor.state().pixelScale;
    governor.frame(frame);
    t += frame;
  }
}

describe("createGlobeCloudGovernor", () => {
  it("leaves a fast device alone", () => {
    const governor = createGlobeCloudGovernor("high");
    run(governor, 16.7, 60);
    expect(governor.state()).toEqual({ pixelScale: 1, tier: "high" });
  });

  // Why this test matters: the order is the decision: the pixel count
  // first, low only as the last resort.
  it("lowers the pixels first and steps to low last", () => {
    const governor = createGlobeCloudGovernor("high");
    runOnPixels(governor, 100, 3);
    expect(governor.state().tier).toBe("high");
    expect(governor.state().pixelScale).toBeLessThan(1);
    runOnPixels(governor, 100, 3 * CLOUD_GOVERNOR.steps);
    expect(governor.state().tier).toBe("low");
  });

  it("restores the pixels on the low tier, which starts cheaper", () => {
    const governor = createGlobeCloudGovernor("medium");
    runOnPixels(governor, 100, 3 * (CLOUD_GOVERNOR.steps + 2));
    expect(governor.state()).toEqual({ tier: "low", pixelScale: 1 });
  });

  it("stops at low with the fewest pixels", () => {
    const governor = createGlobeCloudGovernor("low");
    runOnPixels(governor, 100, 300);
    expect(governor.state()).toEqual({
      tier: "low",
      pixelScale: CLOUD_GOVERNOR.minPixelScale,
    });
  });

  // Why this test matters: a 30 Hz screen or a saving mode reads as slow, and
  // no number of pixels makes it faster: all of them come back and it stays.
  it("gives everything back on a capped screen, once", () => {
    const governor = createGlobeCloudGovernor("high");
    run(governor, 33.3, 3 * (CLOUD_GOVERNOR.steps + 2));
    expect(governor.state()).toEqual({ pixelScale: 1, tier: "high" });
    run(governor, 33.3, 120);
    expect(governor.state()).toEqual({ pixelScale: 1, tier: "high" });
  });

  // Why this test matters: the rest is a verdict on the device as it was. A
  // screen that was capped and a phone that later heats up look alike at
  // first; a rest for the view's life would leave the second a slide show.
  it("tries again after the rest", () => {
    const governor = createGlobeCloudGovernor("high");
    run(governor, 33.3, 3 * (CLOUD_GOVERNOR.steps + 2));
    runOnPixels(governor, 100, CLOUD_GOVERNOR.restS - 60);
    expect(governor.state()).toEqual({ pixelScale: 1, tier: "high" });
    runOnPixels(governor, 100, 60 + 3 * (CLOUD_GOVERNOR.steps + 2));
    expect(governor.state().tier).toBe("low");
  });

  it("keeps stepping down when the pixels helped at 30 Hz", () => {
    const governor = createGlobeCloudGovernor("high");
    run(governor, 33.3, 3);
    expect(governor.state().pixelScale).toBeLessThan(1);
    run(governor, 25, 3 * (CLOUD_GOVERNOR.steps + 2));
    expect(governor.state().tier).toBe("low");
  });

  // Why this test matters: a tab in the background or a garbage collection
  // is no verdict on the device.
  it("ignores a gap", () => {
    const governor = createGlobeCloudGovernor("high");
    for (let i = 0; i < 20; i++) {
      governor.frame(5000);
      governor.frame(16);
    }
    expect(governor.state().pixelScale).toBe(1);
  });

  // Why this test matters: it gives back what it took once the view is
  // cheap again, but slowly, or it would hunt.
  it("gives pixels back slowly and never the tier", () => {
    const governor = createGlobeCloudGovernor("high");
    run(governor, 40, 3);
    const lowered = governor.state().pixelScale;
    run(governor, 10, 2);
    expect(governor.state().pixelScale).toBe(lowered);
    run(governor, 10, 60);
    expect(governor.state().pixelScale).toBe(1);
    runOnPixels(governor, 100, 3 * (CLOUD_GOVERNOR.steps + 1));
    run(governor, 10, 600);
    expect(governor.state().tier).toBe("low");
  });

  // Why this test matters: software rendering takes seconds a frame; read as
  // one gap after another it never stepped down, and the page starved.
  it("steps down on frames of seconds, in a row", () => {
    const governor = createGlobeCloudGovernor("high");
    runOnPixels(governor, 2600, 40);
    expect(governor.state().pixelScale).toBeLessThan(1);
    runOnPixels(governor, 2600, 60);
    expect(governor.state().tier).toBe("low");
  });

  it("does nothing when a choice was made", () => {
    const governor = createGlobeCloudGovernor("high", { auto: false });
    run(governor, 100, 300);
    expect(governor.state()).toEqual({ pixelScale: 1, tier: "high" });
  });

  it("keeps the scale in range, whatever the frames", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 400, noNaN: true }), {
          maxLength: 300,
        }),
        (frames) => {
          const governor = createGlobeCloudGovernor("high");
          for (const ms of frames) governor.frame(ms);
          const { pixelScale } = governor.state();
          expect(pixelScale).toBeGreaterThanOrEqual(
            CLOUD_GOVERNOR.minPixelScale,
          );
          expect(pixelScale).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
