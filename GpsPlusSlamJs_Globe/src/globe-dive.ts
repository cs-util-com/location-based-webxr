/**
 * The pin's dive (round-2 plan 2026-09-26-2055 M3g; the owner: "turns the
 * globe towards me and zooms in over about 15 s"): from wherever the camera
 * is, turn to the target and descend to the hand-over altitude. Pure: time
 * in, a turn fraction and an altitude out; the lab turns them into a pose.
 *
 * @see globe-dive.ts.md
 */

import { smoothstep } from "./globe-camera.js";

export const GLOBE_DIVE = {
  /** The whole dive, turn and descent (the owner's "about 15 s"). */
  durationMs: 15_000,
  /**
   * Where the city takes over: 150 km, the least soft of the round-2 sweep
   * {20, 50, 150} km with the committed z4 imagery (round-2 §6 Q1).
   */
  handOverAltitudeM: 150_000,
  /**
   * The share of the dive spent turning towards the target; the descent
   * runs through the whole dive, so the turn is done while the camera is
   * still high and the last stretch only descends.
   */
  turnShare: 0.4,
} as const;

/** One instant of a dive. */
export interface DiveFrame {
  /** The eased fraction of the turn, 0 to 1 (for `turnPose`). */
  readonly turnT: number;
  /** The camera's height above the target's surface point, metres. */
  readonly altitudeM: number;
  /** Whether the dive has reached its end. */
  readonly done: boolean;
}

/**
 * The dive `elapsedMs` after it began. The altitude moves from
 * `fromAltitudeM` to `toAltitudeM` evenly in its logarithm (every halving
 * takes as long as the one before), eased at both ends by `smoothstep`, so
 * it never reverses and a descent reads as a steady fall towards the
 * ground. The turn runs over the first `turnShare` of the dive, eased. The
 * ends are exact and held outside [0, durationMs].
 *
 * RangeError for a duration or an altitude that is not a positive number.
 */
export function diveAt(
  elapsedMs: number,
  options: {
    readonly durationMs: number;
    readonly fromAltitudeM: number;
    readonly toAltitudeM: number;
    readonly turnShare?: number;
  },
): DiveFrame {
  const { durationMs, fromAltitudeM, toAltitudeM } = options;
  const turnShare = options.turnShare ?? GLOBE_DIVE.turnShare;
  for (const [name, value] of [
    ["durationMs", durationMs],
    ["fromAltitudeM", fromAltitudeM],
    ["toAltitudeM", toAltitudeM],
  ] as const) {
    if (!(value > 0 && Number.isFinite(value))) {
      throw new RangeError(`${name} must be a positive number, got ${value}`);
    }
  }
  if (!(turnShare > 0 && turnShare <= 1)) {
    throw new RangeError(`turnShare must be in (0, 1], got ${turnShare}`);
  }
  const t = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
  if (t >= 1) return { turnT: 1, altitudeM: toAltitudeM, done: true };
  if (t <= 0) return { turnT: 0, altitudeM: fromAltitudeM, done: false };
  const eased = smoothstep(t);
  return {
    turnT: smoothstep(t / turnShare),
    altitudeM: fromAltitudeM * (toAltitudeM / fromAltitudeM) ** eased,
    done: false,
  };
}
