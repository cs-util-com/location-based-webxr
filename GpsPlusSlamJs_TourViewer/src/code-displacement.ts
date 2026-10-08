/**
 * How far a printed code has moved from its saved pose, as the visitor's
 * own GPS sees it (Tour Viewer authoring plan 2026-09-28-0953 §3.6,
 * decision D20, measured in milestone M5a; recalibrated on real recordings
 * and wired into the viewer in M5c: `moved-code-rule.ts` adds the turn
 * check, `moved-code-check.ts` runs both per device fix).
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
  | {
      readonly kind: "rigid";
      /** Below this spread (m) no turn is fitted: the yaw is 0 and the
       *  estimate is the residual mean. Default: a numerical guard of
       *  1 micrometre. A swaying visitor's centimetres pass that guard but
       *  carry no turn, so the shipped estimator sets the rule's
       *  `minSpreadM` here (§7l G2); a non-negative finite number. */
      readonly minYawSpreadM?: number;
    };

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

/** The rigid fit's default `minYawSpreadM`: a numerical guard
 *  (micrometres), below which the cross sums are rounding noise. Real
 *  standing sway is millimetres or more and passes it, which is why the
 *  shipped estimator raises it to the rule's `minSpreadM`. */
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
  if (
    estimator.kind === "rigid" &&
    estimator.minYawSpreadM !== undefined &&
    !(Number.isFinite(estimator.minYawSpreadM) && estimator.minYawSpreadM >= 0)
  ) {
    throw new RangeError(
      `rigid minimum yaw spread must be a non-negative number, got ${String(estimator.minYawSpreadM)}`,
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
 * origin): `R(psi) (0 - mean p) + mean q`. Below the estimator's
 * `minYawSpreadM` the yaw is 0 and the rigid estimate is the residual mean.
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
    // noise (rounding, or GPS wander over a visitor's sway), and their angle
    // would swing the estimate by up to twice the distance of the fixes
    // from the code.
    const minSpread = estimator.minYawSpreadM ?? DEGENERATE_SPREAD_M;
    yaw =
      spreadM < Math.max(minSpread, DEGENERATE_SPREAD_M)
        ? 0
        : Math.atan2(sCross, sDot);
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

/** The decision rule's parameters (swept in M5a and on real recordings;
 *  see the sidecar). */
export interface CodeMoveRule {
  /** The bound (m), on its own: the GPS disagreement the rule tolerates on a
   *  correctly placed code, plus a margin. */
  readonly floorM: number;
  /** At or under this (m) the code agrees with GPS: `consistent`. */
  readonly agreementM: number;
  /** Fewer seconds of evidence than this: `undecided`. */
  readonly minSpanS: number;
  /** Less spread than this (m): `undecided`. */
  readonly minSpreadM: number;
}

/**
 * THE MOVED-CODE FLOOR (m): no offset at or under it is ever treated as a
 * move of the code, however small the reported accuracies make the
 * correction's bound. Reported accuracy is not bias (§7j #2): two visits
 * reporting 2-3 m can still disagree by 8-15 m, while `correctionBoundM`
 * is then only 13.5-17.7 m.
 *
 * The VIEWER's floor (`CODE_MOVE_RULE.floorM`, judged against it ALONE since
 * the owner's decision of 2026-10-02). Until D26 the authoring prompt
 * shared it; since D26 (2026-10-02) the prompt has its own 15 m trigger
 * (`MOVE_PROMPT_FLOOR_M`, the former `code-move-prompt.ts`; removed in code
 * book plan M6, whose automatic rule is `code-spots.ts`): the prompt only ASKED the
 * author, the viewer acts on its own.
 *
 * Parameters it rests on (the viewer's half, real recordings, results doc
 * "Recalibrated on real recordings"): 6,166 cross-day pairs of 42 reference
 * points marked on different days, 209 walks of median 2.7 min, the rigid
 * fit over every device fix of the visit with 60 s and 2 m of evidence. At
 * 20 m: 3 of 2,380 unmoved pairs past it within 120 s (2 of 37 points), 23
 * of 6,166 over the whole visit; 66 % of 20 m and 99.9 % of 30 m moves caught
 * within 120 s. At 15 m: 10 of 2,380 within 120 s (4 of 37 points). What
 * would reverse it: another walk like the church one (27 m off at a
 * reported 6 m) in more than about 1 in 50 walks, drift in tours much longer
 * than 5 minutes, indoor use (10 walks measured).
 */
export const MOVED_CODE_FLOOR_M = 20;

/**
 * The viewer's position rule, as the owner approved it on 2026-10-02 from
 * the real-walk recalibration (results:
 * `GpsPlusSlamJs_Docs/docs/2026-10-01-2040-moved-code-detection-results.md`,
 * "Recalibrated on real recordings"; sidecar): the rigid fit's displacement
 * against {@link MOVED_CODE_FLOOR_M} ALONE, once the evidence spans 60 s
 * and 2 m. M5a's synthetic rule (a 30 m floor coupled to
 * `correctionBoundM`) is retired: on real walks the coupled bound was
 * 23-27 m (reported accuracy is not bias) and caught 9.6 % of 20 m moves
 * against 66 % for the floor alone, for 0 against 3 of 2,380 unmoved pairs
 * within 120 s.
 *
 * Parameters it rests on and what reverses them: {@link MOVED_CODE_FLOOR_M};
 * the span (0/30/60/120 s swept: the first fixes after a scan must not
 * decide alone) and the spread (0/2/5/10 m: 2 m keeps a visitor who stays
 * near the code decidable; 5 m changed no real-walk false alarm). Outdoor,
 * a few phones in mostly one area, visits under about 5 minutes.
 */
export const CODE_MOVE_RULE: CodeMoveRule = Object.freeze({
  floorM: MOVED_CODE_FLOOR_M,
  agreementM: 10,
  minSpanS: 60,
  minSpreadM: 2,
});

/**
 * The estimator M5a recommends: the rigid fit. A saved heading error or a
 * turned poster does not reach it (the residual estimator's detection
 * changed with both; the rigid fit's did not, at 0-18 degrees and 0-180),
 * which also means a poster turned in place is never `moved` (§7l D3).
 * The price: at a 30 m floor its first false alarm came one 2.5 m bias
 * step earlier than the 20 m residual estimator's at sigma 5 and 10 m; on
 * real walks the residual estimator lost every walk that left its radius.
 * No turn is fitted below the rule's minimum spread (§7l G2): such evidence
 * is `undecided` anyway, and a yaw drawn from a swaying visitor's GPS
 * wander would make the reported offset noise. Verdicts are unchanged.
 */
export const CODE_MOVE_ESTIMATOR: DisplacementEstimator = Object.freeze({
  kind: "rigid",
  minYawSpreadM: CODE_MOVE_RULE.minSpreadM,
});

/**
 * The verdict on one estimate, against the rule's floor alone (owner,
 * 2026-10-02; the coupling to the authoring correction's accuracy bound
 * hid the floor on real walks, see {@link CODE_MOVE_RULE}):
 * - `undecided` - no estimate, or less than `minSpanS` / `minSpreadM` of
 *   evidence, or a size between the agreement and the bound;
 * - `moved` - beyond the bound;
 * - `consistent` - at or under `agreementM`.
 */
export function judgeCodeDisplacement(
  estimate: DisplacementEstimate | null,
  rule: CodeMoveRule,
): { verdict: CodeMoveVerdict; boundM: number } {
  const boundM = rule.floorM;
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
