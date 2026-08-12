/**
 * What AR mode reports about itself — the numbers, formatted.
 *
 * **WHY MILESTONE 4 NEEDS AN INSTRUMENT BEFORE IT NEEDS A MEASUREMENT.** §4
 * makes four predictions ("GPS fix quality, not rendering, is the binding
 * constraint"; "the Y-baseline jump will be visible"; "nothing will z-fight";
 * "the alignment will look good enough to be pleasant and not good enough to
 * measure") and the plan is explicit that they are stated so they can be wrong
 * in public. None of them can be checked from a desk: they need a phone, in a
 * street, showing its own numbers.
 *
 * The desktop status line already reports draw cost — and it reports
 * `BuildingView`'s renderer, which is **not the one AR draws with**. The
 * framework's session builds a second `WebGLRenderer`, and `renderer.info` is
 * per-renderer, so the number on screen during a session would describe a
 * renderer that is not producing the frames. The plan names this outright:
 * "Needs a draw-cost readout on the AR renderer, which does not exist."
 *
 * **PURE, for the same reason `draw-cost.ts` is**: `renderer.info` needs a
 * `WebGLRenderer`, so the values come from the caller and the SENTENCE is built
 * here, where it can be pinned without a GPU.
 *
 * @see ar-measurements.ts.md
 */

import { describeDrawCost, type DrawCost } from "./draw-cost.js";

/** Everything the AR readout can show. Every field optional and independent. */
export interface ArMeasurements {
  /** From the AR renderer's `info.render` — NOT the desktop view's. */
  readonly drawCost?: DrawCost | undefined;
  /**
   * Frames per second, AVERAGED over the sampling window.
   *
   * The average is the caller's job and it is not optional. A single frame's
   * `1/dt` spikes routinely on a phone — GC, a worker message, the terrain
   * field landing — so at a 2 Hz readout the reciprocal of one arbitrary frame
   * out of thirty flickers between plausible and alarming with no way to tell a
   * sustained drop from a hiccup. Telling those apart is exactly what §4's "is
   * rendering the constraint?" question needs.
   */
  readonly fps?: number | undefined;
  /** The last fix's reported horizontal accuracy, metres. */
  readonly fixAccuracyM?: number | undefined;
  /** How far the user is from where the session was anchored, metres. */
  readonly metresFromAnchor?: number | undefined;
  /**
   * The alignment's vertical term — `arWorldGroup.matrix[13]`, metres.
   *
   * **THE AXIS BOTH OPEN QUESTIONS LIVE ON** (r510 review). §4 predicts "the
   * Y-baseline jump will be visible" and names this element as the term that
   * causes it; §2.5 asks how the DEM relief and the session's own ground-plane
   * estimate blend. Neither is answerable from a photograph, and neither was
   * answerable at all until this number was on screen — a milestone called
   * "measure, then choose" that could not see the axis its own predictions are
   * about would have shipped an instrument with a hole in it.
   */
  readonly worldBaselineY?: number | undefined;
}

/**
 * One line per measurement that has a value, in a fixed order.
 *
 * **LINES RATHER THAN A SENTENCE**, unlike the desktop status line. This is read
 * at arm's length, outdoors, over a camera feed, by someone who is walking — a
 * single run-on string is unreadable there, and the reader is looking for one
 * number at a time rather than an overview.
 *
 * **A MISSING VALUE IS OMITTED, NEVER SHOWN AS ZERO.** "No fix accuracy yet" and
 * "an accuracy of 0 m" are different claims and the second is impossible; a
 * readout that renders unmeasured things as `0` is how a measurement session
 * produces confident wrong numbers. `describeDrawCost` already makes the same
 * distinction for the same reason.
 */
export function describeArMeasurements(
  measurements: ArMeasurements,
): readonly string[] {
  const lines: string[] = [];

  const cost = describeDrawCost(measurements.drawCost);
  if (cost !== "") lines.push(cost);

  if (isUsable(measurements.fps)) {
    lines.push(`${Math.round(measurements.fps)} fps`);
  }

  if (isUsable(measurements.fixAccuracyM)) {
    // ONE DECIMAL BELOW 10 m, none above. The interesting distinction near the
    // bottom of the range is 4.5 versus 8 m; at 30 m nobody cares about the
    // tenth, and the extra digit reads as precision the fix does not have.
    const accuracy =
      measurements.fixAccuracyM < 10
        ? measurements.fixAccuracyM.toFixed(1)
        : Math.round(measurements.fixAccuracyM).toString();
    lines.push(`fix ±${accuracy} m`);
  }

  if (isUsable(measurements.metresFromAnchor)) {
    // METRES UNDER A KILOMETRE, kilometres above. The far-travel warning speaks
    // in kilometres because it fires at 2 km; this line is live from the first
    // step, where "0.0 km" would be useless.
    const distance =
      measurements.metresFromAnchor < 1000
        ? `${Math.round(measurements.metresFromAnchor)} m`
        : `${(measurements.metresFromAnchor / 1000).toFixed(1)} km`;
    lines.push(`${distance} from anchor`);
  }

  if (
    measurements.worldBaselineY !== undefined &&
    Number.isFinite(measurements.worldBaselineY)
  ) {
    // NOT filtered on `>= 0`, unlike the others: this one is SIGNED and the
    // sign is the information. A baseline below zero means the alignment has
    // put the world under the user, which is precisely the failure §4 predicts
    // will be visible.
    //
    // Centimetres, because the question is whether it JUMPS. A metre of drift
    // over a walk is expected; ten centimetres between two glances is not, and
    // whole metres would hide it.
    lines.push(`baseline ${measurements.worldBaselineY.toFixed(2)} m`);
  }

  return lines;
}

/**
 * Present, finite and not negative.
 *
 * Non-finite is the realistic case rather than a theoretical one: an fps
 * computed from a zero `dt` is `Infinity`, and the framework hands `dt: 0` on
 * the first frame after a reset by documented contract.
 */
function isUsable(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
