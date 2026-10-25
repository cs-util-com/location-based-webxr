/**
 * Where a visit's OWN GPS puts a code, with every code's votes left out.
 *
 * WHY. A visit that a stored code lined up keeps that code's votes in its
 * GPS history: they are re-cast with every device fix while the code is
 * held, so the store's alignment at the visit's end is held by the code.
 * The code seen through that alignment sits where it is stored, by
 * construction. Read as a measurement it would confirm the stored position
 * and stamp it with this walk's GPS quality, while the walk never judged
 * it. This module is the visit's independent view: the rigid fit the
 * moved-code check already uses (`estimateCodeDisplacement`, a 2D least
 * squares of yaw and shift over the device fixes), turned into an
 * alignment the settle can read codes through and re-mint them with.
 *
 * THE FIT IS THE WALK'S OWN. With a turn fitted (the fixes spread at least
 * the moved-code rule's minimum), the least-squares rigid map of the
 * odometry onto the fixes is unique, so the result does not depend on the
 * reference alignment it is composed onto - only its height does. The
 * height stays the reference's: the fit is horizontal, and a code's stored
 * height is kept rather than replaced by GPS altitude.
 *
 * THE LOOP CLOSURE. The phone's tracking drifts along a walk, so a code
 * seen at the start and again at the end of it shows up at two odometry
 * spots, apart by the drift. The fit is made over the fixes in between,
 * which carry about half of it on average, so it is read at the midpoint
 * of the two sightings rather than at the last one. Read at the last
 * sighting it would carry the whole drift. It acts on odometry poses and
 * device fixes only: no code's votes enter it.
 *
 * Pure.
 *
 * @see code-device-fit.ts.md
 */

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { Matrix4 } from "three";

import {
  CODE_MOVE_ESTIMATOR,
  CODE_MOVE_RULE,
  estimateCodeDisplacement,
  pinCode,
  type DisplacementSample,
} from "./code-displacement.js";
import { isReliable, type PositionQuality } from "./code-position-rule.js";
import {
  codeCorrection,
  throughAlignment,
  type NuePose,
} from "./visit-anchoring.js";

/** A visit's alignment refitted from its device fixes. */
export interface DeviceFit {
  /** Odometry-NUE to GPS-world NUE, column-major: the fit's yaw and shift,
   *  the reference's height. */
  readonly alignment: number[];
  /** The device fixes it rests on. */
  readonly samples: number;
  /** Their RMS spread about their centroid (m). */
  readonly spreadM: number;
}

const ODOMETRY_ORIGIN: NuePose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

/**
 * The visit's alignment from its device fixes alone.
 *
 * @param samples the visit's device fixes (`displacementSamples`: the
 *   votes are already filtered out)
 * @param reference any alignment of the visit, odometry-NUE to world-NUE
 *   (yaw-only, as the solver's are): the frame the fit is composed onto
 * @returns null without a readable reference, without fixes, or when the
 *   fixes spread less than the moved-code rule's minimum - no turn is
 *   fitted then, and the reference's heading would stand in for one.
 */
export function deviceFitAlignment(
  samples: readonly DisplacementSample[],
  reference: ArrayLike<number>,
): DeviceFit | null {
  const at = throughAlignment(ODOMETRY_ORIGIN, reference);
  const base = at === null ? null : codeCorrection(ODOMETRY_ORIGIN, at);
  const pin = at === null ? null : pinCode(ODOMETRY_ORIGIN, at);
  if (base === null || pin === null) return null;
  const est = estimateCodeDisplacement(samples, pin, CODE_MOVE_ESTIMATOR);
  if (est === null || !(est.spreadM >= CODE_MOVE_RULE.minSpreadM)) {
    return null;
  }
  // The fit maps a point p of the pinned frame to R (p - code) + code + d,
  // in [north, east]: north' = c n - s e, east' = s n + c e. Up is left
  // alone.
  const yaw = (est.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const [codeN, codeE] = pin.code;
  const [dN, dE] = est.displacementM;
  const tN = codeN + dN - (c * codeN - s * codeE);
  const tE = codeE + dE - (s * codeN + c * codeE);
  // Column-major.
  const turn = new Matrix4().fromArray([
    c,
    0,
    s,
    0,
    0,
    1,
    0,
    0,
    -s,
    0,
    c,
    0,
    tN,
    0,
    tE,
    1,
  ]);
  const alignment = turn.multiply(new Matrix4().fromArray(base)).toArray();
  if (!alignment.every(Number.isFinite)) return null;
  return { alignment, samples: est.samples, spreadM: est.spreadM };
}

/**
 * The settle's gate on {@link deviceFitAlignment}: the visit's fit only
 * when its walk could measure a code at all - at least the mint's minimum
 * of device fixes (`MIN_ALIGNMENT_SAMPLES`), a walk reliable for its
 * accuracy (`isReliable`, the keep-or-replace rule's own test), and one
 * odometry frame throughout (a tracking restart mixes two frames, so no
 * rigid fit describes the walk).
 *
 * @param quality the visit's device-only walk and accuracy
 */
export function codeDeviceFit(input: {
  readonly samples: readonly DisplacementSample[];
  readonly reference: ArrayLike<number>;
  readonly quality: PositionQuality;
  readonly frameChanged: boolean;
}): DeviceFit | null {
  if (
    input.frameChanged ||
    input.samples.length < MIN_ALIGNMENT_SAMPLES ||
    !isReliable(input.quality)
  ) {
    return null;
  }
  return deviceFitAlignment(input.samples, input.reference);
}

/** One kept sighting of a code: when, and its raw WebXR odometry pose. */
export interface FitSighting {
  readonly atMs: number;
  readonly odomPose: Pose;
}

/**
 * The code's odometry pose to read a device fit at: the midpoint of its
 * first and last sightings when they bracket every fix of the fit (seen
 * before the first fix and after the last - the loop is closed), else its
 * latest sighting. The heading is always the latest sighting's. Raw WebXR
 * and odometry-NUE differ by a fixed basis change, so the midpoint is the
 * same in either.
 *
 * @param sightings oldest first
 * @param samples the fixes the fit rests on
 * @returns null without a sighting
 */
export function codeFitPose(
  sightings: readonly FitSighting[],
  samples: readonly DisplacementSample[],
): { pose: Pose; loopClosed: boolean } | null {
  const latest = sightings.at(-1);
  if (latest === undefined) return null;
  const first = sightings[0]!;
  let firstFix = Number.POSITIVE_INFINITY;
  let lastFix = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    if (!Number.isFinite(s.tMs)) continue;
    firstFix = Math.min(firstFix, s.tMs);
    lastFix = Math.max(lastFix, s.tMs);
  }
  const closes =
    sightings.length >= 2 &&
    firstFix <= lastFix &&
    first.atMs <= firstFix &&
    latest.atMs >= lastFix;
  if (!closes) return { pose: latest.odomPose, loopClosed: false };
  const [ax, ay, az] = first.odomPose.position;
  const [bx, by, bz] = latest.odomPose.position;
  const mid: [number, number, number] = [
    (ax + bx) / 2,
    (ay + by) / 2,
    (az + bz) / 2,
  ];
  if (!mid.every(Number.isFinite)) {
    return { pose: latest.odomPose, loopClosed: false };
  }
  return {
    pose: { position: mid, rotation: latest.odomPose.rotation },
    loopClosed: true,
  };
}
