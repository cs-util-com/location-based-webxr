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

/** A repeatable stream of numbers in [0, 1), so a swept scenario with
 *  random frames is the same scenario on every run. */
function numbers(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Frames from `next` for `seconds`. */
function runFor(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  next: () => number,
  seconds: number,
) {
  for (let t = 0; t < seconds * 1000;) {
    const ms = next();
    governor.frame(ms);
    t += ms;
  }
}

/** Two counted hitches of `ms` in a row (one alone is a gap). */
function hitchPair(
  governor: ReturnType<typeof createGlobeCloudGovernor>,
  ms: number,
) {
  governor.frame(ms);
  governor.frame(ms);
}

/** One-step give-backs from 300 to 900 s on a device whose frame is
 *  `fixed + clouds * scale^a` (60 % of the clouds at low), optionally
 *  rounded up to the next 16.7 ms vsync. */
function giveBacks(fixed: number, clouds: number, a: number, vsync: boolean) {
  const governor = createGlobeCloudGovernor("high");
  let backs = 0;
  let before = governor.state();
  for (let t = 0; t < 900_000;) {
    const share = before.tier === "low" ? 0.6 : 1;
    const raw = fixed + share * clouds * before.pixelScale ** a;
    const ms = vsync ? Math.ceil(raw / 16.667 - 1e-9) * 16.667 : raw;
    governor.frame(ms);
    t += ms;
    const after = governor.state();
    const back = after.pixelScale - before.pixelScale;
    const counted = t > 300_000 && after.tier === before.tier;
    if (counted && back > 0 && back < CLOUD_GOVERNOR.step * 1.5) backs++;
    before = after;
  }
  return backs;
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
  // The bound is derived: a frame credits at most `gapMs`, so a verdict takes
  // `slowS / gapMs` frames; six verdicts (five steps and the tier) at the
  // pixel scale of each, plus the first frame, which is a gap. One frame at
  // every pixel is the margin for the sum of the frames.
  it("steps down on frames of seconds, in a row", () => {
    const G = CLOUD_GOVERNOR;
    const frame = 2600;
    const perVerdict = Math.ceil((G.slowS * 1000) / G.gapMs);
    let expected = frame;
    for (let i = 0; i <= G.steps; i++)
      expected +=
        perVerdict * frame * Math.max(G.minPixelScale, 1 - i * G.step);
    const bound = expected + frame;
    const governor = createGlobeCloudGovernor("high");
    runOnPixels(governor, frame, 40);
    expect(governor.state().pixelScale).toBeLessThan(1);
    runOnPixels(governor, frame, bound / 1000 - 40);
    expect(governor.state().tier).toBe("low");
  });

  describe("a slowdown after the pixels bought their time", () => {
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
    // up, a slowdown the pixels do not cause (a denser deck at a flat cost)
    // must not send the device to low on a baseline from the last rung or two,
    // nor rest on one from before the device changed: the steps left end where
    // the full baseline says, low at or under `baseline * (1 - worthwhile)`,
    // every pixel back above it.
    // Sweep: baselines 22.5-40 ms, bought at rungs 1-5 at 19 and 21 ms, later
    // 18-30 ms flat, for a minute. Under `slowMs` nothing is judged and the
    // tier stays; at the fewest pixels a step that bought its time falls to
    // low. What reverses it: a later time on the other side of the line.
    for (const baseline of [22.5, 24, 26, 30, 35, 40]) {
      for (let rung = 1; rung <= CLOUD_GOVERNOR.steps; rung++) {
        it(`ends a flat slowdown after rung ${rung} bought its time as the full baseline says (${baseline} ms)`, () => {
          const wrong: string[] = [];
          for (const bought of [19, 21]) {
            for (const later of [18, 20, 22.5, 23, 24, 25, 26, 27, 28, 30]) {
              const governor = createGlobeCloudGovernor("high");
              downTo(governor, baseline, 1 - rung * CLOUD_GOVERNOR.step);
              run(governor, bought, 60);
              run(governor, later, 60);
              const { pixelScale, tier } = governor.state();
              const expected =
                later <= CLOUD_GOVERNOR.slowMs
                  ? "high"
                  : rung === CLOUD_GOVERNOR.steps ||
                      later <= baseline * (1 - CLOUD_GOVERNOR.worthwhile)
                    ? "low"
                    : "high at 1";
              const got =
                expected === "high at 1" && tier === "high" && pixelScale === 1
                  ? "high at 1"
                  : tier;
              if (got !== expected)
                wrong.push(
                  `${bought} -> ${later} ms: ${tier} at ${pixelScale}`,
                );
            }
          }
          expect(wrong).toEqual([]);
        });
      }
    }

    // Why this test matters: a phone that heats up multiplies its frame time.
    // When it had bought its time at a middle rung and then got slow, the
    // fewest pixels were judged against the baseline from before the heat,
    // read as worthless and rested five minutes at every pixel, the slowest
    // the device can draw. Wherever the fewest pixels genuinely pay under the
    // heat (slower than `slowMs` and at least `worthwhile` cheaper than every
    // pixel), the device must reach low within 100 s.
    // Device: frame = k * (fixed + clouds * scale^a) for 120 s at k = 1, then
    // at k. Sweep: a 1 and 2, baselines 24-40 ms, fixed share 0-0.6, k 1.2-2.5
    // (most settle at rungs 1-4 first). What reverses it: a fewest-pixel
    // saving under `worthwhile`, which rests as a capped screen does.
    for (const a of [1, 2]) {
      for (const baseline of [24, 26, 30, 35, 40]) {
        it(`reaches low when a phone heats up after buying its time (a ${a}, ${baseline} ms)`, () => {
          const late: string[] = [];
          for (const fixedShare of [0, 0.2, 0.4, 0.6]) {
            const fixed = baseline * fixedShare;
            const clouds = baseline - fixed;
            for (const k of [1.2, 1.4, 1.6, 1.8, 2, 2.5]) {
              const full = k * (fixed + clouds);
              const fewest =
                k * (fixed + clouds * CLOUD_GOVERNOR.minPixelScale ** a);
              if (
                fewest <= CLOUD_GOVERNOR.slowMs ||
                (full - fewest) / full < CLOUD_GOVERNOR.worthwhile
              )
                continue;
              const governor = createGlobeCloudGovernor("high");
              const frame = (heat: number) =>
                heat * (fixed + clouds * governor.state().pixelScale ** a);
              for (let t = 0; t < 120_000;) {
                const ms = frame(1);
                governor.frame(ms);
                t += ms;
              }
              const settled = governor.state().pixelScale;
              for (let t = 0; t < 100_000 && governor.state().tier !== "low";) {
                const ms = frame(k);
                governor.frame(ms);
                t += ms;
              }
              if (governor.state().tier !== "low")
                late.push(`share ${fixedShare}, k ${k}, settled at ${settled}`);
            }
          }
          expect(late).toEqual([]);
        });
      }
    }
  });

  describe("hitches and startup jank", () => {
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

    // Why this test matters: two hitches are covered above; a run of them
    // after the fewest pixels have long bought their time is the same event
    // (a collection, a tile decode, a shader compile) and cost the tier for
    // the view's life: the hitches left the smoothed average over `slowMs` for
    // many short frames after them, and those frames filled the slow verdict.
    // Sweep: frames before and after 16.7-21.8 ms (under `slowMs`); 3-6 frames
    // of 1.7-10 s, 5-8 frames of 0.3-0.8 s, 1.5 s of 100-250 ms frames. What
    // reverses it: slow frames for `slowS` of their own, which is a device
    // that got slow, not a hitch.
    for (const end of [16.7, 19, 20.5, 21.5, 21.8]) {
      it(`keeps the tier through runs of hitches after the fewest pixels bought their time (${end} ms frames)`, () => {
        const runs: [
          string,
          (g: ReturnType<typeof createGlobeCloudGovernor>) => void,
        ][] = [];
        for (const count of [3, 4, 6])
          for (const ms of [1700, 2500, 4000, 10_000])
            runs.push([
              `${count} x ${ms} ms`,
              (g) => {
                for (let i = 0; i < count; i++) g.frame(ms);
              },
            ]);
        for (const count of [5, 6, 8])
          for (const ms of [300, 500, 800])
            runs.push([
              `${count} x ${ms} ms`,
              (g) => {
                for (let i = 0; i < count; i++) g.frame(ms);
              },
            ]);
        for (const ms of [100, 150, 200, 250])
          runs.push([`1.5 s of ${ms} ms`, (g) => run(g, ms, 1.5)]);
        const lost: string[] = [];
        for (const [name, hitches] of runs) {
          const governor = createGlobeCloudGovernor("high");
          downTo(governor, 30);
          run(governor, end, 60);
          hitches(governor);
          run(governor, end, 30);
          if (governor.state().tier !== "high") lost.push(name);
        }
        expect(lost).toEqual([]);
      });
    }

    // Why this test matters: a fast phone janks while it starts (shaders,
    // tiles, the first collections). A single smoothed frame under `slowMs`
    // between janky ones read as the pixels having bought their time, and a
    // short burst of slow frames later then sent the phone to low for the
    // view's life. Time under `slowMs` counts only once it held for `fastS`.
    // Sweep: 10, 25 and 50 % janky frames of 17-150 ms (35, 60 and 100 ms,
    // each times 0.5-1.5) for 4-20 s, 5 s of 16.7 ms frames with an 80 ms one
    // now and then, then 3 s of 40-80 ms frames; eight seeds each. The
    // assertion is the burst's: a jank long and heavy enough to send the phone
    // to low by itself is a slow device for that long. What reverses it: a
    // burst of `fastS` or longer, which is a slowdown, not a burst.
    for (const share of [0.1, 0.25, 0.5]) {
      it(`does not send a fast phone to low for a burst after startup jank (${share * 100} % janky frames)`, () => {
        const lost: string[] = [];
        for (const seconds of [4, 8, 12, 16, 20]) {
          for (const jank of [35, 60, 100]) {
            for (let seed = 1; seed <= 8; seed++) {
              const next = numbers(
                seed * 1000 + seconds * 17 + jank + share * 99,
              );
              const governor = createGlobeCloudGovernor("high");
              runFor(
                governor,
                () => (next() < share ? jank * (0.5 + next()) : 16.7),
                seconds,
              );
              runFor(governor, () => (next() < 0.01 ? 80 : 16.7), 5);
              if (governor.state().tier === "low") continue;
              runFor(governor, () => 40 + 40 * next(), 3);
              run(governor, 16.7, 60);
              if (governor.state().tier === "low")
                lost.push(`${seconds} s of ${jank} ms, seed ${seed}`);
            }
          }
        }
        expect(lost).toEqual([]);
      });
    }
  });

  describe("at low and at the line", () => {
    // Why this test matters: at low with the fewest pixels no rung is left, so
    // a step that bought its time skips nothing there: the worthwhile test
    // runs as always against low's own full pixels. Under the line the fewest
    // pixels pay and stay; over it they were not the cost, every pixel comes
    // back and it rests, still at low. Without that guard the first verdict
    // at low is skipped as if a rung were left, and the answer comes a verdict
    // late: the check after one and a half verdicts sees that.
    // Sweep: later 22.5-30 ms against a low baseline of 30 ms; the line is
    // `30 * (1 - worthwhile)` = 25.5. What reverses it: a later time on the
    // other side of the line.
    for (const later of [22.5, 24, 25, 27, 30]) {
      it(`at low with the fewest pixels judges a later slowdown against low's own baseline (${later} ms)`, () => {
        const governor = createGlobeCloudGovernor("low");
        downTo(governor, 30);
        run(governor, 19, 60);
        const expected = {
          pixelScale:
            later <= 30 * (1 - CLOUD_GOVERNOR.worthwhile)
              ? CLOUD_GOVERNOR.minPixelScale
              : 1,
          tier: "low",
        };
        run(governor, later, CLOUD_GOVERNOR.slowS * 1.5);
        expect(governor.state()).toEqual(expected);
        run(governor, later, 30);
        expect(governor.state()).toEqual(expected);
      });
    }

    // Why this test matters: a device whose clouds sit right at the line
    // (fast at one rung, slow at the next, or rounded by vsync to 16.7 and
    // 33.3 ms) got a step back every `fastS`, was slow at once and lost it
    // again: about 40 give-backs in ten minutes, a flicker of the clouds'
    // sharpness. A step that was slow again right after it came back rests
    // `restS` before it is offered again.
    // Device: frame = fixed + clouds * scale^a, optionally rounded up to
    // 16.7 ms; sweep a 1 and 2, baselines 22.5-60 ms, fixed share 0-0.6. The
    // bound: one give-back per `restS` in the ten minutes after settling.
    // What reverses it: a rest shorter than the ten minutes' share.
    for (const vsync of [false, true]) {
      for (const a of [1, 2]) {
        const name = vsync ? `a ${a}, vsync` : `a ${a}`;
        it(`does not hunt between two rungs (${name})`, () => {
          const bound = Math.ceil(600 / CLOUD_GOVERNOR.restS);
          const hunting: string[] = [];
          for (let baseline = 22.5; baseline <= 60; baseline += 2.5) {
            for (const fixedShare of [0, 0.2, 0.4, 0.6]) {
              const fixed = baseline * fixedShare;
              const backs = giveBacks(fixed, baseline - fixed, a, vsync);
              if (backs > bound)
                hunting.push(`${baseline} ms, share ${fixedShare}: ${backs}`);
            }
          }
          expect(hunting).toEqual([]);
        });
      }
    }
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
