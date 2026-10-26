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
 * THE WALK IT RESTS ON. The gate reads the walk twice: the GPS spread
 * (the largest distance between two fixes) and the phone's own tracking
 * (the largest distance between two odometry points of those fixes), each
 * against the keep-or-replace rule's walk for the accuracy. GPS jumps at a
 * door make a spread no walk made; the tracking does not jump. Fixes far
 * worse than the visit's median accuracy (more than
 * {@link FIT_ACCURACY_OUTLIER_FACTOR} times it, a phone coming back inside)
 * are left out of the fit: unweighted, they would count as much as the
 * street's.
 *
 * THE LOOP CLOSURE. The phone's tracking drifts along a walk, so a code
 * seen at the start and again at the end of it shows up at two odometry
 * spots, apart by the drift. A fix carries the drift of its own moment,
 * and the fit absorbs the drift its fixes carry on average, so the code is
 * read between its two sightings at that average: the first sighting plus
 * w times the way to the last, w the mean over the fit's fixes of each
 * fix's moment in the window between the two looks (clamped to it: a fix
 * before the first look carries none of the drift, one after the last all
 * of it). Fixes spread evenly over the window give the midpoint. It acts
 * on odometry poses and device fixes only: no code's votes enter it.
 *
 * Pure.
 *
 * @see code-device-fit.ts.md
 */

import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import { Matrix4 } from "three";

import {
  CODE_MOVE_ESTIMATOR,
  CODE_MOVE_RULE,
  estimateCodeDisplacement,
  pinCode,
  type DisplacementSample,
} from "./code-displacement.js";
import {
  isReliable,
  walkMoreM,
  type PositionQuality,
} from "./code-position-rule.js";
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
  /** The fixes it rests on, in the order given. */
  readonly fixes: readonly DisplacementSample[];
  /** The phone's own walk over them: the largest horizontal distance
   *  between two of their odometry points (m). */
  readonly walkM: number;
}

/** A fix whose reported accuracy is more than this many times the visit's
 *  median is left out of the fit. Not swept: it removes fixes several
 *  times worse than the rest, which the median accuracy the code is
 *  stamped with does not describe. */
export const FIT_ACCURACY_OUTLIER_FACTOR = 2;

/**
 * The fixes a fit uses: all but those reporting an accuracy more than
 * {@link FIT_ACCURACY_OUTLIER_FACTOR} times the median of the reported
 * ones. A fix without an accuracy is kept (nothing says it is worse).
 */
export function fitSamples(
  samples: readonly DisplacementSample[],
): DisplacementSample[] {
  const accuracies = samples
    .map((s) => s.accuracyM)
    .filter((a): a is number => a !== undefined && Number.isFinite(a) && a > 0);
  if (accuracies.length === 0) return [...samples];
  const limit = FIT_ACCURACY_OUTLIER_FACTOR * interpolatingMedian(accuracies);
  return samples.filter(
    (s) => s.accuracyM === undefined || !(s.accuracyM > limit),
  );
}

/** The largest horizontal distance between two odometry points of
 *  `samples` (m); 0 for fewer than two. */
function odometryExtentM(samples: readonly DisplacementSample[]): number {
  let best = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i]!.odom;
    for (let j = i + 1; j < samples.length; j += 1) {
      const b = samples[j]!.odom;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d > best) best = d;
    }
  }
  return best;
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
  return {
    alignment,
    samples: est.samples,
    spreadM: est.spreadM,
    fixes: samples,
    walkM: odometryExtentM(samples),
  };
}

/**
 * The settle's gate on {@link deviceFitAlignment}: the visit's fit only
 * when its walk could measure a code at all - at least the mint's minimum
 * of device fixes (`MIN_ALIGNMENT_SAMPLES`) after {@link fitSamples}, a
 * walk reliable for its accuracy by its GPS spread AND by the phone's own
 * tracking (`isReliable`, the keep-or-replace rule's own test), and one
 * odometry frame throughout (a tracking restart mixes two frames, so no
 * rigid fit describes the walk).
 *
 * @param quality the visit's device-only GPS spread and accuracy
 */
export function codeDeviceFit(input: {
  readonly samples: readonly DisplacementSample[];
  readonly reference: ArrayLike<number>;
  readonly quality: PositionQuality;
  readonly frameChanged: boolean;
}): DeviceFit | null {
  if (input.frameChanged || !isReliable(input.quality)) return null;
  const fixes = fitSamples(input.samples);
  if (fixes.length < MIN_ALIGNMENT_SAMPLES) return null;
  const tracked = {
    extentM: odometryExtentM(fixes),
    accuracyM: input.quality.accuracyM,
  };
  if (!isReliable(tracked)) return null;
  return deviceFitAlignment(fixes, input.reference);
}

/**
 * How much farther the visit must walk for {@link codeDeviceFit}'s walk
 * rule (m, 0 when it walked enough): by the shorter of its GPS spread and
 * its tracking over the fit's fixes - the result line's hint. Null without
 * a known accuracy.
 */
export function deviceWalkMoreM(
  samples: readonly DisplacementSample[],
  quality: PositionQuality,
): number | null {
  if (quality.accuracyM === null) return null;
  const tracked = odometryExtentM(fitSamples(samples));
  return walkMoreM({
    extentM: Math.min(quality.extentM ?? 0, tracked),
    accuracyM: quality.accuracyM,
  });
}

/** One kept sighting of a code: when, and its raw WebXR odometry pose. */
export interface FitSighting {
  readonly atMs: number;
  readonly odomPose: Pose;
}

/**
 * The code's odometry pose to read a device fit at: between its first and
 * last sightings, at the share of the way the fit's fixes carry on
 * average (each fix's moment in the window between the two looks, clamped
 * to it; see the module comment), else its latest sighting - with one
 * sighting, two at one moment, a moment unknown, or no timed fix. The
 * heading is always the latest sighting's. Raw WebXR and odometry-NUE
 * differ by a fixed basis change, so the point is the same in either.
 *
 * @param sightings oldest first
 * @param samples the fixes the fit rests on (`DeviceFit.fixes`)
 * @returns null without a sighting
 */
export function codeFitPose(
  sightings: readonly FitSighting[],
  samples: readonly DisplacementSample[],
): { pose: Pose; loopClosed: boolean } | null {
  const latest = sightings.at(-1);
  if (latest === undefined) return null;
  const first = sightings[0]!;
  const plain = { pose: latest.odomPose, loopClosed: false };
  const span = latest.atMs - first.atMs;
  if (sightings.length < 2 || !Number.isFinite(span) || !(span > 0)) {
    return plain;
  }
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.tMs)) continue;
    sum += Math.min(1, Math.max(0, (s.tMs - first.atMs) / span));
    count += 1;
  }
  if (count === 0) return plain;
  const w = sum / count;
  const [ax, ay, az] = first.odomPose.position;
  const [bx, by, bz] = latest.odomPose.position;
  const at: [number, number, number] = [
    ax + w * (bx - ax),
    ay + w * (by - ay),
    az + w * (bz - az),
  ];
  if (!at.every(Number.isFinite)) return plain;
  return {
    pose: { position: at, rotation: latest.odomPose.rotation },
    loopClosed: true,
  };
}

/**
 * Code `levelId`'s kept sightings as {@link codeFitPose} reads them, oldest
 * first: without those solved at a print size the creator has since
 * replaced (`otherSize`), whose poses are not the code's.
 */
export function codeFitSightings(
  sightings: readonly {
    readonly atMs: number;
    readonly sighting: { readonly levelId: string; readonly odomPose: Pose };
    readonly otherSize?: true;
  }[],
  levelId: string,
): FitSighting[] {
  return sightings
    .filter((s) => s.sighting.levelId === levelId && s.otherSize !== true)
    .map((s) => ({ atMs: s.atMs, odomPose: s.sighting.odomPose }));
}
