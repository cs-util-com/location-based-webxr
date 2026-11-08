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
 * will again, and a tier that flips is what a hunt looks like.
 *
 * Frame times alone cannot tell a slow device from a capped one (a 30 Hz
 * screen, a saving mode), so the step-down is its own test: when the fewest
 * pixels bought less than `worthwhile`, the pixels were not the cost, all of
 * them come back and it rests for `restS`: long enough that a capped screen
 * sees the test rarely, short enough that a device that gets slower later
 * (a phone heating up) still steps down.
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
   *  a device this slow is the one the step-down is for. */
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
  let gapBefore = false;
  /** The rest still to run (s). */
  let restFor = 0;

  const stepDown = () => {
    if (restFor > 0) return;
    if (scaleSteps === 0) slowAt = average;
    if (scaleSteps < G.steps) {
      scaleSteps += 1;
    } else if (average > slowAt * (1 - G.worthwhile)) {
      scaleSteps = 0;
      restFor = G.restS;
    } else if (current !== "low") {
      current = "low";
      scaleSteps = 0;
      slowFor = -G.settleS;
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
      const seconds = ms / 1000;
      restFor = Math.max(0, restFor - seconds);
      slowFor = average > G.slowMs ? slowFor + seconds : 0;
      fastFor = average < G.fastMs ? fastFor + seconds : 0;
      if (slowFor >= G.slowS) {
        slowFor = 0;
        stepDown();
      } else if (fastFor >= G.fastS) {
        fastFor = 0;
        scaleSteps = Math.max(0, scaleSteps - 1);
      }
    },
    state: () => ({
      pixelScale: Math.max(G.minPixelScale, 1 - scaleSteps * G.step),
      tier: current,
    }),
  };
}
