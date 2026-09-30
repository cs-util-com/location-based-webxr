/**
 * Measurement Points Slice — RTK state for the measurement-point marking flow.
 *
 * Mirrors the ref-points-slice.ts pattern: a createSlice with typed reducers,
 * registered in recorder-store.ts via extraReducers + persistedExtraPrefixes
 * so every action is persisted to the action log and replays deterministically.
 *
 * The slice owns:
 *  - Pending rays (accumulated during the marking flow, pre-confirm)
 *  - Confirmed measurement points (persisted to disk)
 *  - Draft state (live measurement quality/coaching, driven by reduceLiveMeasurementDraft)
 *
 * The `selectProvisionalMeasurement` memoized selector runs the MSAC solver
 * on pending rays, providing a single source of truth for both the provisional
 * Three.js sphere and the UI coaching banner.
 *
 * FIX 4: All selectors take CombinedRootState (via type-only import) for RTK consistency.
 * FIX 5: hydrateMeasurementPoints reducer deduplicates by id for replay safety.
 * FIX 6: Draft state machine integrated — reduceLiveMeasurementDraft is called
 *         inside addMeasurementRay / undoMeasurementRay for replay determinism.
 *         Confirm is split into request/success/failure for async OPFS flow.
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSelector, createSlice } from '@reduxjs/toolkit';
import type {
  MeasurementRayRecord,
  MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import {
  solveRobustTriangulation,
  type MeasurementRayObservation,
  type RobustTriangulationResult,
} from '../utils/robust-triangulation';
import {
  reduceLiveMeasurementDraft,
  computeLateralBaselineM,
  type LiveMeasurementDraft,
  type QualityInputs,
  type QualityThresholds,
} from '../utils/live-measurement-quality';

// Type-only import avoids runtime circular dependency
// (recorder-store.ts imports from this file).
import type { CombinedRootState } from './recorder-store';

// ---------------------------------------------------------------------------
// Default quality thresholds
// ---------------------------------------------------------------------------

/**
 * Default quality thresholds for the measurement draft state machine.
 * These are persisted on the draft so replay uses the exact policy active
 * at capture time even if defaults change in a future release.
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  thresholdProfileId: 'default-v1',
  thresholdVersion: 1,
  minInliers: 2,
  minBaselineM: 0.5,
  targetUncertainty: 0.05,
  maxUncertaintyHard: 0.2,
  maxRmsError: 0.1,
  maxObservationAgeMs: 2000,
  maxPoseDepthSkewMs: 100,
  readyEnterScore: 0.75,
  readyExitScore: 0.6,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeasurementPointsState {
  /** Rays accumulated for the currently-being-measured point (pre-confirm) */
  readonly pendingRays: MeasurementRayRecord[];
  /** Confirmed, persisted measurement points */
  readonly confirmed: MeasurementPointEntity[];
  /** Live draft state machine — drives coaching UI and confirm gating */
  readonly draft: LiveMeasurementDraft;
}

const INITIAL_DRAFT: LiveMeasurementDraft = {
  status: 'idle',
  prompt: 'none',
  canConfirm: false,
  lastQualityScore: 0,
  thresholdProfileId: DEFAULT_QUALITY_THRESHOLDS.thresholdProfileId,
  thresholdVersion: DEFAULT_QUALITY_THRESHOLDS.thresholdVersion,
};

const initialState: MeasurementPointsState = {
  pendingRays: [],
  confirmed: [],
  draft: INITIAL_DRAFT,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a MeasurementRayRecord (persistence shape) to the
 * MeasurementRayObservation (solver shape) expected by
 * solveRobustTriangulation.
 */
function toSolverObservation(
  ray: MeasurementRayRecord
): MeasurementRayObservation {
  return {
    id: ray.id,
    timestamp: ray.timestamp,
    rayOrigin: ray.rayOrigin,
    rayDirection: ray.rayDirection,
    rayWeight: ray.rayWeight,
    depthPoint: ray.depthPoint,
    depthWeight: ray.depthWeight,
  };
}

/**
 * Build QualityInputs from the current pending rays and solver result.
 * All computations are deterministic and replay-safe because they only
 * depend on the frozen action payloads stored in pendingRays.
 */
function buildQualityInputs(
  pendingRays: readonly MeasurementRayRecord[],
  solverResult: RobustTriangulationResult | null,
  currentTimestamp: number
): QualityInputs {
  const rayOrigins = pendingRays.map((r) => ({
    x: r.rayOrigin[0],
    y: r.rayOrigin[1],
    z: r.rayOrigin[2],
  }));
  const meanDir =
    pendingRays.length > 0
      ? {
          x:
            pendingRays.reduce((s, r) => s + r.rayDirection[0], 0) /
            pendingRays.length,
          y:
            pendingRays.reduce((s, r) => s + r.rayDirection[1], 0) /
            pendingRays.length,
          z:
            pendingRays.reduce((s, r) => s + r.rayDirection[2], 0) /
            pendingRays.length,
        }
      : { x: 0, y: 0, z: -1 };

  const baselineM = computeLateralBaselineM(rayOrigins, meanDir);

  // Measure freshness from the newest observation. Older rays remain useful
  // for fusion; using the oldest ray made every long draft stale while the
  // user was still actively capturing.
  const newestTimestamp =
    pendingRays.length > 0
      ? Math.max(...pendingRays.map((r) => r.timestamp))
      : currentTimestamp;
  const observationAgeMs = currentTimestamp - newestTimestamp;
  const poseDepthTimeSkewMs = pendingRays.reduce((maxSkew, ray) => {
    if (ray.depthTimestamp === undefined) return maxSkew;
    return Math.max(maxSkew, Math.abs(ray.timestamp - ray.depthTimestamp));
  }, 0);

  return {
    uncertainty: solverResult?.uncertainty ?? null,
    rmsError: solverResult?.rmsError ?? null,
    baselineM,
    rayCount: pendingRays.length,
    inlierCount: solverResult?.inlierIds.length ?? 0,
    hasSolvedPoint: solverResult !== null,
    solverDegenerate: false,
    observationAgeMs,
    poseDepthTimeSkewMs,
  };
}

function getLatestObservationTimestamp(
  pendingRays: readonly MeasurementRayRecord[]
): number {
  return pendingRays.reduce(
    (latest, ray) => Math.max(latest, ray.timestamp),
    0
  );
}

/**
 * Recompute the draft state after a ray add/remove.
 * Runs the solver + quality evaluator purely from the pending rays.
 */
function recomputeDraft(
  pendingRays: readonly MeasurementRayRecord[],
  currentDraft: LiveMeasurementDraft,
  currentTimestamp: number
): LiveMeasurementDraft {
  if (pendingRays.length === 0) {
    return INITIAL_DRAFT;
  }

  const solverObs = pendingRays.map(toSolverObservation);
  const solverResult = solveRobustTriangulation(solverObs);
  const inputs = buildQualityInputs(
    pendingRays,
    solverResult,
    currentTimestamp
  );

  const nextDraft = reduceLiveMeasurementDraft(
    currentDraft,
    inputs,
    DEFAULT_QUALITY_THRESHOLDS
  );

  // Attach the provisional point for UI rendering
  if (solverResult) {
    return {
      ...nextDraft,
      provisionalPointAr: {
        x: solverResult.point[0],
        y: solverResult.point[1],
        z: solverResult.point[2],
      },
      uncertainty: solverResult.uncertainty,
    };
  }
  return nextDraft;
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const measurementPointsSlice = createSlice({
  name: 'measurementPoints',
  initialState,
  reducers: {
    addMeasurementRay(state, action: PayloadAction<MeasurementRayRecord>) {
      // A confirmed point ends one draft; the next ray starts a new one.
      if (state.draft.status === 'confirmed') {
        state.draft = INITIAL_DRAFT;
      }
      // Immer Draft widens readonly tuples; assert through.
      state.pendingRays.push(
        action.payload as (typeof state.pendingRays)[number]
      );
      // FIX 6: recompute draft state from the solver + quality evaluator
      state.draft = recomputeDraft(
        state.pendingRays,
        state.draft,
        action.payload.timestamp
      );
    },

    undoMeasurementRay(state) {
      const removed = state.pendingRays.pop();
      // FIX 6: recompute draft after undo
      const timestamp =
        removed?.timestamp ?? getLatestObservationTimestamp(state.pendingRays);
      state.draft = recomputeDraft(state.pendingRays, state.draft, timestamp);
    },

    /**
     * FIX 6: Step 1 of the async confirm flow.
     * Draft transitions to confirm_pending, UI blocks the confirm button.
     */
    requestConfirmMeasurement(
      state,
      action: PayloadAction<
        { confirmationMode?: 'quality' | 'override' } | undefined
      >
    ) {
      state.draft = reduceLiveMeasurementDraft(
        state.draft,
        // Inputs don't matter for lifecycle events — the handler checks status only
        buildQualityInputs(
          state.pendingRays,
          null,
          getLatestObservationTimestamp(state.pendingRays)
        ),
        DEFAULT_QUALITY_THRESHOLDS,
        {
          type: 'confirmRequested',
          confirmationMode: action.payload?.confirmationMode,
        }
      );
    },

    /**
     * FIX 6: Step 2a — OPFS write succeeded.
     * Moves pending rays to confirmed, clears pending, draft → confirmed.
     */
    confirmMeasurementSuccess(
      state,
      action: PayloadAction<MeasurementPointEntity>
    ) {
      state.confirmed.push(action.payload as (typeof state.confirmed)[number]);
      state.pendingRays = [];
      state.draft = reduceLiveMeasurementDraft(
        state.draft,
        buildQualityInputs([], null, 0),
        DEFAULT_QUALITY_THRESHOLDS,
        { type: 'confirmSucceeded' }
      );
    },

    /**
     * FIX 6: Step 2b — OPFS write failed.
     * Draft → confirm_failed, allowing user to retry.
     */
    confirmMeasurementFailure(state) {
      state.draft = reduceLiveMeasurementDraft(
        state.draft,
        buildQualityInputs(
          state.pendingRays,
          null,
          getLatestObservationTimestamp(state.pendingRays)
        ),
        DEFAULT_QUALITY_THRESHOLDS,
        { type: 'confirmFailed' }
      );
    },

    /**
     * Legacy confirm action — kept for backwards compatibility with
     * action logs that used the old single-step confirm.
     * Behaves like confirmMeasurementSuccess.
     */
    confirmMeasurementPoint(
      state,
      action: PayloadAction<MeasurementPointEntity>
    ) {
      state.confirmed.push(action.payload as (typeof state.confirmed)[number]);
      state.pendingRays = [];
      state.draft = INITIAL_DRAFT;
    },

    deleteMeasurementPoint(state, action: PayloadAction<{ id: string }>) {
      state.confirmed = state.confirmed.filter(
        (p) => p.id !== action.payload.id
      );
    },

    resetMeasurementPoints() {
      return initialState;
    },

    /**
     * FIX 5: Hydrate confirmed points from OPFS on scenario load.
     * Deduplicates by id to prevent double-counting when both OPFS
     * load and action replay produce the same confirmed entity.
     */
    hydrateMeasurementPoints(
      state,
      action: PayloadAction<MeasurementPointEntity[]>
    ) {
      const existingIds = new Set(state.confirmed.map((p) => p.id));
      for (const entity of action.payload) {
        if (!existingIds.has(entity.id)) {
          state.confirmed.push(entity as (typeof state.confirmed)[number]);
          existingIds.add(entity.id);
        }
      }
    },
  },
});

export const {
  addMeasurementRay,
  confirmMeasurementPoint,
  deleteMeasurementPoint,
  undoMeasurementRay,
  resetMeasurementPoints,
  hydrateMeasurementPoints,
  requestConfirmMeasurement,
  confirmMeasurementSuccess,
  confirmMeasurementFailure,
} = measurementPointsSlice.actions;

export const measurementPointsReducer = measurementPointsSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors — FIX 4: all take CombinedRootState, not MeasurementPointsState
// ---------------------------------------------------------------------------

const EMPTY_RAYS: readonly MeasurementRayRecord[] = Object.freeze([]);

/**
 * Returns the pending rays array. When empty, returns a stable sentinel
 * so reselect subscribers don't re-render on unrelated dispatches.
 */
export const selectPendingRays = createSelector(
  (state: CombinedRootState) => state.measurementPoints.pendingRays,
  (rays): readonly MeasurementRayRecord[] =>
    rays.length === 0 ? EMPTY_RAYS : rays
);

/**
 * Memoized selector that runs the MSAC solver on the pending rays.
 * Provides the single source of truth for the provisional UI coaching
 * banner and the live Three.js provisional sphere.
 *
 * Returns null when there are no pending rays, or when the solver
 * cannot find a valid solution (e.g. single ray without depth).
 */
export const selectProvisionalMeasurement = createSelector(
  (state: CombinedRootState) => state.measurementPoints.pendingRays,
  (pendingRays): RobustTriangulationResult | null => {
    if (pendingRays.length === 0) return null;
    const solverObs = pendingRays.map(toSolverObservation);
    return solveRobustTriangulation(solverObs);
  }
);

const EMPTY_CONFIRMED: readonly MeasurementPointEntity[] = Object.freeze([]);

/**
 * Returns the confirmed measurement points. Stable sentinel when empty.
 */
export const selectConfirmedMeasurementPoints = createSelector(
  (state: CombinedRootState) => state.measurementPoints.confirmed,
  (confirmed): readonly MeasurementPointEntity[] =>
    confirmed.length === 0 ? EMPTY_CONFIRMED : confirmed
);

/**
 * FIX 6: Returns the current draft state for UI coaching and confirm gating.
 * Plain selector (not createSelector) — the draft sub-tree is already a
 * distinct reference, so memoization would be an identity function.
 */
export function selectMeasurementDraft(
  state: CombinedRootState
): LiveMeasurementDraft {
  return state.measurementPoints.draft;
}
