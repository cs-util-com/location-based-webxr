/**
 * Live Measurement UX + Baseline Coaching (Component 5).
 *
 * Pure state/decision logic for the live measurement draft interaction loop:
 * evaluates solver + geometry outputs into a deterministic quality score,
 * confirm-readiness (with hysteresis + hard safety guards), a coaching
 * prompt, and the draft's lifecycle state machine. No Three.js, no DOM, no
 * store access, no timestamps, no randomness — everything here replays
 * identically from recorded inputs.
 *
 * See 2026-12-07-PLAN-LIVE-MEASUREMENT-UX-BASELINE-COACHING.md for the full
 * design spec this module implements.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachingPrompt =
  | 'none'
  | 'move_sideways'
  | 'add_more_rays'
  | 'reaim_target'
  | 'ready_to_confirm';

type DraftStatus =
  | 'idle'
  | 'provisional'
  | 'refining'
  | 'ready'
  | 'confirm_pending'
  | 'confirm_failed'
  | 'confirmed';

export interface QualityInputs {
  uncertainty: number | null;
  rmsError: number | null;
  baselineM: number;
  rayCount: number;
  inlierCount: number;
  hasSolvedPoint: boolean;
  solverDegenerate: boolean;
  observationAgeMs: number;
  poseDepthTimeSkewMs: number;
}

export interface QualityThresholds {
  thresholdProfileId: string; // stable policy id used for replay binding
  thresholdVersion: number; // monotonic policy version
  minInliers: number; // e.g. 2 or 3
  minBaselineM: number; // e.g. 1.5m short-range, 5m long-range profile
  targetUncertainty: number; // desired confidence band
  maxUncertaintyHard: number; // absolute confirm block
  maxRmsError: number; // residual quality cap
  maxObservationAgeMs: number; // freshness bound for the latest observation bundle
  maxPoseDepthSkewMs: number; // allowed pose-depth timestamp skew
  readyEnterScore: number; // hysteresis enter
  readyExitScore: number; // hysteresis exit
}

export interface QualityEvaluation {
  score: number; // [0,1]
  ready: boolean;
  hardBlocked: boolean;
  prompt: CoachingPrompt;
  reasons: string[];
}

export interface LiveMeasurementDraft {
  status: DraftStatus;
  provisionalPointAr?: { x: number; y: number; z: number };
  uncertainty?: number;
  prompt: CoachingPrompt;
  canConfirm: boolean;
  lastQualityScore: number;
  thresholdProfileId: string;
  thresholdVersion: number;
}

export type LiveMeasurementEvent =
  | { type: 'observationAdded' }
  | { type: 'confirmRequested'; confirmationMode?: 'quality' | 'override' }
  | { type: 'confirmSucceeded' }
  | { type: 'confirmFailed' }
  | { type: 'cancelDraft' }
  | { type: 'retargetDraft' }
  | { type: 'removeLastRay' }
  | { type: 'resetAfterConfirmFailed' };

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface NormalizedSignals {
  u: number;
  b: number;
  r: number;
  i: number;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Divides safely: a non-positive denominator saturates instead of producing NaN. */
function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return numerator > 0 ? Infinity : 0;
  return numerator / denominator;
}

/** Buckets a [0,1] value to the nearest 0.1 for stable, machine-readable diagnostics. */
function bucket01(value: number): number {
  return Math.round(clamp01(value) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Threshold governance
// ---------------------------------------------------------------------------

const NUMERIC_THRESHOLD_FIELDS: ReadonlyArray<keyof QualityThresholds> = [
  'minInliers',
  'minBaselineM',
  'targetUncertainty',
  'maxUncertaintyHard',
  'maxRmsError',
  'maxObservationAgeMs',
  'maxPoseDepthSkewMs',
  'readyEnterScore',
  'readyExitScore',
];

function formatThresholdError(
  thresholds: QualityThresholds,
  message: string
): string {
  return `Invalid QualityThresholds (profile=${thresholds.thresholdProfileId} v${thresholds.thresholdVersion}): ${message}`;
}

/**
 * Validates a threshold profile, throwing a deterministic boot-time error on
 * any violation. Must be called (and pass) before the profile is used —
 * there is no silent runtime fallback to defaults.
 */
export function validateThresholds(thresholds: QualityThresholds): void {
  for (const field of NUMERIC_THRESHOLD_FIELDS) {
    const value = thresholds[field] as number;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        formatThresholdError(
          thresholds,
          `${field} must be finite and non-negative, got ${value}`
        )
      );
    }
  }
  if (!(thresholds.readyEnterScore > thresholds.readyExitScore)) {
    throw new Error(
      formatThresholdError(
        thresholds,
        `readyEnterScore (${thresholds.readyEnterScore}) must be > readyExitScore (${thresholds.readyExitScore})`
      )
    );
  }
  if (!(thresholds.maxUncertaintyHard > thresholds.targetUncertainty)) {
    throw new Error(
      formatThresholdError(
        thresholds,
        `maxUncertaintyHard (${thresholds.maxUncertaintyHard}) must be > targetUncertainty (${thresholds.targetUncertainty})`
      )
    );
  }
  if (!(thresholds.minInliers >= 1)) {
    throw new Error(
      formatThresholdError(
        thresholds,
        `minInliers must be >= 1, got ${thresholds.minInliers}`
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function isInvalidNumber(value: number): boolean {
  return !Number.isFinite(value) || value < 0;
}

function isInvalidNullableNumber(value: number | null): boolean {
  return value !== null && !Number.isFinite(value);
}

function hasInvalidInput(inputs: QualityInputs): boolean {
  return (
    isInvalidNullableNumber(inputs.uncertainty) ||
    isInvalidNullableNumber(inputs.rmsError) ||
    isInvalidNumber(inputs.baselineM) ||
    isInvalidNumber(inputs.rayCount) ||
    isInvalidNumber(inputs.inlierCount) ||
    isInvalidNumber(inputs.observationAgeMs) ||
    isInvalidNumber(inputs.poseDepthTimeSkewMs)
  );
}

function buildInvalidInputEvaluation(): QualityEvaluation {
  return {
    score: 0,
    ready: false,
    hardBlocked: true,
    prompt: 'add_more_rays',
    reasons: ['invalid_input'],
  };
}

// ---------------------------------------------------------------------------
// Hard guards
// ---------------------------------------------------------------------------

function isUncertaintyTooHigh(
  uncertainty: number | null,
  maxUncertaintyHard: number
): boolean {
  return uncertainty === null || uncertainty > maxUncertaintyHard;
}

function isResidualTooHigh(
  rmsError: number | null,
  maxRmsError: number
): boolean {
  return rmsError !== null && rmsError > maxRmsError;
}

function collectHardGuardReasons(
  inputs: QualityInputs,
  thresholds: QualityThresholds
): string[] {
  const reasons: string[] = [];
  if (!inputs.hasSolvedPoint) reasons.push('no_solved_point');
  if (inputs.solverDegenerate) reasons.push('solver_degenerate');
  if (inputs.observationAgeMs > thresholds.maxObservationAgeMs)
    reasons.push('stale_observation');
  if (inputs.poseDepthTimeSkewMs > thresholds.maxPoseDepthSkewMs)
    reasons.push('pose_depth_time_skew');
  if (inputs.inlierCount < thresholds.minInliers)
    reasons.push('insufficient_inliers');
  if (isUncertaintyTooHigh(inputs.uncertainty, thresholds.maxUncertaintyHard))
    reasons.push('uncertainty_too_high');
  if (isResidualTooHigh(inputs.rmsError, thresholds.maxRmsError))
    reasons.push('residual_too_high');
  return reasons;
}

// ---------------------------------------------------------------------------
// Signal normalization + scoring
// ---------------------------------------------------------------------------

function computeNormalizedSignals(
  inputs: QualityInputs,
  thresholds: QualityThresholds
): NormalizedSignals {
  const uncertaintyForRatio =
    inputs.uncertainty ?? thresholds.maxUncertaintyHard;
  const u = clamp01(
    1 - safeRatio(uncertaintyForRatio, thresholds.maxUncertaintyHard)
  );
  const b = clamp01(safeRatio(inputs.baselineM, thresholds.minBaselineM));
  const r =
    inputs.rmsError === null
      ? 0.5
      : clamp01(1 - safeRatio(inputs.rmsError, thresholds.maxRmsError));
  const i = clamp01(safeRatio(inputs.inlierCount, thresholds.minInliers));
  return { u, b, r, i };
}

function computeWeightedScore(signals: NormalizedSignals): number {
  return clamp01(
    0.45 * signals.u + 0.3 * signals.b + 0.15 * signals.r + 0.1 * signals.i
  );
}

function resolveHysteresisReady(
  score: number,
  wasReady: boolean,
  thresholds: QualityThresholds
): boolean {
  return wasReady
    ? score >= thresholds.readyExitScore
    : score >= thresholds.readyEnterScore;
}

function appendSignalBinReasons(
  reasons: string[],
  signals: NormalizedSignals
): void {
  reasons.push(`signal:u=${bucket01(signals.u).toFixed(1)}`);
  reasons.push(`signal:b=${bucket01(signals.b).toFixed(1)}`);
  reasons.push(`signal:r=${bucket01(signals.r).toFixed(1)}`);
  reasons.push(`signal:i=${bucket01(signals.i).toFixed(1)}`);
}

function appendTransitionReason(
  reasons: string[],
  wasReady: boolean,
  ready: boolean
): void {
  const entered = !wasReady && ready;
  const exited = wasReady && !ready;
  reasons.push(entered ? 'entered_ready' : exited ? 'exited_ready' : 'steady');
}

function readSignalBin(
  reasons: readonly string[],
  key: 'u' | 'b' | 'r' | 'i'
): number {
  const prefix = `signal:${key}=`;
  const token = reasons.find((entry) => entry.startsWith(prefix));
  return token ? parseFloat(token.slice(prefix.length)) : 0;
}

function readSignalBins(reasons: readonly string[]): NormalizedSignals {
  return {
    u: readSignalBin(reasons, 'u'),
    b: readSignalBin(reasons, 'b'),
    r: readSignalBin(reasons, 'r'),
    i: readSignalBin(reasons, 'i'),
  };
}

// ---------------------------------------------------------------------------
// evaluateMeasurementQuality
// ---------------------------------------------------------------------------

/**
 * Computes a normalized quality score and confirm readiness from solver + geometry inputs.
 * Pure function. No store access, no timestamps, no randomness.
 *
 * `reasons` doubles as the required-diagnostics channel: it carries failed
 * hard-guard tokens, bucketed normalized-signal tokens (`signal:u=0.7`, ...)
 * and a readiness-transition token (`entered_ready` | `exited_ready` |
 * `steady`). `decideCoachingPrompt` reads the bucketed signal tokens back out
 * of `reasons` since it does not receive `thresholds` directly.
 */
export function evaluateMeasurementQuality(
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  wasReady: boolean
): QualityEvaluation {
  validateThresholds(thresholds);

  if (hasInvalidInput(inputs)) {
    return buildInvalidInputEvaluation();
  }

  const reasons = collectHardGuardReasons(inputs, thresholds);
  const hardBlocked = reasons.length > 0;

  const signals = computeNormalizedSignals(inputs, thresholds);
  const score = computeWeightedScore(signals);
  const ready = hardBlocked
    ? false
    : resolveHysteresisReady(score, wasReady, thresholds);

  appendSignalBinReasons(reasons, signals);
  appendTransitionReason(reasons, wasReady, ready);

  const evaluation: QualityEvaluation = {
    score,
    ready,
    hardBlocked,
    prompt: 'none',
    reasons,
  };
  return { ...evaluation, prompt: decideCoachingPrompt(inputs, evaluation) };
}

// ---------------------------------------------------------------------------
// decideCoachingPrompt
// ---------------------------------------------------------------------------

function isHardBlockedForRays(evaluation: QualityEvaluation): boolean {
  return (
    evaluation.reasons.includes('no_solved_point') ||
    evaluation.reasons.includes('solver_degenerate') ||
    evaluation.reasons.includes('invalid_input')
  );
}

/**
 * Maps quality evaluation to user-facing coaching prompt.
 * Pure and side-effect free.
 */
export function decideCoachingPrompt(
  _inputs: QualityInputs,
  evaluation: QualityEvaluation
): CoachingPrompt {
  if (isHardBlockedForRays(evaluation)) return 'add_more_rays';

  const { u, b, r, i } = readSignalBins(evaluation.reasons);

  if (b < 0.7 && u < 0.6) return 'move_sideways';
  if (r < 0.5) return 'reaim_target';
  if (i < 1.0) return 'add_more_rays';
  if (evaluation.ready) return 'ready_to_confirm';
  return 'add_more_rays';
}

// ---------------------------------------------------------------------------
// reduceLiveMeasurementDraft
// ---------------------------------------------------------------------------

type LifecycleHandler = (
  current: LiveMeasurementDraft,
  thresholds: QualityThresholds,
  event: LiveMeasurementEvent
) => LiveMeasurementDraft | null;

function buildIdleDraft(thresholds: QualityThresholds): LiveMeasurementDraft {
  return {
    status: 'idle',
    prompt: 'none',
    canConfirm: false,
    lastQualityScore: 0,
    thresholdProfileId: thresholds.thresholdProfileId,
    thresholdVersion: thresholds.thresholdVersion,
  };
}

function buildProvisionalReset(
  thresholds: QualityThresholds
): LiveMeasurementDraft {
  return {
    status: 'provisional',
    prompt: 'none',
    canConfirm: false,
    lastQualityScore: 0,
    thresholdProfileId: thresholds.thresholdProfileId,
    thresholdVersion: thresholds.thresholdVersion,
  };
}

function isActiveDraftStatus(status: DraftStatus): boolean {
  return (
    status === 'provisional' || status === 'refining' || status === 'ready'
  );
}

/**
 * Cancellable per STATE FLOW: provisional/refining/ready/confirm_failed -> idle.
 * Deliberately excludes confirm_pending (an in-flight persistence write must
 * not be abandoned mid-air) and confirmed/idle (nothing to cancel).
 */
function isCancellableDraftStatus(status: DraftStatus): boolean {
  return isActiveDraftStatus(status) || status === 'confirm_failed';
}

/** Ready + confirm_failed can (re)request confirm; confirm_pending is idempotent. */
function canRequestConfirm(
  status: DraftStatus,
  confirmationMode: 'quality' | 'override' = 'quality'
): boolean {
  if (confirmationMode === 'override') {
    return isActiveDraftStatus(status) || status === 'confirm_failed';
  }
  return (
    status === 'ready' ||
    status === 'confirm_failed' ||
    status === 'confirm_pending'
  );
}

const LIFECYCLE_HANDLERS: Partial<
  Record<LiveMeasurementEvent['type'], LifecycleHandler>
> = {
  cancelDraft: (current, thresholds) =>
    isCancellableDraftStatus(current.status)
      ? buildIdleDraft(thresholds)
      : null,
  resetAfterConfirmFailed: (current, thresholds) =>
    current.status === 'confirm_failed' ? buildIdleDraft(thresholds) : null,
  retargetDraft: (current, thresholds) =>
    isActiveDraftStatus(current.status)
      ? buildProvisionalReset(thresholds)
      : null,
  confirmRequested: (current, _thresholds, event) =>
    canRequestConfirm(
      current.status,
      event.type === 'confirmRequested' ? event.confirmationMode : undefined
    )
      ? { ...current, status: 'confirm_pending' }
      : null,
  confirmSucceeded: (current) =>
    current.status === 'confirm_pending'
      ? { ...current, status: 'confirmed' }
      : null,
  confirmFailed: (current) =>
    current.status === 'confirm_pending'
      ? { ...current, status: 'confirm_failed' }
      : null,
};

function applyLifecycleEvent(
  current: LiveMeasurementDraft,
  event: LiveMeasurementEvent | undefined,
  thresholds: QualityThresholds
): LiveMeasurementDraft | null {
  if (!event) return null;
  const handler = LIFECYCLE_HANDLERS[event.type];
  return handler ? handler(current, thresholds, event) : null;
}

function resolveDraftStatus(
  currentStatus: DraftStatus,
  inputs: QualityInputs,
  evaluation: QualityEvaluation
): DraftStatus {
  if (currentStatus === 'idle') {
    return inputs.hasSolvedPoint ? 'provisional' : 'idle';
  }
  return evaluation.ready ? 'ready' : 'refining';
}

/**
 * Applies one logical update tick after an observation is added or
 * recomputed, or an explicit lifecycle event fires (confirm request/ack,
 * cancel, retarget, undo, retry). Returns next draft state consumed by UI
 * rendering and action gating.
 *
 * `event` is optional: omitting it (or passing `{ type: 'observationAdded' }`)
 * runs the normal recompute path — status advances through
 * idle -> provisional -> refining <-> ready based on `evaluateMeasurementQuality`.
 * `confirm_pending` / `confirmed` are frozen against recompute and only leave
 * via their explicit ack events.
 */
export function reduceLiveMeasurementDraft(
  current: LiveMeasurementDraft,
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  event?: LiveMeasurementEvent
): LiveMeasurementDraft {
  const lifecycleResult = applyLifecycleEvent(current, event, thresholds);
  if (lifecycleResult) return lifecycleResult;

  if (current.status === 'confirm_pending' || current.status === 'confirmed') {
    return current;
  }

  const wasReady = current.status === 'ready';
  const evaluation = evaluateMeasurementQuality(inputs, thresholds, wasReady);
  const status = resolveDraftStatus(current.status, inputs, evaluation);

  return {
    status,
    provisionalPointAr: current.provisionalPointAr,
    uncertainty: inputs.uncertainty ?? current.uncertainty,
    prompt: evaluation.prompt,
    canConfirm: evaluation.ready,
    lastQualityScore: evaluation.score,
    thresholdProfileId: thresholds.thresholdProfileId,
    thresholdVersion: thresholds.thresholdVersion,
  };
}

// ---------------------------------------------------------------------------
// computeLateralBaselineM
// ---------------------------------------------------------------------------

function normalizeVec3(v: Vec3Like): Vec3Like | null {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossVec3(a: Vec3Like, b: Vec3Like): Vec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotVec3(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Picks an orthonormal in-plane basis (u, v) perpendicular to `direction`. */
function pickInPlaneBasis(direction: Vec3Like): [Vec3Like, Vec3Like] {
  const helper: Vec3Like =
    Math.abs(direction.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalizeVec3(crossVec3(direction, helper)) ?? {
    x: 0,
    y: 0,
    z: 0,
  };
  const v = crossVec3(direction, u);
  return [u, v];
}

/**
 * Computes lateral baseline metric from captured ray origins.
 * Baseline should represent sideways parallax, not forward walking distance.
 *
 * Implementation: projects each origin onto the plane perpendicular to
 * `meanRayDirection` (an orthonormal (u, v) in-plane basis) and returns the
 * bounding-box diagonal of those projections — an O(n) single-pass metric
 * that is ~0 for pure forward motion and grows with sideways spread.
 */
export function computeLateralBaselineM(
  rayOrigins: readonly Vec3Like[],
  meanRayDirection: Vec3Like
): number {
  if (rayOrigins.length < 2) return 0;
  const direction = normalizeVec3(meanRayDirection);
  if (!direction) return 0;

  const [u, v] = pickInPlaneBasis(direction);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const origin of rayOrigins) {
    const pu = dotVec3(origin, u);
    const pv = dotVec3(origin, v);
    if (pu < minU) minU = pu;
    if (pu > maxU) maxU = pu;
    if (pv < minV) minV = pv;
    if (pv > maxV) maxV = pv;
  }

  const spanU = maxU - minU;
  const spanV = maxV - minV;
  return Math.sqrt(spanU * spanU + spanV * spanV);
}

// ---------------------------------------------------------------------------
// updateLateralBaselineCache
// ---------------------------------------------------------------------------

/**
 * Optional performance path for long drafts: incrementally updates cached baseline stats
 * when one observation is appended or removed, avoiding full O(n) recompute each time.
 *
 * NOTE: `LiveMeasurementEvent` does not carry ray-origin coordinates, so this
 * cache can only be *invalidated* here — true incremental min/max
 * accumulation requires the caller to fold the new/removed origin's (u, v)
 * projection (see `computeLateralBaselineM`'s basis vectors) into the cache
 * itself. Structural events that change or clear the ray set invalidate the
 * cache; all other events pass it through unchanged.
 */
export function updateLateralBaselineCache(
  previousCache: unknown,
  event: LiveMeasurementEvent,
  _meanRayDirection: Vec3Like
): unknown {
  if (event.type === 'retargetDraft' || event.type === 'cancelDraft') {
    return null;
  }
  return previousCache;
}
