/**
 * Redux slice for AR tracking state.
 *
 * Replaces the original `TrackingStateManager` class (formerly
 * `ar/tracking-state.ts`) — see
 * docs/2026-05-13-tracking-state-slice-port-plan.md and the
 * P2 step 2 entry of docs/2026-05-07-csharp-features-not-yet-ported.md.
 *
 * Every field of the manager class was pure logical state (Bucket A in the
 * survey), so it is modelled as a reducer + selectors. The transient
 * `lastRestartedPayload` field captures the LOST → TRACKING-with-reset
 * payload that the host fires as `onTrackingRestarted`; the host clears it
 * via `clearLastRestartedPayload` after consuming the value (so consecutive
 * transitions never silently overwrite an unread payload).
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type {
  OdometryTrackingRestartedPayload,
  Vector3,
  Quaternion,
} from 'gps-plus-slam-js';
import type { ARPose } from '../types/ar-types';

/**
 * AR tracking phase. String-literal union (not a TS enum) so action payloads
 * and replay JSON stay structurally compatible with non-TS consumers.
 */
export type TrackingPhase = 'initializing' | 'tracking' | 'lost';

/**
 * Raw `DeviceOrientationEvent` snapshot captured alongside an AR pose.
 *
 * Identical shape to `RawDeviceOrientation` from `gps-plus-slam-js`, but
 * with non-nullable fields — sensors are required to have resolved for the
 * AR math that consumes this snapshot.
 */
export interface DeviceOrientation {
  /**
   * Compass heading (0–360), or `null` when the device gave none.
   *
   * NULLABLE SINCE 2026-08-31, and the null is load-bearing. Substituting `0`
   * here was a silent bug: `0` is a legal reading meaning "facing north", and
   * the value reaches the core library's tracking-restart rotation
   * correction. A phone with no magnetometer reports a null `alpha` beside
   * real `beta`/`gamma`, so the axes are nullable individually.
   */
  alpha: number | null;
  /** Pitch (-180 to 180), or `null` when the device gave none. */
  beta: number | null;
  /** Roll (-90 to 90), or `null` when the device gave none. */
  gamma: number | null;
  /** Whether alpha is relative to magnetic north. */
  absolute: boolean;
}

/**
 * Serialized `XRReferenceSpaceEvent.transform`.
 *
 * `null` when the XR runtime cannot determine the delta between old and new
 * coordinate systems; `undefined` when no transform was captured (older
 * browsers / no event).
 */
export interface ResetTransformData {
  position: Vector3;
  orientation: Quaternion;
}

export interface TrackingSliceState {
  phase: TrackingPhase;
  lastValidPose: ARPose | null;
  lastSensorOrientation: DeviceOrientation | null;
  lostFrameCount: number;
  originResetDuringLoss: boolean;
  /**
   * Distinguishes "reset flagged with no transform yet" from "no reset flagged".
   * `undefined` is the default; once `originReset(...)` is dispatched the value
   * is the supplied transform (which may itself be `null`).
   */
  resetTransform: ResetTransformData | null | undefined;
  /**
   * Transient payload set by the LOST → TRACKING transition when an origin
   * reset was flagged during the loss. Host consumes it via the matching
   * selector and then dispatches `clearLastRestartedPayload`.
   */
  lastRestartedPayload: OdometryTrackingRestartedPayload | null;
}

const initialState: TrackingSliceState = {
  phase: 'initializing',
  lastValidPose: null,
  lastSensorOrientation: null,
  lostFrameCount: 0,
  originResetDuringLoss: false,
  resetTransform: undefined,
  lastRestartedPayload: null,
};

export interface PoseReceivedPayload {
  pose: ARPose;
  /** `null` when the browser has given no reading - see DeviceOrientation. */
  sensorOrientation: DeviceOrientation | null;
}

const trackingSlice = createSlice({
  name: 'tracking',
  initialState,
  reducers: {
    /**
     * A valid AR pose was received this frame. Drives INITIALIZING|LOST →
     * TRACKING transitions; on LOST → TRACKING with `originResetDuringLoss`
     * also populates `lastRestartedPayload` (Case 2 of the manager doc).
     */
    poseReceived(state, action: PayloadAction<PoseReceivedPayload>) {
      const { pose, sensorOrientation } = action.payload;

      if (state.phase === 'lost') {
        const hadReset = state.originResetDuringLoss;
        const savedResetTransform = state.resetTransform;
        state.originResetDuringLoss = false;
        state.resetTransform = undefined;

        if (hadReset && state.lastValidPose !== null) {
          // NO `?? sensorOrientation` FALLBACK. It used to substitute the NEW
          // reading for a missing old one, which wrote into the recording a
          // claim that the earlier snapshot held a value it never had.
          //
          // Its effect was accidentally benign — the substitution made both
          // sides equal, and equal sides cancel in
          // `newSensor · inv(lastSensor)` — but it recorded a fiction to get
          // there, and a recording that misreports what a sensor said is worse
          // than one that admits it said nothing.
          const lastOrientation = state.lastSensorOrientation;
          state.lastRestartedPayload = {
            lastValidOdomPos: [
              state.lastValidPose.position.x,
              state.lastValidPose.position.y,
              state.lastValidPose.position.z,
            ],
            lastValidOdomRot: [
              state.lastValidPose.orientation.x,
              state.lastValidPose.orientation.y,
              state.lastValidPose.orientation.z,
              state.lastValidPose.orientation.w,
            ],
            // OMITTED, not zeroed, when there was no reading. The core
            // library's `resolveSensorPair` refuses a pair where one side is
            // absent and the other real; substituting zeros here would make
            // that pair look complete and reinstate the bug one layer down.
            ...(lastOrientation === null
              ? {}
              : {
                  lastSensorOrientation: {
                    alpha: lastOrientation.alpha,
                    beta: lastOrientation.beta,
                    gamma: lastOrientation.gamma,
                    absolute: lastOrientation.absolute,
                  },
                }),
            newOdomRot: [
              pose.orientation.x,
              pose.orientation.y,
              pose.orientation.z,
              pose.orientation.w,
            ],
            ...(sensorOrientation === null
              ? {}
              : {
                  newSensorOrientation: {
                    alpha: sensorOrientation.alpha,
                    beta: sensorOrientation.beta,
                    gamma: sensorOrientation.gamma,
                    absolute: sensorOrientation.absolute,
                  },
                }),
            newOdomPos: [pose.position.x, pose.position.y, pose.position.z],
            resetTransform: savedResetTransform,
          };
        }
        // Else: Case 1 (seamless recovery) — host distinguishes via the
        // `lost → tracking` phase transition with `lastRestartedPayload`
        // still null. We deliberately do NOT clear an existing payload here;
        // host must call `clearLastRestartedPayload` between cycles. Tests
        // pin this in: a Case 1 recovery following an unread Case 2 payload
        // keeps the Case 2 payload visible.
      }

      state.phase = 'tracking';
      state.lastValidPose = pose;
      state.lastSensorOrientation = sensorOrientation;
      state.lostFrameCount = 0;
    },

    /**
     * Pose was unavailable this frame. TRACKING → LOST on the first call;
     * subsequent calls only bump `lostFrameCount`.
     */
    poseLost(state) {
      state.lostFrameCount += 1;
      if (state.phase === 'tracking') {
        state.phase = 'lost';
      }
    },

    /**
     * `XRReferenceSpace` reset event fired. Only meaningful while LOST.
     * The payload distinguishes three cases:
     *   - `ResetTransformData` — runtime supplied the transform.
     *   - `null` — runtime could not determine the delta.
     *   - `undefined` (action with no payload) — backwards compat for
     *     callers without an event reference.
     */
    originReset: {
      reducer(
        state,
        action: PayloadAction<ResetTransformData | null | undefined>
      ) {
        if (state.phase !== 'lost') return state;
        // Return a new state instead of mutating the draft: immer's
        // `WritableDraft` rejects the `readonly` tuples inside
        // `ResetTransformData` (`Vector3`/`Quaternion`). Returning a new
        // object skips draft assignment entirely.
        return {
          ...state,
          originResetDuringLoss: true,
          resetTransform: action.payload,
        };
      },
      prepare(transform?: ResetTransformData | null) {
        return { payload: transform };
      },
    },

    /**
     * Drops the manager back to its initial state. Host calls on new XR
     * session start.
     */
    resetTracking() {
      return initialState;
    },

    /**
     * Host calls this after firing its `onTrackingRestarted` callback with
     * the contents of `selectLastRestartedPayload`. Failure to call it would
     * leave a stale payload; the test matrix locks this in.
     */
    clearLastRestartedPayload(state) {
      state.lastRestartedPayload = null;
    },
  },
});

export const {
  poseReceived,
  poseLost,
  originReset,
  resetTracking,
  clearLastRestartedPayload,
} = trackingSlice.actions;

export const trackingReducer = trackingSlice.reducer;

// --- Selectors ---------------------------------------------------------

/**
 * Minimal root-state shape needed by the selectors. Avoids a hard import
 * cycle through `SlamAppRootState`.
 */
interface RootWithTracking {
  tracking: TrackingSliceState;
}

export function selectTrackingPhase(state: RootWithTracking): TrackingPhase {
  return state.tracking.phase;
}

export function selectLastValidPose(state: RootWithTracking): ARPose | null {
  return state.tracking.lastValidPose;
}

export function selectLostFrameCount(state: RootWithTracking): number {
  return state.tracking.lostFrameCount;
}

export function selectLastRestartedPayload(
  state: RootWithTracking
): OdometryTrackingRestartedPayload | null {
  return state.tracking.lastRestartedPayload;
}

/**
 * Selector for the last `DeviceOrientation` captured alongside a valid
 * AR pose. Used by the §4.3 compass / alignment heading cross-check in
 * the tracking-quality reporter (see
 * docs/2026-05-16-tracking-quality-metrics-plan.md).
 *
 * Returns `null` before any pose has been received and after
 * `resetTracking` clears the slice.
 */
export function selectLastSensorOrientation(
  state: RootWithTracking
): DeviceOrientation | null {
  return state.tracking.lastSensorOrientation;
}
