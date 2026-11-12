import { describe, expect, it } from "vitest";

import {
  createWoodsGovernor,
  WOODS_GOVERNOR,
  type WoodsGovernor,
} from "./woods-governor.js";

/**
 * The phone's woods governor: above 50 ms a frame it thins the invented
 * woods, and only for frames that belong to a burst, because OsmDemo draws
 * on demand. These scenarios pin the owner's rule and the guards around it:
 * idle time is never a slow frame, one hitch is never a verdict, a step that
 * buys nothing is taken back, and a share that proved too slow is not
 * re-entered for a rest period (no popping between 1 and 0.5).
 */

/** Feeds a burst: one unchained frame, then chained frames `ms(share)` apart. */
function burst(
  governor: WoodsGovernor,
  startMs: number,
  durationMs: number,
  ms: number | ((share: number) => number),
): number {
  let at = startMs;
  governor.frame(at, false);
  while (at - startMs < durationMs) {
    at += typeof ms === "number" ? ms : ms(governor.state().share);
    governor.frame(at, true);
  }
  return at;
}

/** The time (ms) of the first frame at which the share left 1, or undefined. */
function firstStepAt(
  governor: WoodsGovernor,
  durationMs: number,
  ms: number,
): number | undefined {
  let at = 0;
  governor.frame(at, false);
  while (at < durationMs) {
    at += ms;
    governor.frame(at, true);
    if (governor.state().share < 1) return at;
  }
  return undefined;
}

describe("createWoodsGovernor", () => {
  // The owner's rule itself: a steady 60 ms frame is a phone too slow for the
  // woods, and two seconds of it is the verdict.
  it("steps down to half after about two seconds of 60 ms frames", () => {
    const governor = createWoodsGovernor();
    const at = firstStepAt(governor, 10_000, 60);
    expect(at).toBeDefined();
    expect(at).toBeGreaterThanOrEqual(WOODS_GOVERNOR.slowS * 1000);
    expect(at).toBeLessThan(WOODS_GOVERNOR.slowS * 1000 + 1500);
    expect(governor.state()).toMatchObject({ share: 0.5, mode: "thinned" });
  });

  // The ladder: each further slow verdict halves again while the steps buy
  // something, and it stops at a quarter, never at no woods.
  it("goes on to a quarter while each step buys time, and never below", () => {
    const governor = createWoodsGovernor();
    // Frame time proportional to the woods drawn: 120 ms at full, 60 at half.
    burst(governor, 0, 60_000, (share) => 30 + 90 * share);
    expect(governor.state().share).toBe(0.25);
  });

  // The worthwhile test: when thinning bought less than 15 percent, the trees
  // were not the cost, so the woods come back and the step-down rests.
  it("brings the woods back and rests when a step bought nothing", () => {
    const governor = createWoodsGovernor();
    const end = burst(governor, 0, 8_000, 60);
    expect(governor.state()).toMatchObject({ share: 1, mode: "resting" });
    // Still resting a little before the rest runs out: no step-down.
    burst(governor, end, WOODS_GOVERNOR.restS * 1000 - 20_000, 60);
    expect(governor.state().share).toBe(1);
  });

  // The guard against a hitch (a GC pause, a texture upload): one 250 ms
  // frame inside smooth frames is not a slow device.
  it("ignores a single 250 ms frame", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 5_000, 16.7);
    at += 250;
    governor.frame(at, true);
    burst(governor, at, 5_000, 16.7);
    expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
  });

  // A tab that comes back from the background mid-burst delivers one chained
  // frame seconds long; alone, it says nothing about the device.
  it("ignores a single chained frame seconds long", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 5_000, 16.7);
    at += 3_000;
    governor.frame(at, true);
    burst(governor, at, 5_000, 16.7);
    expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
  });

  // OsmDemo renders on demand: the 30 s between two drags is idle time, not
  // a frame. A governor that read it as one would strip the woods on every
  // phone; a burst that IS slow still steps down.
  it("never counts the idle gaps between bursts, yet a slow burst steps down", () => {
    const governor = createWoodsGovernor();
    let at = 0;
    for (let i = 0; i < 20; i++) at = burst(governor, at + 30_000, 1_000, 16.7);
    expect(governor.state().share).toBe(1);
    burst(governor, at + 30_000, 3_000, 60);
    expect(governor.state().share).toBe(0.5);
  });

  // An unchained frame starts a burst and measures nothing, however late.
  it("measures nothing from unchained frames", () => {
    const governor = createWoodsGovernor();
    for (let at = 0; at < 60_000; at += 100) governor.frame(at, false);
    expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
    expect(governor.state().averageMs).toBeUndefined();
  });

  // No popping: the share that proved too slow is not re-entered within the
  // rest, however fast the thinned woods are; after the rest it is tried
  // again (a device that cooled down deserves its woods back).
  it("does not return to a share that proved too slow within the rest, and does after it", () => {
    const governor = createWoodsGovernor();
    // 60 ms with all the woods, 20 ms with half: thinning is worthwhile.
    const frameMs = (share: number) => (share === 1 ? 60 : 20);
    const stepped = firstStepAt(governor, 10_000, 60);
    expect(stepped).toBeDefined();
    const steppedAt = stepped ?? 0;
    const at = burst(governor, steppedAt, 250_000, frameMs);
    expect(governor.state().share).toBe(0.5);
    // Past the rest: the full woods are tried again (at full, 60 ms frames
    // step down once more, which is the device telling the same story).
    let backAt: number | undefined;
    let now = at;
    burst(governor, at, 80_000, (share) => {
      if (share === 1 && backAt === undefined) backAt = now;
      const ms = frameMs(share);
      now += ms;
      return ms;
    });
    expect(backAt).toBeDefined();
    expect((backAt ?? 0) - steppedAt).toBeGreaterThanOrEqual(
      WOODS_GOVERNOR.restS * 1000,
    );
    expect(governor.state().share).toBe(0.5);
  });

  // Desktop and `woodsauto=off`: the measurement link must be able to switch
  // the governor off, and then nothing moves the share.
  it("never steps with auto off", () => {
    const governor = createWoodsGovernor({ auto: false });
    burst(governor, 0, 60_000, 200);
    expect(governor.state()).toMatchObject({ share: 1, mode: "off" });
    // It still measures: the readout shows the desktop's frame time too.
    expect(governor.state().averageMs).toBeCloseTo(200, 6);
  });

  // Fast for twelve seconds gives a step back when the rest allows it.
  it("gives a step back after twelve seconds of fast frames once the rest is over", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 3_000, 60);
    expect(governor.state().share).toBe(0.5);
    // An idle wait beyond the rest (wall time, not counted frames).
    at += WOODS_GOVERNOR.restS * 1000;
    burst(governor, at, 11_000, 20);
    expect(governor.state().share).toBe(0.5);
    burst(governor, at + 11_100, 13_000, 20);
    expect(governor.state().share).toBe(1);
  });

  // Defensive: a clock that runs backwards or a non-number is ignored rather
  // than poisoning the average.
  it("ignores non-finite times and time running backwards", () => {
    const governor = createWoodsGovernor();
    governor.frame(1000, false);
    governor.frame(Number.NaN, true);
    governor.frame(500, true);
    governor.frame(Number.POSITIVE_INFINITY, true);
    expect(governor.state().averageMs).toBeUndefined();
    expect(governor.state().share).toBe(1);
  });
});

/**
 * The sweep the plan asks for (verdicts across a range, not at one value):
 * where between 33 and 250 ms a steady frame starts to thin the woods, and
 * how soon. Below the 50 ms threshold nothing moves; above it the first
 * step lands at two seconds of counted frames plus the smoothing's lag.
 */
describe("the step-down across steady frame times", () => {
  for (const ms of [34, 40, 45, 49]) {
    it(`never steps down at ${ms} ms`, () => {
      expect(firstStepAt(createWoodsGovernor(), 60_000, ms)).toBeUndefined();
    });
  }
  for (const ms of [51, 55, 60, 80, 120, 200, 249, 300]) {
    it(`steps down at ${ms} ms within two seconds plus the smoothing`, () => {
      const at = firstStepAt(createWoodsGovernor(), 60_000, ms);
      expect(at).toBeDefined();
      // 51 ms needs the longest: the average creeps up to the threshold.
      expect(at).toBeLessThan(ms <= 55 ? 30_000 : 6_000);
    });
  }
});
