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

  // A thinned share that bought its time and then met a denser district is
  // judged against the slowness that sent it down, not only the full woods:
  // full at 60 ms, half at 45, later 70 at half (heavier woods), a quarter at
  // 55. The quarter saved over 15 percent against the 70, so it stays,
  // though against the full woods' 60 it would read as worthless.
  it("keeps a quarter that pays against the half's later slowness", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 3_000, 60);
    expect(governor.state().share).toBe(0.5);
    at = burst(governor, at, 60_000, 45);
    burst(governor, at + 60_000, 30_000, (share) => (share === 0.5 ? 70 : 55));
    expect(governor.state()).toMatchObject({ share: 0.25, mode: "thinned" });
  });

  // A thinned share has bought its time only after `fastS` of counted frames
  // under the line, not after one fast frame: a short dip at half (a pause in
  // the scene, startup frames) followed by the same slowness as before is
  // still the woods not paying, so the full woods come back and rest. A dip
  // as long as `fastS` is a real purchase and the next verdict steps on.
  it("counts a thinned share as having bought its time only after fastS under the line", () => {
    const dip = (seconds: number) => {
      const governor = createWoodsGovernor();
      let at = burst(governor, 0, 3_000, 60);
      expect(governor.state().share).toBe(0.5);
      at = burst(governor, at, seconds * 1000, 30);
      burst(governor, at, 4_000, 55);
      return governor.state();
    };
    for (const seconds of [0.1, 1, 5, WOODS_GOVERNOR.fastS - 2]) {
      expect(dip(seconds)).toMatchObject({ share: 1, mode: "resting" });
    }
    for (const seconds of [WOODS_GOVERNOR.fastS + 2, 30]) {
      expect(dip(seconds)).toMatchObject({ share: 0.25, mode: "thinned" });
    }
  });

  // A step that once bought its time is not judged against the full woods
  // forever. Full at 60 ms steps to half; at half the phone runs at 45 ms
  // (between the lines: it stays); minutes later a denser district makes it
  // 55 ms at half. That is a phone still too slow, so it steps down a rung,
  // never back to the full woods with a five-minute rest.
  it("steps down a rung when a thinned share that had bought its time gets slow later", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 3_000, 60);
    expect(governor.state().share).toBe(0.5);
    at = burst(governor, at, 60_000, 45);
    expect(governor.state()).toMatchObject({ share: 0.5, mode: "thinned" });
    // Minutes later (idle wall time), a slow burst at half.
    burst(governor, at + 180_000, 4_000, 55);
    expect(governor.state()).toMatchObject({ share: 0.25, mode: "thinned" });
  });

  // At the fewest woods there is no rung left to buy time with: a quarter
  // that had bought its time and gets slow later stays a quarter (the
  // thinning still pays against the full woods), rather than re-taking the
  // baseline and judging its own next verdict worthless.
  it("stays at a quarter when a quarter that had bought its time gets slow later", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 8_000, (share) => (share === 1 ? 80 : 60));
    expect(governor.state().share).toBe(0.25);
    at = burst(governor, at, 30_000, 45);
    burst(governor, at + 180_000, 20_000, 55);
    expect(governor.state()).toMatchObject({ share: 0.25, mode: "thinned" });
  });

  // A pair of long frames says the device is slow, but only by the gap's
  // worth each in the verdict's seconds: the second of two hitches, 1.9 s
  // long, must not by itself fill the two slow seconds on an otherwise fast
  // device. The average sees the whole frame, so that a device whose every
  // frame is that long still reads as slow as it is (see the slow devices).
  it("credits at most gapMs of a long frame to the verdict, while the average sees all of it", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 5_000, 16.7);
    at += 300;
    governor.frame(at, true);
    at += 1_900;
    governor.frame(at, true);
    expect(governor.state().averageMs ?? 0).toBeGreaterThan(
      WOODS_GOVERNOR.slowMs,
    );
    burst(governor, at, 10_000, 16.7);
    expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
  });

  // A phone capped at 30 Hz delivers 33.3 ms frames: fast enough to get the
  // woods back once the rest is over, though never under 33 ms.
  it("gives the woods back to a 30 Hz phone (33.3 ms) after the rest", () => {
    const governor = createWoodsGovernor();
    let at = burst(governor, 0, 3_000, 60);
    expect(governor.state().share).toBe(0.5);
    at += WOODS_GOVERNOR.restS * 1000;
    burst(governor, at, 20_000, 1000 / 30);
    expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
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
    it(`steps down at ${ms} ms within about three seconds`, () => {
      const at = firstStepAt(createWoodsGovernor(), 60_000, ms);
      expect(at).toBeDefined();
      // The average starts at the first interval, so a steady frame above
      // the line is slow from the start: two counted seconds, plus one
      // ignored first frame when it is longer than `gapMs`.
      expect(at).toBeGreaterThanOrEqual(WOODS_GOVERNOR.slowS * 1000);
      expect(at).toBeLessThan(3_000);
    });
  }
});

/**
 * The step-up across steady frame times, after a thinning and its rest:
 * under `fastMs` (36 ms) the woods come back, a 30 Hz cap (33.3 ms)
 * included; between that and the 50 ms line the thinned share holds.
 */
describe("the step-up across steady frame times", () => {
  const thinnedAndRested = (): { governor: WoodsGovernor; at: number } => {
    const governor = createWoodsGovernor();
    // 60 ms at full, 20 ms at half: one step, and no slow time left over to
    // add a second verdict while the average decays to the swept value.
    const at =
      burst(governor, 0, 3_000, (share) => (share === 1 ? 60 : 20)) +
      WOODS_GOVERNOR.restS * 1000;
    expect(governor.state().share).toBe(0.5);
    return { governor, at };
  };
  for (const ms of [16.7, 25, 1000 / 30, 35]) {
    it(`gives the woods back at ${ms.toFixed(1)} ms`, () => {
      const { governor, at } = thinnedAndRested();
      burst(governor, at, 30_000, ms);
      expect(governor.state().share).toBe(1);
    });
  }
  for (const ms of [37, 40, 45, 49]) {
    it(`keeps the thinned share at ${ms} ms`, () => {
      const { governor, at } = thinnedAndRested();
      burst(governor, at, 60_000, ms);
      expect(governor.state().share).toBe(0.5);
    });
  }
});

/**
 * A device at 300 ms a frame or more still deserves fewer woods when they
 * are its cost. Each such frame credits only `gapMs` to the verdict, but the
 * average keeps the whole frame, so the worthwhile test sees what thinning
 * saved. Frame time here is `full * (1 - w + w * share)`: the woods are `w`
 * of the frame, so the half rung saves `w / 2`. From `w` 0.3 (15 percent
 * saved, the `worthwhile` line, which is what reverses the verdict) the
 * woods thin to a quarter, swept at 0.35-0.8; at `w` 0.2 (10 percent saved)
 * they come back and rest. Each rung is judged by its own frames (the
 * average starts afresh at a step), so at eight counted frames a verdict
 * the smoothing has no lag to hide the saving in. Swept over 150-2000 ms.
 */
describe("slow devices across frame times and woods shares", () => {
  const run = (full: number, w: number) => {
    const governor = createWoodsGovernor();
    let at = 0;
    let quarterAt: number | undefined;
    governor.frame(at, true);
    while (at < 600_000) {
      at += full * (1 - w + w * governor.state().share);
      governor.frame(at, true);
      if (quarterAt === undefined && governor.state().share === 0.25) {
        quarterAt = at;
      }
    }
    return { state: governor.state(), quarterAt };
  };
  // An upper bound on the time to the quarter: two verdicts of `slowS`, each
  // frame crediting at most `gapMs` (or its own length when shorter) and
  // lasting at most `full`, plus the first frame ignored as a lone gap and
  // one frame of rounding.
  const boundMs = (full: number): number =>
    ((2 * WOODS_GOVERNOR.slowS * 1000) / Math.min(full, WOODS_GOVERNOR.gapMs) +
      2) *
    full;
  for (const full of [150, 300, 400, 600, 1000, 2000]) {
    for (const w of [0.35, 0.5, 0.65, 0.8]) {
      it(`reaches the fewest woods at ${full} ms with woods ${w * 100} % of the frame`, () => {
        const { state, quarterAt } = run(full, w);
        expect(state).toMatchObject({ share: 0.25, mode: "thinned" });
        expect(quarterAt ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          boundMs(full),
        );
      });
    }
    it(`gives the woods back and rests at ${full} ms when they are 20 % of the frame`, () => {
      expect(run(full, 0.2).state).toMatchObject({ share: 1, mode: "resting" });
    });
  }
});

/**
 * The half rung after a purchase: full woods at `full` ms step to half, half
 * runs 45 ms for a minute (bought), then the device slows to a flat `later`
 * ms whatever the woods (heat, a heavier scene elsewhere). The half steps on
 * to a quarter; the quarter is judged against the full woods' baseline, so
 * it stays while `later` is under `(1 - worthwhile)` of `full` and gives the
 * woods back with a rest above it. That line is what reverses each verdict;
 * pairs within 1.5 ms of it are left out of the sweep. Swept over `full`
 * 60-150 ms, `later` 52-65 ms, and 30 and 120 s at the later frame time.
 */
describe("the half rung's later slowdown across baselines", () => {
  for (const seconds of [30, 120]) {
    for (const full of [60, 65, 70, 80, 100, 150]) {
      for (const later of [52, 55, 58, 60, 65]) {
        const line = full * (1 - WOODS_GOVERNOR.worthwhile);
        if (Math.abs(later - line) < 1.5) continue;
        const pays = later < line;
        it(`full ${full}, later ${later} for ${seconds} s: ${pays ? "stays at a quarter" : "full and resting"}`, () => {
          const governor = createWoodsGovernor();
          let at = 0;
          governor.frame(at, true);
          while (governor.state().share === 1 && at < 60_000) {
            at += full;
            governor.frame(at, true);
          }
          expect(governor.state().share).toBe(0.5);
          at = burst(governor, at, 60_000, 45);
          burst(governor, at, seconds * 1000, later);
          expect(governor.state()).toMatchObject(
            pays
              ? { share: 0.25, mode: "thinned" }
              : { share: 1, mode: "resting" },
          );
        });
      }
    }
  }
});

/**
 * Two hitches in a row on a fast device: the second one's length, swept from
 * 0.4 s to an hour, enters the average whole, yet each credits only `gapMs`
 * to the slow seconds, so the fast frames after them bring the average back
 * under the line before two slow seconds are reached. What reverses it: a
 * second hitch of about six hours (5.6 h holds, 6.1 h steps down), after
 * which the average takes long enough to fall under the line that, with the
 * second hitch's 0.25 s, it fills the two slow seconds.
 */
describe("two long frames in a row on a fast device", () => {
  for (const second of [400, 1_900, 10_000, 60_000, 600_000, 3_600_000]) {
    it(`does not thin after hitches of 300 ms and ${second} ms`, () => {
      const governor = createWoodsGovernor();
      let at = burst(governor, 0, 5_000, 16.7);
      at += 300;
      governor.frame(at, true);
      at += second;
      governor.frame(at, true);
      burst(governor, at, 10_000, 16.7);
      expect(governor.state()).toMatchObject({ share: 1, mode: "full" });
    });
  }
});
