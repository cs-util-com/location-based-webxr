/**
 * Ref-Point Handlers
 *
 * Encapsulates all reference-point state and event handlers, extracted from
 * main.ts (Finding #7 — main.ts decomposition, ref-point extraction).
 *
 * The factory pattern allows main.ts to inject dependencies that change over
 * the app lifecycle (e.g., the active store and current session name).
 *
 * All other dependencies (file system, UI, visualization) are imported
 * directly — the same modules they were imported from in main.ts.
 */

import { getCurrentArPose } from 'gps-plus-slam-app-framework/ar/webxr-session';
import { getCurrentScenarioHandle } from '../storage/scenario-storage';
import {
  saveRefPointObservation,
  type RefPointObservation,
} from '../storage/ref-point-loader';
import {
  showRefPointPicker,
  isRefPointPickerVisible,
} from '../ui/ref-point-picker';
import {
  extractOdomPosition,
  extractOdomRotation,
} from 'gps-plus-slam-app-framework/state/gps-event-coordinator';
import { showError, updateStatus } from '../ui/hud';
import { showToast, TOAST_DURATION_ERROR } from '../ui/toast';
import type { GpsPoint } from 'gps-plus-slam-app-framework/core';
import type { RawGpsPoint } from 'gps-plus-slam-app-framework/state';
import {
  addRefPointEntry,
  resetRefPoints,
  selectKnownAnchorsByCell,
} from '../state/ref-points-slice';
import { fusedGpsFromOdom } from 'gps-plus-slam-app-framework/utils/fused-path';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  gpsToH3,
  findNearbyGeoAnchor,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import { webxrToNUE } from 'gps-plus-slam-app-framework/core';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('RefPointHandlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefPointHandlersDeps {
  /** Returns the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** Returns the current session name (set when recording starts). */
  getCurrentSessionName: () => string;
}

interface NearbyRefPointInfo {
  /** Display name of the nearby ref point. */
  readonly displayName: string;
  /** True when the user's H3 cell differs from the matched ref point's cell
   *  (i.e., in a gridDisk neighbor cell — a new ref point could be added). */
  readonly isNeighborCell: boolean;
}

export interface RefPointHandlers {
  // Primary handler. When forceNew is true, bypass re-observation and
  // show the picker for creating a new ref point even when near a known one.
  handleMarkRefPoint(options?: { forceNew?: boolean }): Promise<void>;

  // Proximity check for live button label + neighbor-cell detection
  checkNearbyRefPoint(lat: number, lng: number): NearbyRefPointInfo | undefined;

  // Lifecycle
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRefPointHandlers(
  deps: RefPointHandlersDeps
): RefPointHandlers {
  // --- State ---
  // Only markRefPointInProgress remains as closure state (transient concurrency guard).
  // Ref-point entries live in the `refPoints` slice (the single source of
  // truth after 5.7a-3 Option C of the 2026-05-27 slice-collapse plan).
  let markRefPointInProgress = false;

  /** Per-H3-cell cooldown to prevent accidental duplicate re-observations (Aachen audit Issue 3). */
  const RE_OBSERVATION_COOLDOWN_MS = 10_000;
  const lastReObservationTimestamp = new Map<string, number>();

  // --- Internal helpers ---

  /**
   * Mirror of the framework persistence middleware's `readIsRecording`
   * (persistence-middleware.ts): the gate the `addRefPointEntry` dispatch
   * below is subject to. Missing slice ⇒ false, exactly like the gate, so
   * this predicts precisely whether a dispatched action would reach the
   * recording's `actions/`.
   */
  function isRecordingActive(): boolean {
    const state = deps.getStore().getState() as unknown as {
      recording?: { isRecording?: boolean };
    };
    return state.recording?.isRecording ?? false;
  }

  function validateRefPointPrerequisites(): {
    arPose: NonNullable<ReturnType<typeof getCurrentArPose>>;
    lastGpsPoint: GpsPoint;
  } | null {
    const arPose = getCurrentArPose();
    if (!arPose) {
      showError('Cannot mark reference point - AR tracking not available');
      return null;
    }

    const state = deps.getStore().getState();
    const lastGpsPoint = state.gpsData?.gpsEvents?.gpsPositions?.at(-1) ?? null;

    if (!lastGpsPoint) {
      showError('Cannot mark reference point - no GPS data available');
      return null;
    }

    return { arPose, lastGpsPoint };
  }

  function buildRefPointObservation(
    odomPosition: Vector3,
    odomRotation: Quaternion,
    lastGpsPoint: GpsPoint,
    timestamp: number,
    fusedGpsPoint?: { latitude: number; longitude: number; altitude?: number }
  ): RefPointObservation {
    const obs: RefPointObservation = {
      sessionId: deps.getCurrentSessionName(),
      timestamp,
      arPose: {
        position: odomPosition,
        rotation: odomRotation,
      },
      gpsPoint: lastGpsPoint,
    };
    if (fusedGpsPoint) {
      return { ...obs, fusedGpsPoint };
    }
    return obs;
  }

  function dispatchRefPointAction(
    refPointId: string,
    refPointName: string,
    odomPosition: Vector3,
    odomRotation: Quaternion,
    gpsPoint: GpsPoint,
    timestamp: number,
    fusedGpsPoint:
      | { latitude: number; longitude: number; altitude?: number }
      | undefined
  ): void {
    // Extract raw sensor fields from state-side GpsPoint for the action payload.
    // Derived fields (coordinates, weight, zeroRef) are recomputed by the
    // reducer (raw-storage pattern).
    const {
      zeroRef: _z,
      coordinates: _c,
      weight: _w,
      ...rawGpsPoint
    } = gpsPoint;

    // Single source of truth: the flat `refPoints` slice. Step 5.7 of
    // the 2026-05-27 slice-collapse plan dropped the parallel
    // `gpsData/markReferencePoint` dispatch; the library no longer
    // tracks ref points. Carries the fused lat/lon (+altitude) snapshot
    // in `RawGpsPoint` shape when an alignment matrix was in effect at
    // mark-time, and the user/imported display name when known.
    const fusedRaw: RawGpsPoint | undefined = fusedGpsPoint
      ? {
          ...rawGpsPoint,
          latitude: fusedGpsPoint.latitude,
          longitude: fusedGpsPoint.longitude,
          altitude: fusedGpsPoint.altitude ?? rawGpsPoint.altitude,
        }
      : undefined;
    // The raw WebXR AR pose (`odomPosition`/`odomRotation`) is the
    // load-bearing input the investigation harness needs to recompute
    // alignment from scratch for parameter sweeps. Without it, every new
    // recording is silently useless for sweeps. See
    // 2026-05-29-investigation-harness-refpoint-source-migration-plan.md §E.
    deps.getStore().dispatch(
      addRefPointEntry({
        id: refPointId,
        timestamp,
        name: refPointName,
        rawGpsPoint,
        position: odomPosition,
        rotation: odomRotation,
        ...(fusedRaw ? { gpsPoint: fusedRaw } : {}),
      })
    );
  }

  async function persistRefPointObservation(
    scenarioHandle: FileSystemDirectoryHandle,
    refPointId: string,
    refPointName: string,
    observation: RefPointObservation
  ): Promise<boolean> {
    try {
      await saveRefPointObservation(
        scenarioHandle,
        refPointId,
        refPointName,
        observation
      );
      log.info(`Saved reference point ${refPointId} to scenario refPoints/`);
      return true;
    } catch (err) {
      log.error('Failed to save reference point:', err);
      showError('Failed to save reference point to disk');
      return false;
    }
  }

  // NOTE: the former `visualizeRefPoint` no-op seam was removed 2026-07-10
  // (quality-review D-2). The red current-session sphere is driven
  // exclusively by `wireRefPointSubscribers` subscribing to
  // `selectRefPointEntries` over the V2 slice (since Step 5.7a-2); a future
  // live-mark-only side effect (animation, audio cue) should hook into the
  // mark flow directly rather than reviving a 6-argument no-op.

  // --- Main handler ---

  async function handleMarkRefPoint(options?: {
    forceNew?: boolean;
  }): Promise<void> {
    // Guard: ignore if picker is already open (prevents overwriting currentResolver)
    if (isRefPointPickerVisible()) {
      log.warn('Reference point picker already open, ignoring duplicate call');
      return;
    }

    // Synchronous lock: prevents concurrent calls that pass the visibility check
    // before the picker is actually shown (async gap between check and show)
    if (markRefPointInProgress) {
      log.warn('Mark ref point already in progress, ignoring duplicate call');
      return;
    }
    markRefPointInProgress = true;

    try {
      log.info('Mark reference point');

      // Validate prerequisites
      const validated = validateRefPointPrerequisites();
      if (!validated) {
        return;
      }

      const { arPose, lastGpsPoint } = validated;

      // Compute H3 index for the current GPS position
      const currentH3 = gpsToH3(lastGpsPoint.latitude, lastGpsPoint.longitude);
      const scenarioHandle = getCurrentScenarioHandle();

      // Read cached known ref points from Redux (memoized selector).
      // Step 5.4: source is the flat `refPoints` slice; grouping by H3
      // cell happens in `selectKnownAnchorsByCell`.
      const cachedKnownRefPoints = selectKnownAnchorsByCell(
        deps.getStore().getState().refPoints
      );

      // Check if we're near a known ref point (re-observation).
      // When forceNew is set, skip the proximity check to force the picker.
      const nearbyMatch = options?.forceNew
        ? undefined
        : findNearbyGeoAnchor(
            lastGpsPoint.latitude,
            lastGpsPoint.longitude,
            cachedKnownRefPoints
          );

      let refPointId: string;
      let refPointName: string;

      if (nearbyMatch) {
        // Re-observation: append to the MATCHED definition's id, skip picker.
        // The matcher tolerates gridDisk neighbor cells, so `currentH3` may
        // differ from the matched anchor's cell — persisting under the
        // current cell would create a sibling refPoints/{id}.json and split
        // the point's observation history (D5, 2026-07-05 folder-import
        // feedback, Finding 5). The re-observation cooldown below already
        // keys on the matched id.
        refPointId = nearbyMatch.h3Index;
        refPointName = nearbyMatch.displayName ?? nearbyMatch.h3Index;

        // Per-cell cooldown: reject rapid duplicate taps (Aachen audit Issue 3)
        const lastMark = lastReObservationTimestamp.get(nearbyMatch.h3Index);
        if (
          lastMark !== undefined &&
          Date.now() - lastMark < RE_OBSERVATION_COOLDOWN_MS
        ) {
          log.warn(
            `Re-observation of ${refPointId} ignored — cooldown active (${RE_OBSERVATION_COOLDOWN_MS}ms)`
          );
          return;
        }

        log.info(
          `Re-observation of ref point: ${refPointId} (${refPointName})`
        );
      } else {
        // New ref point: prompt for a display name only. (The prompt's
        // former suggestion list was removed 2026-09-04 — scenario IDs are H3
        // hex strings, meaningless to users, and imported names refer to
        // distant locations, so it had nothing to show.)
        const pickerResult = await showRefPointPicker();
        if (!pickerResult) {
          log.info('Reference point marking cancelled');
          return;
        }

        refPointId = currentH3;
        refPointName = pickerResult.id; // user-entered name is display metadata only
        log.info(`New ref point: ${refPointId} (${refPointName})`);
      }

      const timestamp = Date.now();

      // Extract odometry data once from AR pose (used by dispatch, persist, visualize)
      const odomPosition = extractOdomPosition(arPose);
      const odomRotation = extractOdomRotation(arPose);

      // Compute fused GPS if alignment matrix is available
      let fusedGpsPoint:
        | { latitude: number; longitude: number; altitude?: number }
        | undefined;
      const state = deps.getStore().getState();
      const alignmentMatrix = state.gpsData?.gpsEvents?.alignmentMatrix;
      const zeroRef = state.gpsData?.zero;
      if (alignmentMatrix && zeroRef) {
        const gps = fusedGpsFromOdom(
          alignmentMatrix,
          webxrToNUE(odomPosition),
          zeroRef
        );
        fusedGpsPoint = {
          latitude: gps.lat,
          longitude: gps.lon,
          altitude: gps.altitude,
        };
      }

      // The recording can end while this flow awaits (the new-point picker
      // can stay open across Stop or a system session end) — root cause of
      // the 2026-07-11 zip-1 lost "A3" action (indoor-loop enablement,
      // implementation summary §3.5): the persistence middleware drops
      // post-stop dispatches, so the action can never reach the recording,
      // while the OPFS write below still succeeds and the toast claimed
      // plain success. Skip the dead dispatch, keep the durable
      // scenario-level observation, and tell the truth in the toast.
      const recordingActive = isRecordingActive();
      if (recordingActive) {
        dispatchRefPointAction(
          refPointId,
          refPointName,
          odomPosition,
          odomRotation,
          lastGpsPoint,
          timestamp,
          fusedGpsPoint
        );
      } else {
        log.warn(
          `Ref point "${refPointName}" (${refPointId}) marked after the recording ended — action not persisted, scenario observation only`
        );
      }

      const isNewPoint = !nearbyMatch;

      // Persist to disk
      let persistOk = true;
      if (scenarioHandle) {
        // In-progress feedback for the new-ref-point path (D4/F4-B, 2026-06-16
        // user feedback): the picker has closed and the durable OPFS write is
        // now awaited, so surface a transient "Saving…" toast that the final
        // confirmation / error toast then replaces. The re-observe path stays a
        // quiet single tap (its result toast fires below).
        if (isNewPoint) {
          showToast(`Saving "${refPointName}"…`, { severity: 'info' });
        }
        const observation = buildRefPointObservation(
          odomPosition,
          odomRotation,
          lastGpsPoint,
          timestamp,
          fusedGpsPoint
        );
        persistOk = await persistRefPointObservation(
          scenarioHandle,
          refPointId,
          refPointName,
          observation
        );
      }

      updateStatus(`Marked reference point: ${refPointId}`);

      // Confirmation toast — reflects the durable end state, fired only after the
      // OPFS write resolves. BOTH paths now confirm (D4/F4-B, 2026-06-16 user
      // feedback): the field tester reported "no indicator that a marker was
      // set" on the picker-driven new-point path, which previously relied solely
      // on the picker closing. Re-observe keeps its original "Re-observed" copy
      // (Finding 3, 2026-04-29).
      if (isNewPoint) {
        if (persistOk) {
          // The stop-window variant must not claim plain success: the mark
          // is durable in the scenario but absent from the (ended) recording.
          showToast(
            recordingActive
              ? `Marked "${refPointName}"`
              : `Marked "${refPointName}" — recording already ended, saved to scenario only`,
            { severity: recordingActive ? 'info' : 'warning' }
          );
        } else {
          // Revert the in-progress "Saving…" state with an explicit failure
          // toast (persistRefPointObservation also drives the HUD error
          // channel via showError, but that is not composited over the AR
          // camera, so the toast is what the user actually sees in AR).
          showToast(`Could not save "${refPointName}"`, {
            severity: 'error',
            duration: TOAST_DURATION_ERROR,
          });
        }
      } else if (persistOk) {
        showToast(
          recordingActive
            ? `Re-observed "${refPointName}"`
            : `Re-observed "${refPointName}" — recording already ended, saved to scenario only`,
          { severity: recordingActive ? 'info' : 'warning' }
        );
      }

      // Record re-observation timestamp for cooldown (Aachen audit Issue 3)
      if (nearbyMatch) {
        lastReObservationTimestamp.set(nearbyMatch.h3Index, Date.now());
      }
    } finally {
      markRefPointInProgress = false;
    }
  }

  // --- Public API ---

  return {
    handleMarkRefPoint,

    checkNearbyRefPoint(
      lat: number,
      lng: number
    ): NearbyRefPointInfo | undefined {
      // Step 5.4: matcher reads from the flat `refPoints` slice.
      const cachedKnown = selectKnownAnchorsByCell(
        deps.getStore().getState().refPoints
      );
      const match = findNearbyGeoAnchor(lat, lng, cachedKnown);
      if (!match) return undefined;
      const currentCell = gpsToH3(lat, lng);
      return {
        displayName: match.displayName ?? currentCell,
        isNeighborCell: match.h3Index !== currentCell,
      };
    },

    reset: () => {
      deps.getStore().dispatch(resetRefPoints());
      markRefPointInProgress = false;
      lastReObservationTimestamp.clear();
    },
  };
}
