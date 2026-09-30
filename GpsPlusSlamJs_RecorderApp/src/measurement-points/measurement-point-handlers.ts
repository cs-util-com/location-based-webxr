/**
 * Measurement Point Handlers
 *
 * Encapsulates the side-effect orchestration for the measurement-point
 * marking flow: capturing rays, persisting confirmed points, and deleting.
 *
 * Modeled after ref-point-handlers.ts — the factory pattern allows main.ts
 * to inject dependencies that change over the app lifecycle (the active
 * store, current session name, scenario handle).
 *
 * Pure math lives in ray-triangulation-core.ts and robust-triangulation.ts.
 * This module wires the Redux dispatches and OPFS side-effects.
 *
 * FIX 1: Uses createAimedRay for correct off-axis projection, with
 *         buildRayFromPose as fallback when no projection matrix is available.
 * FIX 2: Replay guard — handleShootRay returns immediately during replay.
 * FIX 3: gpsPositionSnapshot is null (not [0,0,0]) when no alignment matrix.
 * FIX 4: Selectors called with full state, not sub-state.
 * FIX 6: Confirm uses request/success/failure actions for async OPFS flow.
 */

import { getCurrentArPose } from 'gps-plus-slam-app-framework/ar/webxr-session';
import {
  extractOdomPosition,
  extractOdomRotation,
} from 'gps-plus-slam-app-framework/state/gps-event-coordinator';
import { getCurrentScenarioHandle } from '../storage/scenario-storage';
import {
  writeMeasurementPoint,
  deleteMeasurementPointFile,
  type MeasurementRayRecord,
  type MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import { sampleDepthPrior } from '../utils/depth-prior-provider';
import { createAimedRay } from '../utils/aiming-ray-capture';
import { arLocalToGpsWorld } from '../utils/measurement-coordinate-conversion';
import {
  addMeasurementRay,
  deleteMeasurementPoint,
  undoMeasurementRay,
  selectProvisionalMeasurement,
  requestConfirmMeasurement,
  confirmMeasurementSuccess,
  confirmMeasurementFailure,
} from '../state/measurement-points-slice';
import type { RobustTriangulationResult } from '../utils/robust-triangulation';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('MeasurementPointHandlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeasurementPointHandlersDeps {
  /** Returns the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** Returns the current session name (set when recording starts). */
  getCurrentSessionName: () => string;
  /** UI: show error toast/banner. */
  showError: (msg: string) => void;
  /** UI: show info toast. */
  showToast: (msg: string) => void;
  /**
   * FIX 2: Returns true when the app is in replay mode.
   * The handler must NOT re-invoke during replay — only action-log
   * replay creates ray records during playback.
   */
  isReplayMode?: () => boolean;
}

export interface MeasurementPointHandlers {
  /**
   * "Shoot" a ray: capture the current AR pose, sample depth, and dispatch
   * addMeasurementRay into the store.
   *
   * @param aimedScreenX - Normalised screen X [0,1] of the aimed pixel
   * @param aimedScreenY - Normalised screen Y [0,1] of the aimed pixel
   */
  handleShootRay(aimedScreenX: number, aimedScreenY: number): void;

  /**
   * Confirm the current pending measurement: solve the final point,
   * persist to OPFS, and dispatch confirmMeasurementSuccess.
   */
  handleConfirmPoint(
    scenarioId: string,
    confirmationMode?: 'quality' | 'override'
  ): Promise<void>;

  /**
   * Delete a confirmed measurement point from the store and OPFS.
   */
  handleDeletePoint(pointId: string): Promise<void>;

  /**
   * Undo the last added ray (before confirmation).
   */
  handleUndoRay(): void;

  /**
   * Get the current provisional measurement result (for UI coaching).
   */
  getProvisionalResult(): RobustTriangulationResult | null;

  /** Lifecycle reset. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let rayIdCounter = 0;

function generateRayId(): string {
  return `ray-${Date.now()}-${rayIdCounter++}`;
}

/**
 * FIX 1 fallback: Build the ray direction from the AR pose.
 * Used ONLY when no projection matrix is available (e.g., AR session just
 * started, no depth dispatched yet). Always shoots the camera forward
 * vector (0, 0, -1), so tap-aim is NOT supported in this mode.
 */
function buildRayFromPose(
  position: Vector3,
  rotation: readonly [number, number, number, number]
): { origin: Vector3; direction: Vector3 } {
  // Quaternion-rotate the forward vector (0, 0, -1) by the device rotation.
  const [qx, qy, qz, qw] = rotation;
  // v' = q * v * q^-1, where v = (0, 0, -1)
  // Simplified for v = (0, 0, -1):
  const dx = -2 * (qx * qz + qy * qw);
  const dy = -2 * (qy * qz - qx * qw);
  const dz = -(1 - 2 * (qx * qx + qy * qy));
  // Normalise
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const direction: Vector3 =
    len > 1e-10 ? [dx / len, dy / len, dz / len] : [0, 0, -1];
  return { origin: position, direction };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** @public */
export function createMeasurementPointHandlers(
  deps: MeasurementPointHandlersDeps
): MeasurementPointHandlers {
  // eslint-disable-next-line complexity
  function handleShootRay(aimedScreenX: number, aimedScreenY: number): void {
    // FIX 2: Replay guard — prevent handler re-invocation during replay.
    // During replay, only the serialized action log is dispatched.
    if (deps.isReplayMode?.()) {
      log.warn('handleShootRay called during replay — ignoring');
      return;
    }

    const arPose = getCurrentArPose();
    if (!arPose) {
      deps.showError('Cannot shoot ray — AR tracking not available');
      return;
    }

    const position = extractOdomPosition(arPose);
    const rotation = extractOdomRotation(arPose);
    const timestamp = Date.now();

    // Read depth sample for both ray construction and depth prior
    const state = deps.getStore().getState();
    const depthSample = state.recording.latestDepthSample ?? null;

    // FIX 1: Use createAimedRay when projection matrix is available.
    // This handles off-axis projection matrices correctly, ensuring the
    // ray direction matches the aimed pixel (not just camera forward).
    let origin: Vector3;
    let direction: Vector3;

    const projectionMatrix = depthSample?.projectionMatrix;
    if (projectionMatrix) {
      // Keep the projection, pose, and depth point in the same capture frame.
      // Using the independently sampled current pose here can shift the ray
      // when the latest depth frame is slightly older than the tap.
      const rayPosition = depthSample.cameraPos ?? position;
      const rayRotation = depthSample.cameraRot ?? rotation;
      // Full ray construction via unprojection — handles tap-aim correctly
      const aimedResult = createAimedRay(
        rayPosition,
        rayRotation,
        projectionMatrix,
        aimedScreenX,
        aimedScreenY,
        { outOfBoundsPolicy: 'clamp' }
      );
      if (aimedResult) {
        origin = aimedResult.ray.origin;
        direction = aimedResult.ray.direction;
      } else {
        // createAimedRay failed (degenerate matrix) — fall back
        log.warn('createAimedRay failed, falling back to buildRayFromPose');
        const fallback = buildRayFromPose(position, rotation);
        origin = fallback.origin;
        direction = fallback.direction;
      }
    } else {
      // No projection matrix yet — crosshair-only fallback
      if (aimedScreenX !== 0.5 || aimedScreenY !== 0.5) {
        log.warn(
          'No projection matrix available — tap-aim blocked, using crosshair [0.5, 0.5]'
        );
      }
      const fallback = buildRayFromPose(position, rotation);
      origin = fallback.origin;
      direction = fallback.direction;
    }

    // Sample depth prior at the aimed pixel
    const depthObs = sampleDepthPrior(depthSample, aimedScreenX, aimedScreenY);

    const rayRecord: MeasurementRayRecord = {
      id: generateRayId(),
      timestamp,
      arPose: { position, rotation },
      rayOrigin: origin,
      rayDirection: direction,
      rayWeight: 1.0,
      ...(depthObs
        ? {
            depthPoint: depthObs.point,
            depthWeight: depthObs.weight,
            depthTimestamp: depthSample?.timestamp,
          }
        : {}),
    };

    deps.getStore().dispatch(addMeasurementRay(rayRecord));
    log.info(
      `Shot ray ${rayRecord.id} (depth: ${depthObs ? `${depthObs.depthM.toFixed(1)}m w=${depthObs.weight.toFixed(2)}` : 'none'})`
    );
  }

  async function handleConfirmPoint(
    scenarioId: string,
    confirmationMode: 'quality' | 'override' = 'quality'
  ): Promise<void> {
    const state = deps.getStore().getState();
    // FIX 4: pass full state, not sub-state
    const provisional = selectProvisionalMeasurement(state);

    if (!provisional) {
      deps.showError('Cannot confirm — no valid solution');
      return;
    }

    if (
      confirmationMode === 'quality' &&
      !state.measurementPoints.draft.canConfirm
    ) {
      deps.showError(
        'Cannot confirm — measurement quality is below the required threshold'
      );
      return;
    }

    // FIX 6: dispatch requestConfirmMeasurement to transition draft → confirm_pending
    deps.getStore().dispatch(requestConfirmMeasurement({ confirmationMode }));

    const pendingRays = state.measurementPoints.pendingRays;
    // FIX 3: gpsSnapshot is null (not [0,0,0]) when no alignment matrix
    const gpsSnapshot = arLocalToGpsWorld(
      provisional.point,
      state.gpsData?.gpsEvents?.alignmentMatrix
    );

    const entity: MeasurementPointEntity = {
      schemaVersion: 1,
      id: `mp-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scenarioId,
      observations: [...pendingRays],
      arPosition: provisional.point,
      gpsPositionSnapshot: gpsSnapshot ?? null,
      uncertainty: provisional.uncertainty,
      rmsError: provisional.rmsError,
      inlierIds: provisional.inlierIds,
      outlierIds: provisional.outlierIds,
      confirmationMode,
    };

    // Persist to OPFS
    const scenarioHandle = getCurrentScenarioHandle();
    if (scenarioHandle) {
      try {
        await writeMeasurementPoint(scenarioHandle, entity);
        // FIX 6: dispatch success — moves pending to confirmed, clears pending
        deps.getStore().dispatch(confirmMeasurementSuccess(entity));
        deps.showToast(`Confirmed measurement point`);
      } catch (err) {
        log.error('Failed to persist measurement point:', err);
        // FIX 6: dispatch failure — draft → confirm_failed, user can retry
        deps.getStore().dispatch(confirmMeasurementFailure());
        deps.showError('Failed to save measurement point to disk');
      }
    } else {
      // No scenario handle — still dispatch success for in-memory state
      deps.getStore().dispatch(confirmMeasurementSuccess(entity));
      deps.showToast(`Confirmed measurement point (no disk persistence)`);
    }
  }

  async function handleDeletePoint(pointId: string): Promise<void> {
    deps.getStore().dispatch(deleteMeasurementPoint({ id: pointId }));

    const scenarioHandle = getCurrentScenarioHandle();
    if (scenarioHandle) {
      try {
        await deleteMeasurementPointFile(scenarioHandle, pointId);
      } catch (err) {
        log.error('Failed to delete measurement point from disk:', err);
        deps.showError('Failed to delete measurement point from disk');
      }
    }
  }

  function handleUndoRay(): void {
    deps.getStore().dispatch(undoMeasurementRay());
    log.info('Undid last measurement ray');
  }

  function getProvisionalResult(): RobustTriangulationResult | null {
    const state = deps.getStore().getState();
    // FIX 4: pass full state, not sub-state
    return selectProvisionalMeasurement(state);
  }

  function reset(): void {
    // resetMeasurementPoints is imported from the slice but dispatched
    // through the recorder's lifecycle reset — see main.ts.
    // The handler reset is a no-op for local state; the slice reset
    // is dispatched by whoever owns the lifecycle.
    rayIdCounter = 0;
  }

  return {
    handleShootRay,
    handleConfirmPoint,
    handleDeletePoint,
    handleUndoRay,
    getProvisionalResult,
    reset,
  };
}
