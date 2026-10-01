/**
 * How far a printed code has moved from its saved pose, as the visitor's
 * own GPS sees it (Tour Viewer authoring plan 2026-09-28-0953 §3.6,
 * decision D20, measured in milestone M5a; not wired into the viewer yet -
 * that is M5c).
 *
 * THE QUESTION. A scan pins the alignment to the code's SAVED pose: the
 * code's odometry pose is mapped onto it (`codeCorrection`). If the poster
 * was re-hung elsewhere, that pin is off by the move, and the visitor's
 * device fixes disagree with it by about the move. Each estimator here
 * compares the code-pinned map of the odometry with the device fixes and
 * reports the disagreement AT THE CODE, plus how much evidence it rests on.
 *
 * TWO ESTIMATORS, both measured in M5a (results in the sidecar):
 * - `residual` - the mean of `fix - pin(odometry)` over the device fixes
 *   whose pinned position lies within `radiusM` of the code. A heading error
 *   theta in the saved pose leaks in as about 2 sin(theta/2) d for a fix d
 *   metres from the code (§7j #1), at most 2 sin(theta/2) R.
 * - `rigid` - a 2D least-squares fit (translation plus yaw) of the device
 *   fixes onto the pinned odometry over ALL fixes, evaluated at the code. It
 *   absorbs the turn, so a heading error alone reads as no move.
 *
 * WHAT NO ESTIMATOR CAN DO: tell a constant GPS bias from a move. Both add
 * to the estimate exactly (property test). The rule's bound therefore has a
 * floor ({@link judgeCodeDisplacement}).
 *
 * EVIDENCE IN TIME AND SPREAD, never in fixes (§7j #7): GPS error is
 * autocorrelated (tens to hundreds of seconds), so a minute of fixes from
 * one spot is close to ONE observation. `spanS` is the time between the
 * first and last fix used; `spreadM` the RMS distance of their pinned
 * odometry positions from their centroid (GPS noise is not walking).
 *
 * Pure and incremental: {@link addDisplacementSample} folds one fix into
 * running sums (O(1) per fix, what a per-fix check in the viewer needs),
 * {@link estimateCodeDisplacement} folds a list. Inputs are external data
 * (the store's history): a non-finite sample is skipped, never repaired.
 *
 * @see code-displacement.ts.md
 */

import {
  calcRelativeCoordsInMeters,
  type LatLong,
} from "gps-plus-slam-app-framework/core";

import { codeCorrection, type NuePose } from "./visit-anchoring.js";
import { deviceSamples, type VisitLogInput } from "./visit-log.js";
import { correctionBoundM } from "./visit-settle.js";

/** One device fix as the estimators read it; horizontal only. */
export interface DisplacementSample {
  /** The fix's own time (epoch ms). */
  readonly tMs: number;
  /** The fix in GPS-world NUE relative to the session zero: [north, east]. */
  readonly gps: readonly [number, number];
  /** Its odometry partner, odometry-NUE: [north, east]. */
  readonly odom: readonly [number, number];
  /** Its reported horizontal accuracy (m), when it had one. */
  readonly accuracyM?: number;
}

/**
 * The device fixes of a store's GPS history as displacement samples: the
 * votes filtered out by `deviceSamples` (the one device-only filter), the
 * fixes converted to metres from `zero`. A fix without a finite time or an
 * odometry partner is dropped: its evidence cannot be counted.
 */
export function displacementSamples(
  input: Pick<VisitLogInput, "gpsPositions" | "odometryPositions"> & {
    readonly zero: LatLong | null;
  },
): DisplacementSample[] {
  const { zero } = input;
  if (zero === null) return [];
  return deviceSamples(input).flatMap(({ fix, odom, timestampMs }) => {
    if (odom === null || timestampMs === undefined) return [];
    const nue = calcRelativeCoordsInMeters(
      zero,
      { lat: fix.lat, lon: fix.lng },
      0,
      0,
    );
    const sample: DisplacementSample = {
      tMs: timestampMs,
      gps: [nue[0], nue[2]],
      odom: [odom[0]!, odom[2]!],
    };
    return [
      fix.accuracy === undefined
        ? sample
        : { ...sample, accuracyM: fix.accuracy },
    ];
  });
}

/**
 * The code-pinned map of the odometry, horizontal: where the code's saved
 * pose says each odometry point lies (`codeCorrection` of the code's
 * odometry pose onto its saved one), and the saved position itself.
 */
export interface CodePin {
  /** `[north, east]` of `pin(odometry)` = `m · odometry + t`. */
  readonly m: readonly [number, number, number, number];
  readonly t: readonly [number, number];
  /** The saved code, GPS-world NUE: [north, east]. */
  readonly code: readonly [number, number];
}

/**
 * Pin the odometry on a code: its pose in odometry-NUE (the stable fused
 * pose through `odomNueFromWebXr`) mapped onto its saved pose in GPS-world
 * NUE (`objectPoseNue` of the level's geo).
 *
 * @returns null for non-finite poses and the one pair with no yaw
 *   (`codeCorrection`'s null).
 */
export function pinCode(
  codeOdomNue: NuePose,
  storedNue: NuePose,
): CodePin | null {
  const a = codeCorrection(codeOdomNue, storedNue);
  if (a === null) return null;
  // Column-major 4x4, yaw about Up only: north' = a0 n + a8 e + a12,
  // east' = a2 n + a10 e + a14.
  return {
    m: [a[0]!, a[8]!, a[2]!, a[10]!],
    t: [a[12]!, a[14]!],
    code: [storedNue.position[0], storedNue.position[2]],
  };
}

export type DisplacementEstimator =
  | { readonly kind: "residual"; readonly radiusM: number }
  | { readonly kind: "rigid" };

/**
 * Running sums of the fixes an estimator kept, both points relative to the
 * code: `p` = pinned odometry, `q` = device fix. Opaque to callers; start
 * from {@link EMPTY_DISPLACEMENT_STATS}.
 */
export interface DisplacementStats {
  readonly n: number;
  readonly pn: number;
  readonly pe: number;
  readonly qn: number;
  readonly qe: number;
  /** Sum of |p|^2. */
  readonly pp: number;
  /** Sum of p . q and of p x q (north-east cross product). */
  readonly dot: number;
  readonly cross: number;
  readonly firstMs: number;
  readonly lastMs: number;
}

export const EMPTY_DISPLACEMENT_STATS: DisplacementStats = Object.freeze({
  n: 0,
  pn: 0,
  pe: 0,
  qn: 0,
  qe: 0,
  pp: 0,
  dot: 0,
  cross: 0,
  firstMs: Number.POSITIVE_INFINITY,
  lastMs: Number.NEGATIVE_INFINITY,
});

/** The estimate at the code, and the evidence behind it. */
export interface DisplacementEstimate {
  /** Where GPS puts the code minus where its saved pose says: [n, e] m. */
  readonly displacementM: readonly [number, number];
  readonly magnitudeM: number;
  /** Seconds between the first and the last fix used. */
  readonly spanS: number;
  /** RMS distance (m) of the fixes' pinned positions from their centroid. */
  readonly spreadM: number;
  readonly samples: number;
  /** The rigid fit's turn (degrees, about Up); 0 for `residual`. */
  readonly yawDeg: number;
}

/** A spread (m) below which the rigid fit has no turn to fit: a numerical
 *  guard (micrometres; real standing sway is millimetres or more), not a
 *  tuning parameter - the rule's `minSpreadM` is where evidence is judged. */
const DEGENERATE_SPREAD_M = 1e-6;

function checkEstimator(estimator: DisplacementEstimator): void {
  if (
    estimator.kind === "residual" &&
    !(Number.isFinite(estimator.radiusM) && estimator.radiusM > 0)
  ) {
    throw new RangeError(
      `residual radius must be a positive number, got ${String(estimator.radiusM)}`,
    );
  }
}

/**
 * Fold one device fix into `stats`: unchanged for a non-finite sample and,
 * for `residual`, for a fix whose pinned position lies beyond the radius.
 *
 * @throws RangeError for a residual radius that is not a positive number.
 */
export function addDisplacementSample(
  stats: DisplacementStats,
  pin: CodePin,
  estimator: DisplacementEstimator,
  sample: DisplacementSample,
): DisplacementStats {
  checkEstimator(estimator);
  const { tMs, gps, odom } = sample;
  if (
    !Number.isFinite(tMs) ||
    !Number.isFinite(gps[0]) ||
    !Number.isFinite(gps[1]) ||
    !Number.isFinite(odom[0]) ||
    !Number.isFinite(odom[1])
  ) {
    return stats;
  }
  const [m0, m1, m2, m3] = pin.m;
  const pn = m0 * odom[0] + m1 * odom[1] + pin.t[0] - pin.code[0];
  const pe = m2 * odom[0] + m3 * odom[1] + pin.t[1] - pin.code[1];
  if (estimator.kind === "residual" && Math.hypot(pn, pe) > estimator.radiusM) {
    return stats;
  }
  const qn = gps[0] - pin.code[0];
  const qe = gps[1] - pin.code[1];
  return {
    n: stats.n + 1,
    pn: stats.pn + pn,
    pe: stats.pe + pe,
    qn: stats.qn + qn,
    qe: stats.qe + qe,
    pp: stats.pp + pn * pn + pe * pe,
    dot: stats.dot + pn * qn + pe * qe,
    cross: stats.cross + pn * qe - pe * qn,
    firstMs: Math.min(stats.firstMs, tMs),
    lastMs: Math.max(stats.lastMs, tMs),
  };
}

/**
 * The estimate from folded `stats`, or null when no fix was kept.
 *
 * `residual`: the mean of `q - p`. `rigid`: the yaw psi and shift that best
 * map `p` onto `q` (closed-form 2D least squares), applied to the code (the
 * origin): `R(psi) (0 - mean p) + mean q`. With a degenerate spread the
 * yaw is 0 and the rigid estimate is the residual mean.
 */
export function displacementEstimate(
  stats: DisplacementStats,
  estimator: DisplacementEstimator,
): DisplacementEstimate | null {
  checkEstimator(estimator);
  const { n } = stats;
  if (n === 0) return null;
  const pn = stats.pn / n;
  const pe = stats.pe / n;
  const qn = stats.qn / n;
  const qe = stats.qe / n;
  const spreadM = Math.sqrt(Math.max(0, stats.pp / n - pn * pn - pe * pe));
  let displacementM: [number, number] = [qn - pn, qe - pe];
  let yaw = 0;
  if (estimator.kind === "rigid") {
    const sDot = stats.dot - n * (pn * qn + pe * qe);
    const sCross = stats.cross - n * (pn * qe - pe * qn);
    // Without a spread there is no turn to fit: the cross sums are then
    // rounding noise, and their angle would swing the estimate by up to
    // twice the distance of the fixes from the code.
    yaw = spreadM < DEGENERATE_SPREAD_M ? 0 : Math.atan2(sCross, sDot);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // R(psi) p = (c pn - s pe, s pn + c pe), applied to -mean p.
    displacementM = [qn - (c * pn - s * pe), qe - (s * pn + c * pe)];
  }
  return {
    displacementM,
    magnitudeM: Math.hypot(displacementM[0], displacementM[1]),
    spanS: (stats.lastMs - stats.firstMs) / 1000,
    spreadM,
    samples: n,
    yawDeg: (yaw * 180) / Math.PI,
  };
}

/** {@link addDisplacementSample} over `samples`, then the estimate. */
export function estimateCodeDisplacement(
  samples: readonly DisplacementSample[],
  pin: CodePin,
  estimator: DisplacementEstimator,
): DisplacementEstimate | null {
  checkEstimator(estimator);
  let stats = EMPTY_DISPLACEMENT_STATS;
  for (const sample of samples) {
    stats = addDisplacementSample(stats, pin, estimator, sample);
  }
  return displacementEstimate(stats, estimator);
}

export type CodeMoveVerdict = "moved" | "consistent" | "undecided";

/** The decision rule's parameters (all swept in M5a; see the sidecar). */
export interface CodeMoveRule {
  /** The bound never falls below this (m): the GPS bias the rule tolerates
   *  on a correctly placed code, plus a margin. */
  readonly floorM: number;
  /** `correctionBoundM`'s accuracy factor. */
  readonly accuracyFactor: number;
  /** `correctionBoundM`'s accuracy for a side that reports none (m). */
  readonly defaultAccuracyM: number;
  /** At or under this (m) the code agrees with GPS: `consistent`. */
  readonly agreementM: number;
  /** Fewer seconds of evidence than this: `undecided`. */
  readonly minSpanS: number;
  /** Less spread than this (m): `undecided`. */
  readonly minSpreadM: number;
}

/**
 * The estimator M5a recommends: the rigid fit. A saved heading error or a
 * turned poster does not reach it (the residual estimator's detection
 * changed with both; the rigid fit's did not, at 0-18 degrees and 0-180).
 * The price: at a 30 m floor its first false alarm came one 2.5 m bias
 * step earlier than the 20 m residual estimator's at sigma 5 and 10 m.
 */
export const CODE_MOVE_ESTIMATOR: DisplacementEstimator = Object.freeze({
  kind: "rigid",
});

/**
 * The rule M5a measured (results doc 2026-09-28-1433, "M5a"; sidecar).
 * Parameters it rests on: GPS error as Gauss-Markov noise of tau 30-300 s
 * and sigma 3-10 m plus a constant bias, 1 % odometry drift, the M5a
 * walks. With it an UNMOVED code never reads `moved` while sigma <= 3 m
 * and the bias is under 22.5 m (tau 300 s; 25 m at tau 30 s), nor at sigma
 * 5 m (tau 100 s) under 15 m; at sigma 10 m it does at any bias. A moved
 * code is read as moved when |move + bias| clears about 30 m: 100 % of
 * 50 m moves within 20 s (median), 75 % of 30 m, 34 % of 20 m, 12 % of
 * 10 m. What reverses it: a lower floor (25 m: false alarms from sigma
 * 5 m at B = 10 m), a shorter span (0-30 s: the scan's first fixes decide
 * alone), a GPS whose error is larger than sigma 5 m without reporting it.
 */
export const CODE_MOVE_RULE: CodeMoveRule = Object.freeze({
  floorM: 30,
  accuracyFactor: 3,
  defaultAccuracyM: 5,
  agreementM: 10,
  minSpanS: 60,
  minSpreadM: 2,
});

/**
 * The verdict on one estimate. The bound is the authoring correction's
 * (`correctionBoundM` of the device fixes' and the saved level's
 * accuracies, with the rule's factor and default) but never under the
 * floor, because reported accuracy is not bias (§7j #2):
 * - `undecided` - no estimate, or less than `minSpanS` / `minSpreadM` of
 *   evidence, or a size between the agreement and the bound;
 * - `moved` - beyond the bound;
 * - `consistent` - at or under `agreementM`.
 */
export function judgeCodeDisplacement(
  estimate: DisplacementEstimate | null,
  accuracies: {
    /** The median reported accuracy of the DEVICE fixes (m). */
    readonly deviceM: number | null | undefined;
    /** The saved level's mint accuracy (m). */
    readonly storedM: number | null | undefined;
  },
  rule: CodeMoveRule,
): { verdict: CodeMoveVerdict; boundM: number } {
  const boundM = Math.max(
    rule.floorM,
    correctionBoundM(accuracies.deviceM, accuracies.storedM, {
      accuracyFactor: rule.accuracyFactor,
      defaultAccuracyM: rule.defaultAccuracyM,
    }),
  );
  if (
    estimate === null ||
    !(estimate.spanS >= rule.minSpanS) ||
    !(estimate.spreadM >= rule.minSpreadM)
  ) {
    return { verdict: "undecided", boundM };
  }
  if (estimate.magnitudeM > boundM) return { verdict: "moved", boundM };
  if (estimate.magnitudeM <= rule.agreementM) {
    return { verdict: "consistent", boundM };
  }
  return { verdict: "undecided", boundM };
}
