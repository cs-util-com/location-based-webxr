/**
 * Tracking-quality reporter — public surface for "how much should the host
 * trust the current GPS↔AR alignment?".
 *
 * Implements Phase A of
 * `GpsPlusSlamJs_Docs/docs/2026-05-16-tracking-quality-metrics-plan.md`:
 *
 *  - §4.1 matrix-history convergence  → {@link computeConvergence}
 *  - §4.2 per-observation residual    → {@link computeResidualConsensus}
 *  - §4.4 GPS-accuracy budget         → {@link computeGpsAccuracy}
 *  - §4.5 baseline coverage           → {@link computeCoverage}
 *  - §4.6 GPS-vs-fused divergence     → {@link computeGpsVsFusedDivergence}
 *                                       (diagnostic only)
 *  - §4.7 AR tracking phase gate      → handled inside the aggregator
 *  - aggregator + state machine       → {@link computeTrackingQualityReport}
 *
 * State placement
 * ---------------
 * The §4.1 ring buffer and the materialised report live in the
 * `trackingQuality` Redux slice (see §5b of the plan). The slice is a
 * normal RTK slice; it is fed by the listener middleware
 * {@link createTrackingQualityListenerMiddleware} which dispatches
 * {@link snapshotPushed} / {@link reportUpdated} / {@link resetTrackingQuality}
 * on the relevant input actions.
 *
 * Pure-function discipline
 * ------------------------
 * Every `compute*` helper below is a pure function over its arguments —
 * no module-level state, no closure side effects. The Investigation
 * harness imports them directly (same pattern as
 * `computeStabilityForConfig`) so the parameter sweep in §6.1 can run
 * without going through the Redux store.
 */

import type { Action, PayloadAction, Middleware } from '@reduxjs/toolkit';
import { createSlice, createListenerMiddleware } from '@reduxjs/toolkit';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { ReadonlyMat4 } from 'gl-matrix';
import type { GpsPoint, LatLong, Matrix4, Vector3 } from 'gps-plus-slam-js';
import { calcGpsCoords, distanceInMeters } from 'gps-plus-slam-js';
import { geodesicAngleRad } from '../utils/geodesic-angle.js';
import { interpolatingMedian } from '../utils/median.js';
import type { CombinedRootState } from './combined-root-state';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from './app-selectors';
import { selectTrackingPhase } from './tracking-slice';
import { clamp01 } from '../utils/clamp01.js';

// ===========================================================================
// Public types
// ===========================================================================

export type TrackingQualityState = 'warming-up' | 'ar-lost' | 'degraded' | 'ok';

export interface TrackingQualityReport {
  state: TrackingQualityState;
  /** 0..1, monotonically combined from {@link subScores}. */
  confidence: number;
  subScores: {
    convergence: number;
    residualConsensus: number;
    gpsAccuracy: number;
    coverage: number;
  };
  diagnostics: {
    /**
     * §4.1 (Finding 6): **sum of |Δrotation|** across the last
     * `matrixHistorySize - 1` consecutive snapshot pairs in the ring
     * buffer, in degrees. Replaced the per-pair `recentMaxRotationDeltaDeg`
     * on 2026-05-23 — see
     * `GpsPlusSlamJs_Docs/docs/2026-05-23-tracking-quality-hud-user-feedback.md`
     * (Finding 6). Surfaced in the recorder HUD as `ΣΔrot:`.
     */
    recentSumRotationDeltaDeg: number;
    /** §4.1 (Finding 6): sum of |Δtranslation| across the same window, in metres. Surfaced as `ΣΔpos:`. */
    recentSumTranslationDeltaM: number;
    medianResidualM: number;
    medianRecentGpsAccuracyM: number;
    walkedDistanceM: number;
    directionSpreadDeg: number;
    observationsSeen: number;
    /** §4.6 — diagnostic only, never feeds the aggregate. */
    gpsVsFusedMaxDivergenceM: number;
  };
}

export interface TrackingQualityOptions {
  /** §4.1 ring-buffer length. Seed default; corpus-tuned in §6.1. */
  matrixHistorySize?: number;
  /** §4.2 GPS-window length. Seed default; corpus-tuned in §6.1. */
  residualWindowSize?: number;
  /** Confidence threshold below which `state` reports `'degraded'`. */
  degradedThreshold?: number;
  /** §4.4 window length for GPS-accuracy budget. */
  gpsAccuracyWindowSize?: number;
  /** §4.5 walked-distance threshold for coverage = 1.0. */
  coverageWalkedDistanceM?: number;
  /** §4.5 direction-spread threshold for coverage = 1.0. */
  coverageDirectionSpreadDeg?: number;
  /** §4.1 ΣΔrotation (deg) at/below which convergence scores 1.0. Fail ramp ends at 4×. */
  convergenceRotationWarnDeg?: number;
  /** §4.1 ΣΔtranslation (m) at/below which convergence scores 1.0. Fail ramp ends at 4×. */
  convergenceTranslationWarnM?: number;
  /** Minimum GPS observations before leaving `warming-up`. */
  warmupMinObservations?: number;
  /** Minimum coverage score before leaving `warming-up`. */
  warmupMinCoverage?: number;
  /** §4.2 residual saturation target (m). */
  residualConfidenceTargetM?: number;
  /** §4.4 GPS-accuracy floor used to normalise residuals (m). */
  gpsAccuracyFloorM?: number;
  /** §4.8 consecutive sub-threshold observations before ok → degraded. */
  degradedHoldoff?: number;
  /**
   * §4.8b (Finding 4) — EMA blend factor applied to `subScores.convergence`.
   * `1.0` disables smoothing (raw value). `0 < α < 1` blends as
   * `smoothed = prevSmoothed + α * (raw - prevSmoothed)`. First observation
   * (no prior smoothed value) is seeded to the raw value.
   */
  convergenceEmaAlpha?: number;
}

export const DEFAULT_TRACKING_QUALITY_OPTIONS: Required<TrackingQualityOptions> =
  {
    matrixHistorySize: 5, // §4.1 — corpus-derived (§11 (c): N=5 best mean+worst ρ)
    residualWindowSize: 16, // §4.2 — outlier robustness (§11 (c): K independent of ρ)
    degradedThreshold: 0.5,
    gpsAccuracyWindowSize: 30, // §4.4 — most volatile signal, absorbs ~15 s spikes
    coverageWalkedDistanceM: 15,
    coverageDirectionSpreadDeg: 90,
    convergenceRotationWarnDeg: 6, // §4.1 — calibrated 2026-05-23, see computeConvergence
    convergenceTranslationWarnM: 2, // §4.1 — calibrated 2026-05-23, see computeConvergence
    warmupMinObservations: 10,
    warmupMinCoverage: 0.5,
    residualConfidenceTargetM: 3,
    gpsAccuracyFloorM: 1,
    degradedHoldoff: 3,
    convergenceEmaAlpha: 0.25, // §4.8b — corpus-tunable, see Finding 4. Re-tuned 0.3 → 0.25 with quality-review E-1: the EMA now advances per OBSERVATION (not per frame), so slightly more damping per step is needed to keep the F4 indoor-corpus convergence range < 0.2.
  };

// ---------------------------------------------------------------------------
// Slice state
// ---------------------------------------------------------------------------

/**
 * Single buffered alignment matrix snapshot. `matrix` is stored as a
 * plain `number[]` (length 16, row-major) so it stays serializable for
 * RTK's `SerializableStateInvariantMiddleware` and for action logs.
 */
export interface AlignmentSnapshot {
  observationIndex: number;
  matrix: number[];
}

export interface TrackingQualitySliceState {
  recentAlignments: AlignmentSnapshot[];
  report: TrackingQualityReport | null;
  /** §4.8 — consecutive observations with raw confidence < degradedThreshold. */
  degradedConsecutiveCount: number;
  /**
   * §4.8b (Finding 4) — last EMA-smoothed convergence sub-score. `null`
   * means "no prior observation" and the next aggregator run will seed
   * the value with the raw convergence score. Reset on
   * `resetTrackingQuality`.
   */
  smoothedConvergence: number | null;
}

const initialState: TrackingQualitySliceState = {
  recentAlignments: [],
  report: null,
  degradedConsecutiveCount: 0,
  smoothedConvergence: null,
};

// ===========================================================================
// Pure compute helpers
// ===========================================================================

/**
 * §4.8b (Finding 4) — exponential moving-average blend. When `prev` is
 * `null` the filter has no history yet and we seed it to `raw`.
 * `alpha = 1` disables smoothing (returns `raw`); `alpha = 0` freezes
 * the filter at `prev`. Non-finite `alpha` is treated as 1 (no
 * smoothing) to fail safe — never silently swallow a valid raw signal.
 */
function emaBlend(prev: number | null, raw: number, alpha: number): number {
  if (prev === null) return raw;
  const a = Number.isFinite(alpha) ? alpha : 1;
  return prev + a * (raw - prev);
}

function bearingDeg(north: number, east: number): number {
  // ENU bearing: 0° = North, 90° = East, range [0, 360).
  const rad = Math.atan2(east, north);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Linear ramp: `value ≤ low` → 1, `value ≥ high` → 0, linear between.
 * Used by sub-scores whose underlying physical quantity grows as
 * quality drops (e.g. residuals, heading delta).
 */
function rampDown(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  if (high <= low) return value <= low ? 1 : 0;
  if (value <= low) return 1;
  if (value >= high) return 0;
  return 1 - (value - low) / (high - low);
}

/**
 * Linear ramp: `value ≤ low` → 0, `value ≥ high` → 1, linear between.
 * Used by sub-scores whose underlying quantity grows as quality
 * improves (e.g. walked distance, direction spread).
 */
function rampUp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  if (high <= low) return value >= high ? 1 : 0;
  if (value <= low) return 0;
  if (value >= high) return 1;
  return (value - low) / (high - low);
}

/**
 * True iff the matrix is well-formed: exactly 16 elements, all finite (no
 * NaN/Infinity). The length check matters because `computeConvergence` scores a
 * pair as corrupt (fail side) only when this returns false; without it a finite
 * but wrong-length snapshot (`AlignmentSnapshot.matrix` is typed `number[]`,
 * not a 16-tuple) would slip past here, then hit `matrixDelta`'s own length
 * guard which returns ZERO deltas = "perfectly stable" — inflating the score
 * instead of degrading it (the same trap the non-finite guard avoids).
 */
function isFiniteMatrix(m: readonly number[]): boolean {
  if (m.length !== 16) return false;
  for (let i = 0; i < m.length; i++) {
    if (!Number.isFinite(m[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// §4.1 convergence
// ---------------------------------------------------------------------------

export interface ConvergenceResult {
  score: number;
  /** §4.1 (Finding 6): sum of |Δrotation| across the last N-1 pairs. */
  recentSumRotationDeltaDeg: number;
  /** §4.1 (Finding 6): sum of |Δtranslation| across the last N-1 pairs. */
  recentSumTranslationDeltaM: number;
  /** Pair count used (≥ 2 snapshots ⇒ ≥ 1 pair, else 0). */
  pairCount: number;
}

/**
 * §4.1 matrix-history convergence over the buffered snapshots.
 *
 * Reuses the same kernel idea as `computeStabilityDelta` from the
 * Investigation helpers (rotation + translation delta between two 4×4
 * matrices). With 0 or 1 snapshot we return score 0 — convergence is
 * undefined until at least one consecutive pair exists.
 *
 * Finding 6 (2026-05-23 field test): the per-pair `max` aggregation was
 * replaced with a **sum** across the window. `max` is a burst detector
 * — dominated by one bad pair, blind to slow drift; `sum` answers
 * "how much alignment motion accumulated over the window?" and exposes
 * slow creeping drift in user-readable units (°, m). The HUD now shows
 * the raw sums (`ΣΔrot:`, `ΣΔpos:`) alongside the EMA-smoothed `Conv:`
 * sub-score (Finding 4) so the user can debug an unstable reading.
 */
export function computeConvergence(
  snapshots: readonly AlignmentSnapshot[],
  options: { rotationWarnDeg?: number; translationWarnM?: number } = {}
): ConvergenceResult {
  // Defaults calibrated 2026-05-23 against the two field recordings
  // (TestDataJs/2026-05-19_15-43-55utc.zip outdoor walking,
  //  TestDataJs-Other/2026-05-23_03-01-11utc-indoor-without-moving.zip).
  // See 2026-05-23 feedback doc §5 item 1 and §11 of the spec.
  //
  //  Outdoor steady state (gpsObs ≥ 75): ΣΔrot 0.27–2°, ΣΔpos 0.27–1.05 m.
  //  Outdoor warm-up transitions: ΣΔrot up to ~195°, ΣΔpos up to ~12 m.
  //  Indoor (broken alignment, stationary): ΣΔrot 7.7–132°, ΣΔpos ≤ 2 m.
  //
  //  rotationWarnDeg=6° keeps the acceptance bar (smoothed conv ≥ 0.8
  //  from gpsObs=60 onward outdoor) met without false-passing the
  //  indoor stationary spike at ΣΔrot=9.5° (raw score 0.542, smoothed
  //  drops further). rotationFailDeg=24° caps the ramp at 4× warn.
  //
  //  translationWarnM=2 m (was 1 m) — outdoor steady walking pushes
  //  ΣΔpos right up to 1 m which used to chip away at the score during
  //  normal use; 2 m puts steady walking firmly at score=1.0.
  //  translationFailM=8 m still catches the 12 m warm-up transition.
  //
  // These seed defaults live in DEFAULT_TRACKING_QUALITY_OPTIONS
  // (convergenceRotationWarnDeg / convergenceTranslationWarnM) so the
  // store/aggregator can override them; the literals below are the
  // single-arg fallback when this helper is called directly (e.g. the
  // Investigation harness).
  const rotWarn =
    options.rotationWarnDeg ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceRotationWarnDeg;
  const transWarn =
    options.translationWarnM ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceTranslationWarnM;
  const rotFail = rotWarn * 4;
  const transFail = transWarn * 4;

  if (snapshots.length < 2) {
    return {
      score: 0,
      recentSumRotationDeltaDeg: 0,
      recentSumTranslationDeltaM: 0,
      pairCount: 0,
    };
  }

  let sumRotDeg = 0;
  let sumTransM = 0;
  let pairCount = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prevM = snapshots[i - 1]!.matrix;
    const currM = snapshots[i]!.matrix;
    // A corrupt (non-finite) alignment matrix — a degenerate solve emitting
    // NaN/Infinity — is NOT evidence of stability. `matrixDelta` finite-guards
    // such input to ZERO deltas (so the score never becomes NaN), but a zero
    // delta reads as "perfectly stable", which would let a corrupt snapshot
    // *improve* convergence. Score the pair on the FAIL side instead so a bad
    // matrix degrades (never inflates) the score. The thresholds are added so a
    // single corrupt pair pushes the corresponding ramp to 0.
    if (!isFiniteMatrix(prevM) || !isFiniteMatrix(currM)) {
      sumRotDeg += rotFail;
      sumTransM += transFail;
      pairCount += 1;
      continue;
    }
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(prevM, currM);
    sumRotDeg += Math.abs(rotationDeltaDeg);
    sumTransM += Math.abs(translationDeltaM);
    pairCount += 1;
  }

  const rotScore = rampDown(sumRotDeg, rotWarn, rotFail);
  const transScore = rampDown(sumTransM, transWarn, transFail);
  return {
    score: Math.min(rotScore, transScore),
    recentSumRotationDeltaDeg: sumRotDeg,
    recentSumTranslationDeltaM: sumTransM,
    pairCount,
  };
}

/**
 * Rotation and translation delta between two 4×4 alignment matrices in
 * the column-major layout that gl-matrix and the framework use.
 *
 * Rotation: extract the orientation quaternion with `mat4.getRotation`
 * and compute the relative angle via the shared `geodesicAngleRad` kernel
 * (radians, converted to degrees here).
 * Translation: extract the origin column with `mat4.getTranslation` and
 * compute the Euclidean distance.
 *
 * This is the **single shared kernel** for the AppFramework reporter and
 * the downstream corpus-analysis harness (see §11 (a) of the
 * tracking-quality plan), which re-exports it as `computeStabilityDelta` —
 * a thin wrapper around this function — so the §6.1 corpus sweep and the
 * runtime convergence score share one numeric definition.
 */
export function matrixDelta(
  prev: readonly number[],
  curr: readonly number[]
): { rotationDeltaDeg: number; translationDeltaM: number } {
  if (prev.length !== 16 || curr.length !== 16) {
    return { rotationDeltaDeg: 0, translationDeltaM: 0 };
  }
  // `prev`/`curr` are length-16 (guarded above) and only read from, so we
  // pass them straight to gl-matrix as ReadonlyMat4 (an indexed collection).
  // This avoids the spread + Float32Array(16) allocation that
  // `mat4.fromValues` would create on every call — `matrixDelta` runs in
  // the convergence loop on every GPS/pose event. Bonus: keeps float64
  // precision instead of truncating to float32.
  const prevMat = prev as unknown as ReadonlyMat4;
  const currMat = curr as unknown as ReadonlyMat4;
  const prevQuat = quat.create();
  const currQuat = quat.create();
  mat4.getRotation(prevQuat, prevMat);
  mat4.getRotation(currQuat, currMat);
  quat.normalize(prevQuat, prevQuat);
  quat.normalize(currQuat, currQuat);
  // Shared geodesic-angle kernel: clamps before acos, so the near-identical
  // case that made raw quat.getAngle return NaN now returns 0 directly (the
  // explicit NaN guard this code used to carry is folded into the helper).
  const angleRad = geodesicAngleRad(prevQuat, currQuat);
  // Finite-guard both deltas: geodesicAngleRad's clamp only fixes near-identity
  // round-off, NOT NaN/Infinity that a degenerate matrix feeds through
  // getRotation/quat.normalize (and likewise getTranslation/vec3.distance). An
  // unguarded NaN here propagates into computeConvergence and turns the whole
  // tracking-quality score into NaN. Fall back to 0 (no delta) on bad input —
  // the explicit guard this kernel used to carry before the shared-helper
  // refactor folded the round-off case (but not the NaN case) into the clamp.
  const rotationDeltaDeg = Number.isFinite(angleRad)
    ? (angleRad * 180) / Math.PI
    : 0;
  const prevT = vec3.create();
  const currT = vec3.create();
  mat4.getTranslation(prevT, prevMat);
  mat4.getTranslation(currT, currMat);
  const rawTranslation = vec3.distance(prevT, currT);
  const translationDeltaM = Number.isFinite(rawTranslation)
    ? rawTranslation
    : 0;
  return { rotationDeltaDeg, translationDeltaM };
}

// ---------------------------------------------------------------------------
// §4.2 residual consensus
// ---------------------------------------------------------------------------

export interface ResidualConsensusResult {
  score: number;
  medianResidualM: number;
  count: number;
}

/**
 * §4.2 — Median residual between the last `K` GPS observations and the
 * positions you would have predicted by transforming the matching
 * odometry positions through the current alignment matrix.
 *
 * Returns `score = 0`, `medianResidualM = 0` when we have fewer than
 * 2 paired observations or when the alignment matrix / zero ref is
 * not yet set.
 */
export function computeResidualConsensus(
  alignmentMatrix: Matrix4 | null,
  gpsPositions: readonly GpsPoint[],
  odometryPositions: readonly Vector3[],
  zeroRef: LatLong | null,
  options: Pick<
    Required<TrackingQualityOptions>,
    'residualWindowSize' | 'residualConfidenceTargetM' | 'gpsAccuracyFloorM'
  > = {
    residualWindowSize: DEFAULT_TRACKING_QUALITY_OPTIONS.residualWindowSize,
    residualConfidenceTargetM:
      DEFAULT_TRACKING_QUALITY_OPTIONS.residualConfidenceTargetM,
    gpsAccuracyFloorM: DEFAULT_TRACKING_QUALITY_OPTIONS.gpsAccuracyFloorM,
  }
): ResidualConsensusResult {
  if (!alignmentMatrix || !zeroRef) {
    return { score: 0, medianResidualM: 0, count: 0 };
  }
  const n = Math.min(gpsPositions.length, odometryPositions.length);
  if (n < 2) return { score: 0, medianResidualM: 0, count: 0 };

  const start = Math.max(0, n - options.residualWindowSize);
  // `alignmentMatrix` is a length-16 (row/column-major) tuple and only read
  // from here, so pass it straight to gl-matrix as ReadonlyMat4 instead of
  // spreading into `mat4.fromValues` — that spread allocates a fresh
  // Float32Array (and 16 stack args) on every call and truncates to float32.
  // Same kernel pattern as `matrixDelta`.
  const glMat = alignmentMatrix as unknown as ReadonlyMat4;
  const tmp = vec3.create();

  const normalised: number[] = [];
  let rawResidualSum = 0;
  let rawResidualCount = 0;
  for (let i = start; i < n; i++) {
    const odom = odometryPositions[i]!;
    const gps = gpsPositions[i]!;
    vec3.set(tmp, odom[0], odom[1], odom[2]);
    vec3.transformMat4(tmp, tmp, glMat);
    const predicted = calcGpsCoords(zeroRef, tmp);
    const meters = distanceInMeters(predicted, {
      lat: gps.latitude,
      lon: gps.longitude,
    });
    if (!Number.isFinite(meters)) continue;
    rawResidualSum += meters;
    rawResidualCount += 1;
    const acc = Math.max(
      options.gpsAccuracyFloorM,
      gps.latLongAccuracy ?? options.gpsAccuracyFloorM
    );
    normalised.push(meters / acc);
  }

  if (normalised.length < 2) {
    return {
      score: 0,
      medianResidualM:
        rawResidualCount > 0 ? rawResidualSum / rawResidualCount : 0,
      count: normalised.length,
    };
  }
  const medianNorm = interpolatingMedian(normalised);
  const medianResidualM = rawResidualSum / rawResidualCount;
  const score = clamp01(
    1 / (1 + medianNorm / options.residualConfidenceTargetM)
  );
  return { score, medianResidualM, count: normalised.length };
}

// ---------------------------------------------------------------------------
// §4.4 GPS-accuracy budget
// ---------------------------------------------------------------------------

export interface GpsAccuracyResult {
  score: number;
  medianM: number;
  countAccurate: number;
  countTotal: number;
}

/**
 * §4.4 — Median `latLongAccuracy` of the last `K` GPS points, with
 * an "accurate-fix count" diagnostic. Cheap, always available.
 *
 * `score` ramps from 1.0 at median ≤ 3 m to 0.0 at median ≥ 25 m
 * (linear), matching the plan's "≤ 5 m is good" heuristic with a
 * generous fail tail.
 */
export function computeGpsAccuracy(
  gpsPositions: readonly GpsPoint[],
  options: {
    windowSize?: number;
    goodMedianM?: number;
    badMedianM?: number;
  } = {}
): GpsAccuracyResult {
  const windowSize =
    options.windowSize ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.gpsAccuracyWindowSize;
  const goodMedianM = options.goodMedianM ?? 3;
  const badMedianM = options.badMedianM ?? 25;
  if (gpsPositions.length === 0) {
    return { score: 0, medianM: 0, countAccurate: 0, countTotal: 0 };
  }
  const start = Math.max(0, gpsPositions.length - windowSize);
  const accs: number[] = [];
  let countAccurate = 0;
  for (let i = start; i < gpsPositions.length; i++) {
    const acc = gpsPositions[i]!.latLongAccuracy;
    if (typeof acc === 'number' && Number.isFinite(acc)) {
      accs.push(acc);
      if (acc <= 5) countAccurate += 1;
    }
  }
  if (accs.length === 0) {
    return {
      score: 0,
      medianM: 0,
      countAccurate: 0,
      countTotal: gpsPositions.length - start,
    };
  }
  const medianM = interpolatingMedian(accs);
  return {
    score: rampDown(medianM, goodMedianM, badMedianM),
    medianM,
    countAccurate,
    countTotal: accs.length,
  };
}

// ---------------------------------------------------------------------------
// §4.5 baseline coverage
// ---------------------------------------------------------------------------

export interface CoverageResult {
  score: number;
  walkedDistanceM: number;
  directionSpreadDeg: number;
}

/**
 * §4.5 — Coverage = how far the user has walked AND how diverse the
 * walking direction has been. Both required: a long but unidirectional
 * walk leaves the rotation about the walking axis under-determined.
 */
export function computeCoverage(
  odometryPositions: readonly Vector3[],
  options: {
    walkedDistanceM?: number;
    directionSpreadDeg?: number;
  } = {}
): CoverageResult {
  const wThr =
    options.walkedDistanceM ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.coverageWalkedDistanceM;
  const dThr =
    options.directionSpreadDeg ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.coverageDirectionSpreadDeg;

  if (odometryPositions.length < 2) {
    return { score: 0, walkedDistanceM: 0, directionSpreadDeg: 0 };
  }

  let walked = 0;
  const bearings: number[] = [];
  for (let i = 1; i < odometryPositions.length; i++) {
    const a = odometryPositions[i - 1]!;
    const b = odometryPositions[i]!;
    const dN = b[0] - a[0];
    const dE = b[2] - a[2];
    const segLen = Math.hypot(dN, dE);
    if (!Number.isFinite(segLen) || segLen < 1e-4) continue;
    walked += segLen;
    bearings.push(bearingDeg(dN, dE));
  }

  let spread = 0;
  if (bearings.length >= 2) {
    const sorted = [...bearings].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]! - sorted[i - 1]!;
      if (gap > maxGap) maxGap = gap;
    }
    const wrapGap = 360 - sorted[sorted.length - 1]! + sorted[0]!;
    if (wrapGap > maxGap) maxGap = wrapGap;
    spread = Math.max(0, 360 - maxGap);
  }

  const walkScore = rampUp(walked, wThr * 0.25, wThr);
  const spreadScore = rampUp(spread, dThr * 0.25, dThr);
  return {
    score: Math.min(walkScore, spreadScore),
    walkedDistanceM: walked,
    directionSpreadDeg: spread,
  };
}

// ---------------------------------------------------------------------------
// §4.6 GPS-vs-fused divergence (diagnostic only)
// ---------------------------------------------------------------------------

/**
 * §4.6 — Maximum lateral distance between raw GPS positions and the
 * positions you would predict by transforming the matching odometry
 * positions through the current alignment. Diagnostic only — never
 * feeds the aggregate confidence per the plan.
 */
export function computeGpsVsFusedDivergence(
  alignmentMatrix: Matrix4 | null,
  gpsPositions: readonly GpsPoint[],
  odometryPositions: readonly Vector3[],
  zeroRef: LatLong | null,
  windowSize = 16
): number {
  if (!alignmentMatrix || !zeroRef) return 0;
  const n = Math.min(gpsPositions.length, odometryPositions.length);
  if (n < 2) return 0;
  const start = Math.max(0, n - windowSize);
  // Read-only use — cast straight to ReadonlyMat4 to avoid the
  // `mat4.fromValues` spread allocation (see `computeResidualConsensus` /
  // `matrixDelta` for the rationale).
  const glMat = alignmentMatrix as unknown as ReadonlyMat4;
  const tmp = vec3.create();
  let maxDiv = 0;
  for (let i = start; i < n; i++) {
    const odom = odometryPositions[i]!;
    vec3.set(tmp, odom[0], odom[1], odom[2]);
    vec3.transformMat4(tmp, tmp, glMat);
    const predicted = calcGpsCoords(zeroRef, tmp);
    const d = distanceInMeters(predicted, {
      lat: gpsPositions[i]!.latitude,
      lon: gpsPositions[i]!.longitude,
    });
    if (Number.isFinite(d) && d > maxDiv) maxDiv = d;
  }
  return maxDiv;
}

// ===========================================================================
// Slice
// ===========================================================================

const trackingQualitySlice = createSlice({
  name: 'trackingQuality',
  initialState,
  reducers: {
    /**
     * Push a new alignment snapshot. Idempotent: callers must only
     * dispatch when the matrix has actually changed (the listener
     * middleware enforces this).
     */
    snapshotPushed(state, action: PayloadAction<AlignmentSnapshot>) {
      state.recentAlignments.push(action.payload);
    },
    /**
     * Drop oldest snapshots until `length ≤ size`. Separate action so
     * the buffer cap can be applied after `snapshotPushed` without
     * the reducer needing to know the option value.
     */
    snapshotsTrimmed(state, action: PayloadAction<{ size: number }>) {
      const size = Math.max(1, action.payload.size | 0);
      while (state.recentAlignments.length > size) {
        state.recentAlignments.shift();
      }
    },
    reportUpdated(state, action: PayloadAction<TrackingQualityReport | null>) {
      state.report = action.payload;
    },
    /** §4.8 — update the hysteresis counter for ok → degraded holdoff. */
    degradedCountUpdated(state, action: PayloadAction<number>) {
      state.degradedConsecutiveCount = action.payload;
    },
    /**
     * §4.8b (Finding 4) — persist the latest EMA-smoothed convergence so
     * the next aggregator pass can blend against it. `null` resets the
     * filter (next pass seeds from raw).
     */
    smoothedConvergenceUpdated(state, action: PayloadAction<number | null>) {
      state.smoothedConvergence = action.payload;
    },
    /** Full reset — used on new session start / tracking reset. */
    resetTrackingQuality() {
      return initialState;
    },
  },
});

export const {
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  degradedCountUpdated,
  resetTrackingQuality,
} = trackingQualitySlice.actions;

// Module-private: dispatched only by the listener middleware below to persist
// the EMA-smoothed convergence between aggregator passes. Not part of the
// public action surface, so it is intentionally not re-exported.
const { smoothedConvergenceUpdated } = trackingQualitySlice.actions;

export const trackingQualityReducer = trackingQualitySlice.reducer;

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

interface RootWithTrackingQuality {
  trackingQuality?: TrackingQualitySliceState;
}

export function selectTrackingQuality(
  state: RootWithTrackingQuality
): TrackingQualityReport | null {
  return state.trackingQuality?.report ?? null;
}

export function selectRecentAlignments(
  state: RootWithTrackingQuality
): readonly AlignmentSnapshot[] {
  return state.trackingQuality?.recentAlignments ?? EMPTY_SNAPSHOTS;
}

const EMPTY_SNAPSHOTS: readonly AlignmentSnapshot[] = Object.freeze([]);

// ===========================================================================
// Aggregator
// ===========================================================================

/**
 * Pure function — produces a {@link TrackingQualityReport} from a root
 * state and options. The Investigation harness imports this directly to
 * sweep `(N, K)` without going through the Redux listener middleware.
 *
 * The report's `state` enum follows §5 of the plan:
 *   - `ar-lost` whenever `tracking.phase !== 'tracking'`
 *   - `warming-up` until `coverage ≥ warmupMinCoverage` AND
 *     `observationsSeen ≥ warmupMinObservations`
 *   - then `ok` / `degraded` from `min(subScores)` vs.
 *     `degradedThreshold`.
 */
export function computeTrackingQualityReport(
  rootState: CombinedRootState,
  options: TrackingQualityOptions = {}
): TrackingQualityReport {
  const opts: Required<TrackingQualityOptions> = {
    ...DEFAULT_TRACKING_QUALITY_OPTIONS,
    ...options,
  };

  const alignmentMatrix = selectAlignmentMatrix(rootState);
  const gpsPositions = selectGpsPositions(rootState);
  const odometryPositions = selectOdometryPositions(rootState);
  const zeroRef = selectZeroReference(rootState);
  const trackingPhase = selectTrackingPhase(rootState);
  const snapshots = selectRecentAlignments(rootState);

  const coverage = computeCoverage(odometryPositions, {
    walkedDistanceM: opts.coverageWalkedDistanceM,
    directionSpreadDeg: opts.coverageDirectionSpreadDeg,
  });
  const gpsAccuracy = computeGpsAccuracy(gpsPositions, {
    windowSize: opts.gpsAccuracyWindowSize,
  });
  const residual = computeResidualConsensus(
    alignmentMatrix,
    gpsPositions,
    odometryPositions,
    zeroRef,
    {
      residualWindowSize: opts.residualWindowSize,
      residualConfidenceTargetM: opts.residualConfidenceTargetM,
      gpsAccuracyFloorM: opts.gpsAccuracyFloorM,
    }
  );
  const convergence = computeConvergence(snapshots, {
    rotationWarnDeg: opts.convergenceRotationWarnDeg,
    translationWarnM: opts.convergenceTranslationWarnM,
  });
  const gpsVsFusedMaxDivergenceM = computeGpsVsFusedDivergence(
    alignmentMatrix,
    gpsPositions,
    odometryPositions,
    zeroRef
  );

  const subScores = {
    convergence: clamp01(
      emaBlend(
        rootState.trackingQuality?.smoothedConvergence ?? null,
        convergence.score,
        opts.convergenceEmaAlpha
      )
    ),
    residualConsensus: clamp01(residual.score),
    gpsAccuracy: clamp01(gpsAccuracy.score),
    coverage: clamp01(coverage.score),
  };

  const aggregateInputs: number[] = [
    subScores.convergence,
    subScores.residualConsensus,
    subScores.gpsAccuracy,
    subScores.coverage,
  ];
  const confidence = clamp01(Math.min(...aggregateInputs));

  const observationsSeen = gpsPositions.length;

  let state: TrackingQualityState;
  if (trackingPhase !== 'tracking') {
    state = 'ar-lost';
  } else if (
    subScores.coverage < opts.warmupMinCoverage ||
    observationsSeen < opts.warmupMinObservations
  ) {
    state = 'warming-up';
  } else if (confidence < opts.degradedThreshold) {
    state = 'degraded';
  } else {
    state = 'ok';
  }

  return {
    state,
    confidence: state === 'ar-lost' ? 0 : confidence,
    subScores,
    diagnostics: {
      recentSumRotationDeltaDeg: convergence.recentSumRotationDeltaDeg,
      recentSumTranslationDeltaM: convergence.recentSumTranslationDeltaM,
      medianResidualM: residual.medianResidualM,
      medianRecentGpsAccuracyM: gpsAccuracy.medianM,
      walkedDistanceM: coverage.walkedDistanceM,
      directionSpreadDeg: coverage.directionSpreadDeg,
      observationsSeen,
      gpsVsFusedMaxDivergenceM,
    },
  };
}

// ===========================================================================
// Listener middleware — wires the slice to the rest of the store
// ===========================================================================

/**
 * Per-field tolerances for the {@link reportsEqual} dispatch gate.
 *
 * Why this exists: `tracking/poseReceived` fires on *every* XR frame
 * (30–60 fps). The per-frame recompute reuses GPS/odometry windows that
 * are unchanged between pose frames, so the float sub-scores and
 * diagnostics (and `confidence`) jitter by imperceptible floating-point
 * amounts on a held-still device. With a strict `!==` comparison every
 * such frame produced a fresh `reportUpdated` dispatch → high Redux
 * churn and a HUD re-render at frame rate. The tolerances below quantise
 * those sub-perceptual changes so the gate only fires when the
 * user-visible quality actually moved.
 *
 * The gate compares the freshly computed report against the *last
 * dispatched* report (the stored `prev`), not against the previous
 * frame, so slow real drift cannot accumulate indefinitely: once it
 * crosses a tolerance a dispatch fires and re-baselines. Tolerances are
 * chosen below the smallest user-meaningful step in the HUD:
 *  - scores/confidence live in 0..1 → 1e-3 (0.1 %).
 *  - angle diagnostics are shown in whole/tenths of a degree → 0.01°.
 *  - metre diagnostics are shown in centimetres at best → 1 mm.
 */
const REPORT_SCORE_EPSILON = 1e-3;
const REPORT_ANGLE_EPSILON_DEG = 0.01;
const REPORT_METRE_EPSILON_M = 1e-3;

/**
 * Tolerant scalar comparison that treats `null` as a distinct value
 * (both `null` ⇒ equal; exactly one `null` ⇒ different) and otherwise
 * compares with an absolute epsilon. Non-finite values are compared with
 * {@link Object.is}, so a genuine finite↔NaN/Infinity transition still
 * fires a dispatch, but a *persistently* NaN diagnostic does NOT churn
 * the gate every frame — `Object.is(NaN, NaN)` is `true` whereas
 * `NaN === NaN` is `false`.
 */
function nearlyEqual(a: number | null, b: number | null, eps: number): boolean {
  if (a === null || b === null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= eps;
}

/**
 * Deep-equal that only inspects the public shape of a
 * {@link TrackingQualityReport}. Cheaper than a generic deep-equal
 * because it knows the schema; gates `reportUpdated` dispatches so
 * subscribers wake up exactly when the user-visible quality changes.
 *
 * Float fields use the per-field tolerances above
 * ({@link REPORT_SCORE_EPSILON} et al.) so imperceptible per-frame
 * jitter does not churn the store — see the constants' doc comment for
 * the rationale.
 */
function reportsEqual(
  a: TrackingQualityReport | null,
  b: TrackingQualityReport | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.state !== b.state) return false;
  if (!nearlyEqual(a.confidence, b.confidence, REPORT_SCORE_EPSILON)) {
    return false;
  }
  const sa = a.subScores;
  const sb = b.subScores;
  if (
    !nearlyEqual(sa.convergence, sb.convergence, REPORT_SCORE_EPSILON) ||
    !nearlyEqual(
      sa.residualConsensus,
      sb.residualConsensus,
      REPORT_SCORE_EPSILON
    ) ||
    !nearlyEqual(sa.gpsAccuracy, sb.gpsAccuracy, REPORT_SCORE_EPSILON) ||
    !nearlyEqual(sa.coverage, sb.coverage, REPORT_SCORE_EPSILON)
  ) {
    return false;
  }
  const da = a.diagnostics;
  const db = b.diagnostics;
  return (
    da.observationsSeen === db.observationsSeen &&
    nearlyEqual(
      da.recentSumRotationDeltaDeg,
      db.recentSumRotationDeltaDeg,
      REPORT_ANGLE_EPSILON_DEG
    ) &&
    nearlyEqual(
      da.directionSpreadDeg,
      db.directionSpreadDeg,
      REPORT_ANGLE_EPSILON_DEG
    ) &&
    nearlyEqual(
      da.recentSumTranslationDeltaM,
      db.recentSumTranslationDeltaM,
      REPORT_METRE_EPSILON_M
    ) &&
    nearlyEqual(
      da.medianResidualM,
      db.medianResidualM,
      REPORT_METRE_EPSILON_M
    ) &&
    nearlyEqual(
      da.medianRecentGpsAccuracyM,
      db.medianRecentGpsAccuracyM,
      REPORT_METRE_EPSILON_M
    ) &&
    nearlyEqual(
      da.walkedDistanceM,
      db.walkedDistanceM,
      REPORT_METRE_EPSILON_M
    ) &&
    nearlyEqual(
      da.gpsVsFusedMaxDivergenceM,
      db.gpsVsFusedMaxDivergenceM,
      REPORT_METRE_EPSILON_M
    )
  );
}

function matricesNearlyEqual(
  a: readonly number[],
  b: readonly number[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-9) return false;
  }
  return true;
}

/**
 * Action types the listener reacts to. Module-private: consumed only by the
 * listener predicate and middleware below. The strings are the canonical
 * RTK auto-generated action types.
 */
const TRACKING_QUALITY_INPUT_ACTIONS = {
  gpsRecorded: 'gpsData/recordGpsEvent',
  setZeroPos: 'gpsData/setZeroPos',
  poseReceived: 'tracking/poseReceived',
  poseLost: 'tracking/poseLost',
  resetTracking: 'tracking/resetTracking',
  startSession: 'recording/startSession',
} as const;

interface InputActionMatcher {
  type: string;
}
function inputActionPredicate(action: Action): action is InputActionMatcher {
  switch (action.type) {
    case TRACKING_QUALITY_INPUT_ACTIONS.gpsRecorded:
    case TRACKING_QUALITY_INPUT_ACTIONS.setZeroPos:
    case TRACKING_QUALITY_INPUT_ACTIONS.poseReceived:
    case TRACKING_QUALITY_INPUT_ACTIONS.poseLost:
    case TRACKING_QUALITY_INPUT_ACTIONS.resetTracking:
    case TRACKING_QUALITY_INPUT_ACTIONS.startSession:
      return true;
    default:
      return false;
  }
}

/**
 * Build the listener middleware that drives the `trackingQuality`
 * slice. Register the returned middleware in `createSlamAppStore`.
 *
 * Behaviour:
 *  - On `gpsData/recordGpsEvent` and `gpsData/setZeroPos`: if the
 *    alignment matrix changed, dispatch `snapshotPushed` +
 *    `snapshotsTrimmed`. Then recompute the report and dispatch
 *    `reportUpdated` if it changed.
 *  - On `recording/startSession` and `tracking/resetTracking`:
 *    dispatch `resetTrackingQuality` and recompute the report.
 *  - On `tracking/poseReceived` and `tracking/poseLost`: only
 *    recompute the report (no buffer change).
 *  - All dispatches are idempotency-gated so quiet motion does not
 *    churn the store.
 */
export function createTrackingQualityListenerMiddleware(
  options: TrackingQualityOptions = {}
): Middleware {
  const opts: Required<TrackingQualityOptions> = {
    ...DEFAULT_TRACKING_QUALITY_OPTIONS,
    ...options,
  };

  // Use `isAnyOf` matcher equivalent via predicate.
  const listenerMiddleware = createListenerMiddleware();

  // E-1 (2026-07-10 quality review): `tracking/poseReceived` is dispatched on
  // EVERY XR frame (60–90 Hz) but the only report input that changes on pose
  // actions is the tracking phase — every other input moves on GPS/session
  // actions, which always recompute. Skip the O(history) recompute (incl.
  // `computeCoverage`'s full walk + sort) when the phase is unchanged and a
  // report already exists. Side benefit: the §4.8 degraded-holdoff counter now
  // advances per sub-threshold OBSERVATION as its documentation always said,
  // instead of per frame (which collapsed the holdoff to ~50 ms).
  let lastPoseActionPhase: string | null = null;

  listenerMiddleware.startListening({
    predicate: (action: Action) => inputActionPredicate(action),
    effect: (action, api) => {
      const state = api.getState() as CombinedRootState;

      if (
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.startSession ||
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.resetTracking
      ) {
        lastPoseActionPhase = null;
        const tq = (state as unknown as RootWithTrackingQuality)
          .trackingQuality;
        if (
          tq &&
          (tq.recentAlignments.length > 0 ||
            tq.report !== null ||
            tq.degradedConsecutiveCount > 0)
        ) {
          api.dispatch(resetTrackingQuality());
        }
        return;
      }

      if (
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.poseReceived ||
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.poseLost
      ) {
        const phase = selectTrackingPhase(state);
        const existingReport =
          (state as unknown as RootWithTrackingQuality).trackingQuality
            ?.report ?? null;
        if (phase === lastPoseActionPhase && existingReport !== null) {
          return;
        }
        lastPoseActionPhase = phase;
      }

      // Buffer maintenance on alignment-affecting actions.
      if (
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.gpsRecorded ||
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.setZeroPos
      ) {
        const alignment = selectAlignmentMatrix(state);
        if (alignment) {
          const tq = (state as unknown as RootWithTrackingQuality)
            .trackingQuality;
          const buf = tq?.recentAlignments ?? [];
          const newMatrix = alignment as unknown as number[];
          const obsIndex = selectGpsPositions(state).length;
          const last = buf.length > 0 ? buf[buf.length - 1] : null;
          if (!last || !matricesNearlyEqual(last.matrix, newMatrix)) {
            api.dispatch(
              snapshotPushed({
                observationIndex: obsIndex,
                matrix: [...newMatrix],
              })
            );
            api.dispatch(snapshotsTrimmed({ size: opts.matrixHistorySize }));
          }
        }
      }

      // Recompute the report using the post-dispatch state.
      const next = api.getState() as CombinedRootState;
      const report = computeTrackingQualityReport(next, opts);
      const prev =
        (next as unknown as RootWithTrackingQuality).trackingQuality?.report ??
        null;
      const tqNext = (next as unknown as RootWithTrackingQuality)
        .trackingQuality;

      // §4.8 hysteresis: fast-rise / slow-fall on ok ↔ degraded.
      // Only suppress ok→degraded; degraded→ok is immediate, ar-lost
      // bypasses holdoff entirely.
      let dcc = tqNext?.degradedConsecutiveCount ?? 0;
      if (report.state === 'degraded') {
        dcc += 1;
        if (prev?.state === 'ok' && dcc < opts.degradedHoldoff) {
          report.state = 'ok';
        }
      } else {
        dcc = 0;
      }
      if (dcc !== (tqNext?.degradedConsecutiveCount ?? 0)) {
        api.dispatch(degradedCountUpdated(dcc));
      }

      // §4.8b (Finding 4): persist the smoothed convergence so the next
      // aggregator pass can blend against it. The report already carries
      // the new value via `subScores.convergence`.
      const newSmoothed = report.subScores.convergence;
      if (newSmoothed !== (tqNext?.smoothedConvergence ?? null)) {
        api.dispatch(smoothedConvergenceUpdated(newSmoothed));
      }

      if (!reportsEqual(prev, report)) {
        api.dispatch(reportUpdated(report));
      }
    },
  });

  return listenerMiddleware.middleware;
}
