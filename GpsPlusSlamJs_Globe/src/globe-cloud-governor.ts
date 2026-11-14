/**
 * The near clouds' step-down: a device too slow for its tier first draws
 * fewer cloud pixels and only as a last resort steps down to low. No phone
 * was measured for the tiers, so this is the rule that holds for a device
 * nobody tested; a choice made by hand switches it off.
 *
 * It watches the smoothed time between frames. Slow for a while lowers the
 * pixel scale one step, which keeps the clouds' shape (the field's filter
 * does not follow the pixels). At the lowest scale the tier falls to low,
 * whose own numbers are cheaper, and the scale starts over. Fast for much
 * longer gives pixels back, never the tier: a device that needed low once
 * will again, and a tier that flips is what a hunt looks like. A step given
 * back that is slow again at once is not offered again for `restS`.
 *
 * Frame times alone cannot tell a slow device from a capped one (a 30 Hz
 * screen, a saving mode), so the step-down is its own test: when the fewest
 * pixels bought less than `worthwhile`, the pixels were not the cost, all of
 * them come back and it rests for `restS`: long enough that a capped screen
 * sees the test rarely, short enough that a device that gets slower later
 * still steps down. A rung that held the average under `slowMs` for `fastS`
 * has bought its time, so a later slow verdict there is a new one. At the
 * fewest pixels the tier falls to low instead of the steps being judged
 * against the average from before them. Higher up the steps left go on, and
 * at the fewest pixels the test reads the full baseline; when it finds them
 * worthless the baseline is from before the device changed (a phone heating
 * up), so every pixel comes back without the rest and the next step down
 * takes a new one. At low with the fewest pixels no rung is left, so the
 * test runs as always.
 *
 * A frame enters the average at its whole length but credits the verdicts
 * at most `gapMs` of time, so a pair of hitches cannot make a verdict. Once
 * a rung has bought its time, only frames over `slowMs` fill a slow verdict,
 * so a run of hitches cannot either: the short frames after them, while the
 * average comes back down, are not slow.
 *
 * @see globe-cloud-governor.ts.md
 */
import type { GlobeQualityName } from "./globe-quality.js";

export const CLOUD_GOVERNOR = Object.freeze({
  /** Slower than this for `slowS` steps down (ms: 45 fps). */
  slowMs: 22,
  /** Faster than this for `fastS` gives back a step (ms). A 60 Hz screen
   *  stops at 16.7, so this reads "not late", not a frame rate. */
  fastMs: 18,
  /** How long a verdict must hold (s). */
  slowS: 2,
  fastS: 12,
  /** What the new tier gets to prove itself before the next verdict (s). */
  settleS: 10,
  /** One step of the pixel scale. */
  step: 0.1,
  /** The lowest pixel scale. */
  minPixelScale: 0.5,
  /** The steps from 1 to the lowest. */
  steps: 5,
  /** The share of the frame time the fewest pixels must save. */
  worthwhile: 0.15,
  /** How long the step-down rests after pixels that bought nothing (s). */
  restS: 300,
  /** How much of a frame reaches the average. */
  smoothing: 0.1,
  /** One frame this long says nothing of the device (ms); two in a row do:
   *  a device this slow is the one the step-down is for. A counted frame
   *  enters the average at its whole length (capped there, frames over it
   *  would hide what fewer pixels save, and a device that slow would never
   *  reach low) and the verdicts' seconds at most at this length. */
  gapMs: 250,
});

export interface GlobeCloudGovernor {
  /** Takes the time since the frame before (ms). */
  frame(ms: number): void;
  /** The pixel scale and the tier now. */
  state(): { pixelScale: number; tier: GlobeQualityName };
}

/** The step-down from `tier`; with `auto` false it changes nothing. */
export function createGlobeCloudGovernor(
  tier: GlobeQualityName,
  { auto = true }: { readonly auto?: boolean } = {},
): GlobeCloudGovernor {
  const G = CLOUD_GOVERNOR;
  let scaleSteps = 0;
  let current = tier;
  let average = 0;
  let slowFor = 0;
  let fastFor = 0;
  /** The average when the pixels began to fall. */
  let slowAt = 0;
  /** This rung held the average under `slowMs` for `fastS`. */
  let bought = false;
  /** The time credited under `slowMs` at this rung (s). */
  let boughtFor = 0;
  /** A middle rung bought its time since `slowAt` was taken. */
  let stale = false;
  /** The rung given back last, until the next step down. */
  let backFrom = -1;
  /** How long a give-back still waits (s). */
  let holdFor = 0;
  let gapBefore = false;
  /** The rest still to run (s). */
  let restFor = 0;

  /** A new pixel scale: what the rung bought starts over. */
  const setSteps = (steps: number) => {
    scaleSteps = steps;
    bought = false;
    boughtFor = 0;
  };

  /** The baseline at every pixel; a middle rung that bought its time
   *  since makes it stale. */
  const noteBaseline = (skip: boolean) => {
    if (scaleSteps === 0) {
      slowAt = average;
      stale = false;
    } else if (skip && scaleSteps < G.steps) {
      stale = true;
    }
  };

  /** One step fewer; landing on the rung just given back holds it. */
  const lowerPixels = () => {
    if (scaleSteps + 1 === backFrom) holdFor = G.restS;
    backFrom = -1;
    setSteps(scaleSteps + 1);
  };

  /** The fewest pixels bought nothing: every pixel back, and a rest unless
   *  the baseline is stale, which the next step down takes again. */
  const worthless = () => {
    setSteps(0);
    if (stale) stale = false;
    else restFor = G.restS;
  };

  const stepDown = () => {
    if (restFor > 0) return;
    const skip = bought && !(current === "low" && scaleSteps === G.steps);
    bought = false;
    noteBaseline(skip);
    if (scaleSteps < G.steps) {
      lowerPixels();
    } else if (!skip && average > slowAt * (1 - G.worthwhile)) {
      worthless();
    } else if (current !== "low") {
      current = "low";
      setSteps(0);
      slowFor = -G.settleS;
    }
  };

  const stepUp = () => {
    if (scaleSteps === 0 || holdFor > 0) return;
    backFrom = scaleSteps;
    setSteps(scaleSteps - 1);
  };

  /** Time under `slowMs` at a lowered rung, until it bought its time. */
  const countBought = (seconds: number) => {
    if (scaleSteps === 0 || average >= G.slowMs) return;
    boughtFor += seconds;
    if (boughtFor >= G.fastS) bought = true;
  };

  /** One counted frame of `ms`, crediting `seconds` (at most `gapMs`). */
  const judge = (ms: number, seconds: number) => {
    countBought(seconds);
    restFor = Math.max(0, restFor - seconds);
    holdFor = Math.max(0, holdFor - seconds);
    const credit = !bought || ms > G.slowMs ? seconds : 0;
    slowFor = average > G.slowMs ? slowFor + credit : 0;
    fastFor = average < G.fastMs ? fastFor + seconds : 0;
    if (slowFor >= G.slowS) {
      slowFor = 0;
      stepDown();
    } else if (fastFor >= G.fastS) {
      fastFor = 0;
      stepUp();
    }
  };

  return {
    frame(ms) {
      if (!auto || !(ms > 0)) return;
      const gap = ms > G.gapMs;
      const alone = gap && !gapBefore;
      gapBefore = gap;
      if (alone) return;
      average = average === 0 ? ms : average + (ms - average) * G.smoothing;
      judge(ms, Math.min(ms, G.gapMs) / 1000);
    },
    state: () => ({
      pixelScale: Math.max(G.minPixelScale, 1 - scaleSteps * G.step),
      tier: current,
    }),
  };
}
