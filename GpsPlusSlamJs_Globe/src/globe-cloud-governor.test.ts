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

/** Frames of `ms` until the pixel scale is down to `scale` (the fewest by
 *  default); throws when a minute of them does not get there. */
function downTo(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  ms: number,
  scale: number = CLOUD_GOVERNOR.minPixelScale,
) {
  for (let t = 0; t < 60_000; t += ms) {
    if (governor.state().pixelScale <= scale + 1e-9) return;
    governor.frame(ms);
  }
  throw new Error(`never reached a pixel scale of ${scale}`);
}

/** What the worthwhile test against the full `baseline` gives at `later`:
 *  low when the fewest pixels saved enough, every pixel back when not. */
function fullBaselineVerdict(baseline: number, later: number): unknown {
  return later <= baseline * (1 - CLOUD_GOVERNOR.worthwhile)
    ? expect.objectContaining({ tier: "low" })
    : { pixelScale: 1, tier: "high" };
}

/** Two counted hitches of `ms` in a row (one alone is a gap). */
function hitchPair(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  ms: number,
) {
  governor.frame(ms);
  governor.frame(ms);
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

  // Why this test matters: the worthwhile test reads the average from when
  // the pixels began to fall. A device slow at full pixels (`slowAt`), fine
  // for minutes at the fewest (the steps bought their time), and slow again
  // later (a denser deck, a phone heating up) is still too slow: it falls to
  // low. Judged against the old baseline it read as a capped screen, got
  // every pixel back and rested five minutes on a slide show.
  // Sweep: baselines 24-30 ms, bought at 19-21 ms, later 23-27 ms; every
  // later value is above `slowAt * (1 - worthwhile)`, where the old rule
  // rested. What reverses it: a fewest-pixels average that never went under
  // `slowMs` (nothing bought), which is the capped screen's rest below.
  for (const baseline of [24, 26, 30]) {
    for (const bought of [19, 21]) {
      for (const later of [23, 25.5, 27].filter(
        (ms) => ms > baseline * (1 - CLOUD_GOVERNOR.worthwhile),
      )) {
        it(`falls to low when the fewest pixels bought their time and got slow later (${baseline} -> ${bought} -> ${later} ms)`, () => {
          const governor = createGlobeCloudGovernor("high");
          downTo(governor, baseline);
          run(governor, bought, 120);
          expect(governor.state()).toEqual({
            pixelScale: CLOUD_GOVERNOR.minPixelScale,
            tier: "high",
          });
          run(governor, later, 4);
          expect(governor.state().tier).toBe("low");
        });
      }
    }
  }

  // Why this test matters: a step that bought its time skips the worthwhile
  // test only at the fewest pixels, where the next rung is the tier. Higher
  // up, the steps still left are judged at the fewest pixels against the
  // average from before the pixels fell: a baseline re-taken at a middle
  // rung would measure only the last rung or two, read a slowdown that the
  // pixels do not cause (a denser deck at a flat cost) as worthless steps and
  // give every pixel back for `restS`, where the full baseline sends the
  // device to low.
  // Sweep: bought at rungs 3 and 4 at 20 ms, later 22.5-26 ms flat, baselines
  // 24-40 ms. The expected end is the full baseline's verdict: low where the
  // later time is at most `baseline * (1 - worthwhile)`, all pixels back
  // above it. What reverses it: a later time on the other side of that line.
  for (const baseline of [24, 26, 30, 40]) {
    for (const rung of [3, 4]) {
      for (const later of [22.5, 24, 26]) {
        it(`judges the steps left against the full baseline after a middle rung bought its time (${baseline} ms, rung ${rung}, later ${later} ms)`, () => {
          const governor = createGlobeCloudGovernor("high");
          downTo(governor, baseline, 1 - rung * CLOUD_GOVERNOR.step);
          run(governor, 20, 30);
          expect(governor.state().pixelScale).toBeCloseTo(
            1 - rung * CLOUD_GOVERNOR.step,
            9,
          );
          run(governor, later, 10);
          expect(governor.state()).toEqual(
            fullBaselineVerdict(baseline, later),
          );
        });
      }
    }
  }

  // Why this test matters: two long hitches in a row (a collection, a tile
  // decode) at the fewest pixels, once they bought their time, are a fresh
  // slow verdict, and the next rung is the tier: low for the view's life.
  // A frame credits at most `gapMs` to the verdicts' seconds, so a pair of
  // hitches cannot hold the average over `slowMs` for `slowS` by itself.
  // Sweep: hitches 0.4-10 s, frames before and after 19-21.8 ms (all under
  // `slowMs`). What reverses it: frames after the hitches over `slowMs`,
  // which is a slow device, not a hitch.
  for (const end of [19, 20.5, 21.8]) {
    for (const hitch of [400, 800, 1700, 4000, 10_000]) {
      it(`keeps the tier through two hitches at the fewest pixels (${hitch} ms between ${end} ms frames)`, () => {
        const governor = createGlobeCloudGovernor("high");
        downTo(governor, 30);
        run(governor, end, 60);
        hitchPair(governor, hitch);
        run(governor, end, 30);
        expect(governor.state().tier).toBe("high");
      });
    }
  }

  // Why this test matters: at low with the fewest pixels no rung is left to
  // buy time with, so the baseline stays: the fewest pixels still pay
  // against low's full ones and stay, rather than a re-taken baseline
  // judging the next verdict worthless and giving every pixel back.
  // Sweep: later 22.5-25 ms against a low baseline of 30 ms (all under
  // `30 * (1 - worthwhile)` = 25.5); above 25.5 the step-down is worthless
  // against low's own full pixels and rests, as it always did.
  for (const later of [22.5, 24, 25]) {
    it(`stays at low with the fewest pixels when they bought their time and got slow later (${later} ms)`, () => {
      const governor = createGlobeCloudGovernor("low");
      downTo(governor, 30);
      run(governor, 19, 60);
      run(governor, later, 30);
      expect(governor.state()).toEqual({
        pixelScale: CLOUD_GOVERNOR.minPixelScale,
        tier: "low",
      });
    });
  }

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
