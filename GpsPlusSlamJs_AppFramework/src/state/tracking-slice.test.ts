/**
 * Tracking slice unit tests.
 *
 * Translated from the `TrackingStateManager` example-based tests
 * (`ar/tracking-state.test.ts`) per the test matrix in
 * docs/2026-05-13-tracking-state-slice-port-plan.md. The slice's reducer
 * MUST preserve every behaviour the old class locked in (same Case 1 /
 * Case 2 split, same payload fields, same edge cases) so the host
 * migration in sub-step 3 is a mechanical refactor.
 *
 * Why this test file matters:
 * - The slice has no production consumer yet (sub-step 2 lands the slice
 *   only); these tests are the entire correctness signal until sub-step 3.
 * - They double as executable spec for the reducer transitions while the
 *   manager class is still in place.
 */

import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import {
  trackingReducer,
  poseReceived,
  poseLost,
  originReset,
  resetTracking,
  clearLastRestartedPayload,
  selectTrackingPhase,
  selectLastValidPose,
  selectLostFrameCount,
  selectLastRestartedPayload,
  selectLastSensorOrientation,
  type DeviceOrientation,
  type TrackingSliceState,
} from './tracking-slice';
import type { ARPose } from '../types/ar-types';

const defaultOrientation: DeviceOrientation = {
  alpha: 0,
  beta: 0,
  gamma: 0,
  absolute: false,
};

const initialPose: ARPose = {
  position: { x: 1, y: 2, z: 3 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

const newPose: ARPose = {
  position: { x: 0.1, y: 0.1, z: 0.1 },
  orientation: { x: 0, y: 0.1, z: 0, w: 0.995 },
};

function createStore() {
  return configureStore({ reducer: { tracking: trackingReducer } });
}

describe('trackingSlice — initial state', () => {
  it('starts in INITIALIZING with null fields', () => {
    const store = createStore();
    const state = store.getState();
    expect(selectTrackingPhase(state)).toBe('initializing');
    expect(selectLastValidPose(state)).toBeNull();
    expect(selectLostFrameCount(state)).toBe(0);
    expect(selectLastRestartedPayload(state)).toBeNull();
    expect(state.tracking.originResetDuringLoss).toBe(false);
    expect(state.tracking.resetTransform).toBeUndefined();
    expect(state.tracking.lastSensorOrientation).toBeNull();
    expect(selectLastSensorOrientation(state)).toBeNull();
  });
});

describe('trackingSlice — selectLastSensorOrientation', () => {
  // Why: §4.3 of docs/2026-05-16-tracking-quality-metrics-plan.md depends
  // on a trivial public accessor for the slice's `lastSensorOrientation`
  // field, alongside the existing selectors.
  it('returns null before any pose has been received', () => {
    const store = createStore();
    expect(selectLastSensorOrientation(store.getState())).toBeNull();
  });

  it('returns the most recent sensor orientation after poseReceived', () => {
    const store = createStore();
    const orientation: DeviceOrientation = {
      alpha: 42,
      beta: 5,
      gamma: -3,
      absolute: true,
    };
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: orientation })
    );
    expect(selectLastSensorOrientation(store.getState())).toEqual(orientation);
  });

  it('returns null again after resetTracking', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(resetTracking());
    expect(selectLastSensorOrientation(store.getState())).toBeNull();
  });
});

describe('trackingSlice — poseReceived', () => {
  it('INITIALIZING → TRACKING and stores pose + orientation', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    const state = store.getState();
    expect(selectTrackingPhase(state)).toBe('tracking');
    expect(selectLastValidPose(state)).toEqual(initialPose);
    expect(state.tracking.lastSensorOrientation).toEqual(defaultOrientation);
  });

  it('overwrites last valid pose on subsequent valid poses', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(
      poseReceived({
        pose: newPose,
        sensorOrientation: { alpha: 1, beta: 2, gamma: 3, absolute: true },
      })
    );
    expect(selectLastValidPose(store.getState())).toEqual(newPose);
  });

  it('does not produce a restart payload while TRACKING', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).toBeNull();
  });
});

describe('trackingSlice — poseLost', () => {
  it('TRACKING → LOST on first call and increments lostFrameCount', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    const state = store.getState();
    expect(selectTrackingPhase(state)).toBe('lost');
    expect(selectLostFrameCount(state)).toBe(1);
  });

  it('preserves last valid pose during loss', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    expect(selectLastValidPose(store.getState())).toEqual(initialPose);
  });

  it('further poseLost while LOST keeps state LOST and bumps counter', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(poseLost());
    store.dispatch(poseLost());
    expect(selectTrackingPhase(store.getState())).toBe('lost');
    expect(selectLostFrameCount(store.getState())).toBe(3);
  });

  it('poseLost from INITIALIZING bumps counter but stays INITIALIZING', () => {
    const store = createStore();
    store.dispatch(poseLost());
    expect(selectTrackingPhase(store.getState())).toBe('initializing');
    expect(selectLostFrameCount(store.getState())).toBe(1);
  });

  it('resets lostFrameCount when tracking resumes', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(poseLost());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLostFrameCount(store.getState())).toBe(0);
  });
});

describe('trackingSlice — originReset', () => {
  it('flips the flag and stores the supplied transform while LOST', () => {
    const transform = {
      position: [0.5, 0, -0.3] as [number, number, number],
      orientation: [0, 0.1, 0, 0.995] as [number, number, number, number],
    };
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(transform));
    const state = store.getState();
    expect(state.tracking.originResetDuringLoss).toBe(true);
    expect(state.tracking.resetTransform).toEqual(transform);
  });

  it('records null transform when runtime supplies null', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(null));
    expect(store.getState().tracking.resetTransform).toBeNull();
  });

  it('records undefined transform when called with no argument', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    expect(store.getState().tracking.resetTransform).toBeUndefined();
    expect(store.getState().tracking.originResetDuringLoss).toBe(true);
  });

  it('is a no-op while TRACKING', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(originReset());
    expect(store.getState().tracking.originResetDuringLoss).toBe(false);
  });

  it('is a no-op while INITIALIZING', () => {
    const store = createStore();
    store.dispatch(originReset());
    expect(store.getState().tracking.originResetDuringLoss).toBe(false);
  });

  it('last call wins when called multiple times during a single LOST window', () => {
    const first = {
      position: [1, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const second = {
      position: [2, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(first));
    store.dispatch(originReset(second));
    expect(store.getState().tracking.resetTransform).toEqual(second);
  });
});

describe('trackingSlice — Case 1: seamless recovery', () => {
  it('LOST → TRACKING without originReset leaves lastRestartedPayload null', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    const state = store.getState();
    expect(selectTrackingPhase(state)).toBe('tracking');
    expect(selectLastRestartedPayload(state)).toBeNull();
  });
});

describe('trackingSlice — Case 2: relocalization', () => {
  it('LOST → TRACKING after originReset populates lastRestartedPayload with raw WebXR positions', () => {
    const store = createStore();
    const lastOrientation: DeviceOrientation = {
      alpha: 90,
      beta: 0,
      gamma: 0,
      absolute: false,
    };
    const newOrientation: DeviceOrientation = {
      alpha: 180,
      beta: 45,
      gamma: 30,
      absolute: true,
    };
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: lastOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: newOrientation })
    );
    const payload = selectLastRestartedPayload(store.getState());
    expect(payload).not.toBeNull();
    expect(payload!.lastValidOdomPos).toEqual([1, 2, 3]);
    expect(payload!.lastValidOdomRot).toEqual([0, 0, 0, 1]);
    expect(payload!.newOdomPos).toEqual([0.1, 0.1, 0.1]);
    expect(payload!.newOdomRot).toEqual([0, 0.1, 0, 0.995]);
    expect(payload!.lastSensorOrientation).toEqual(lastOrientation);
    expect(payload!.newSensorOrientation).toEqual(newOrientation);
  });

  it('flows resetTransform through to the payload (transform supplied)', () => {
    const transform = {
      position: [0.5, 0, -0.3] as [number, number, number],
      orientation: [0, 0.1, 0, 0.995] as [number, number, number, number],
    };
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(transform));
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(
      selectLastRestartedPayload(store.getState())!.resetTransform
    ).toEqual(transform);
  });

  it('preserves null resetTransform (vs. undefined) when runtime supplied null', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(null));
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(
      selectLastRestartedPayload(store.getState())!.resetTransform
    ).toBeNull();
  });

  it('preserves undefined resetTransform when caller had no event reference', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(
      selectLastRestartedPayload(store.getState())!.resetTransform
    ).toBeUndefined();
  });

  it('clears originResetDuringLoss + resetTransform after transition', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(
      originReset({
        position: [1, 0, 0],
        orientation: [0, 0, 0, 1],
      })
    );
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    const state = store.getState();
    expect(state.tracking.originResetDuringLoss).toBe(false);
    expect(state.tracking.resetTransform).toBeUndefined();
  });

  it('emits no payload when LOST→TRACKING transition has no prior lastValidPose (defensive)', () => {
    // Manually craft the impossible-via-API state: LOST + originReset
    // flagged + no prior pose. The original manager logged a warning and
    // skipped the payload; reducer mirrors that by leaving the payload null.
    const store = configureStore({
      reducer: { tracking: trackingReducer },
      preloadedState: {
        tracking: {
          phase: 'lost',
          lastValidPose: null,
          lastSensorOrientation: null,
          lostFrameCount: 3,
          originResetDuringLoss: true,
          resetTransform: undefined,
          lastRestartedPayload: null,
        } satisfies TrackingSliceState,
      },
    });
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).toBeNull();
    expect(selectTrackingPhase(store.getState())).toBe('tracking');
  });

  it('omits the prior orientation rather than substituting the new one', () => {
    // INVERTED 2026-08-31. This used to assert the opposite - that a missing
    // prior orientation falls back to the NEW reading - kept "for parity" with
    // an older manager and justified as "reachable only via preloaded state".
    //
    // Both halves of that justification have expired. `sensorOrientation` is
    // now nullable, so a pose taken before the browser reports anything makes
    // this branch reachable on a REAL path; and the substitution writes into
    // the recording a claim that the earlier snapshot held a value it never
    // had.
    //
    // The alignment result is unchanged either way - substituting made both
    // sides equal, and equal sides cancel in `newSensor · inv(lastSensor)`,
    // which is what omitting them also produces via the library's
    // `resolveSensorPair`. What changes is that the recording stops lying.
    const newOrientation: DeviceOrientation = {
      alpha: 90,
      beta: 45,
      gamma: 30,
      absolute: false,
    };
    const store = configureStore({
      reducer: { tracking: trackingReducer },
      preloadedState: {
        tracking: {
          phase: 'lost',
          lastValidPose: initialPose,
          lastSensorOrientation: null,
          lostFrameCount: 1,
          originResetDuringLoss: true,
          resetTransform: undefined,
          lastRestartedPayload: null,
        } satisfies TrackingSliceState,
      },
    });
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: newOrientation })
    );
    const payload = selectLastRestartedPayload(store.getState())!;
    // Absent, not back-filled - the library refuses the incomplete pair.
    expect(payload.lastSensorOrientation).toBeUndefined();
    expect(payload.newSensorOrientation).toEqual(newOrientation);
  });

  it('uses captured (not current) lastSensorOrientation in the payload', () => {
    const captured: DeviceOrientation = {
      alpha: 90,
      beta: 0,
      gamma: 0,
      absolute: false,
    };
    const atRestart: DeviceOrientation = {
      alpha: 180,
      beta: 45,
      gamma: 30,
      absolute: false,
    };
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: captured })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: atRestart })
    );
    const payload = selectLastRestartedPayload(store.getState())!;
    expect(payload.lastSensorOrientation).toEqual(captured);
    expect(payload.newSensorOrientation).toEqual(atRestart);
  });
});

describe('trackingSlice — lastRestartedPayload lifecycle', () => {
  it('clearLastRestartedPayload resets it to null', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).not.toBeNull();
    store.dispatch(clearLastRestartedPayload());
    expect(selectLastRestartedPayload(store.getState())).toBeNull();
  });

  it('a subsequent steady-state poseReceived does NOT clobber an unread payload', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    const before = selectLastRestartedPayload(store.getState());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).toEqual(before);
  });

  it('a consecutive Case 2 transition overwrites the prior unread payload', () => {
    const store = createStore();
    // First cycle: Case 2 with transform A
    const transformA = {
      position: [1, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset(transformA));
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    // Second cycle, host never called clear: transform B should be visible
    const transformB = {
      position: [2, 0, 0] as [number, number, number],
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    store.dispatch(poseLost());
    store.dispatch(originReset(transformB));
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    expect(
      selectLastRestartedPayload(store.getState())!.resetTransform
    ).toEqual(transformB);
  });

  it('a Case 1 recovery following an unread Case 2 payload keeps the Case 2 payload visible', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    const case2 = selectLastRestartedPayload(store.getState());
    expect(case2).not.toBeNull();
    // Second cycle = Case 1 (no originReset)
    store.dispatch(poseLost());
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).toEqual(case2);
  });
});

describe('trackingSlice — resetTracking', () => {
  it('returns to INITIALIZING and nulls every field', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(resetTracking());
    const state = store.getState();
    expect(selectTrackingPhase(state)).toBe('initializing');
    expect(selectLastValidPose(state)).toBeNull();
    expect(selectLostFrameCount(state)).toBe(0);
    expect(selectLastRestartedPayload(state)).toBeNull();
    expect(state.tracking.originResetDuringLoss).toBe(false);
    expect(state.tracking.resetTransform).toBeUndefined();
    expect(state.tracking.lastSensorOrientation).toBeNull();
  });

  it('clears the origin reset flag so a fresh session starts clean', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(resetTracking());
    // New session, seamless recovery — must NOT emit a payload
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: defaultOrientation })
    );
    store.dispatch(poseLost());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: defaultOrientation })
    );
    expect(selectLastRestartedPayload(store.getState())).toBeNull();
  });
});

describe('trackingSlice — a restart with no sensor reading', () => {
  /**
   * Why these tests matter: the framework used to fabricate
   * `alpha/beta/gamma = 0` whenever the browser had given it no reading, and
   * `0` is a legal value meaning "facing north, flat and level". The payload
   * built here feeds the core library's `calcRotationOffsetFromRestart`, so a
   * fabricated half-pair applied a whole absolute heading as though the device
   * had turned by it.
   *
   * The fix has two halves and this is the second: the reducer must OMIT what
   * it does not have, so `resolveSensorPair` in the library can refuse the
   * pair. Re-zeroing here would make an incomplete pair look complete and
   * reinstate the bug one layer down, which is why it is asserted rather than
   * left to the type.
   */
  it('omits both orientation fields when no reading exists at either end', () => {
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: null })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(poseReceived({ pose: newPose, sensorOrientation: null }));

    const payload = selectLastRestartedPayload(store.getState());
    expect(payload).not.toBeNull();
    // Present and zeroed would be the bug; absent is the contract.
    expect(payload!.lastSensorOrientation).toBeUndefined();
    expect(payload!.newSensorOrientation).toBeUndefined();
    // The odometry half must still be there - refusing the compass must not
    // refuse the restart.
    expect(payload!.lastValidOdomPos).toEqual([1, 2, 3]);
    expect(payload!.newOdomRot).toEqual([0, 0.1, 0, 0.995]);
  });

  it('omits only the side that is missing, leaving the pair visibly incomplete', () => {
    // THE DEFECT'S OWN SHAPE: the compass becomes available between the last
    // valid pose and the restart. The reducer must not paper over that - the
    // library decides what an incomplete pair means, and it can only do so if
    // the incompleteness survives.
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: null })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({
        pose: newPose,
        sensorOrientation: { alpha: 90, beta: 0, gamma: 0, absolute: true },
      })
    );

    const payload = selectLastRestartedPayload(store.getState());
    expect(payload!.lastSensorOrientation).toBeUndefined();
    expect(payload!.newSensorOrientation).toEqual({
      alpha: 90,
      beta: 0,
      gamma: 0,
      absolute: true,
    });
  });

  it('preserves a per-axis null rather than zeroing it', () => {
    // A phone with no magnetometer: null alpha, real beta/gamma. Zeroing alpha
    // here would look identical to a real "facing north" reading.
    const noCompass: DeviceOrientation = {
      alpha: null,
      beta: 12,
      gamma: -4,
      absolute: false,
    };
    const store = createStore();
    store.dispatch(
      poseReceived({ pose: initialPose, sensorOrientation: noCompass })
    );
    store.dispatch(poseLost());
    store.dispatch(originReset());
    store.dispatch(
      poseReceived({ pose: newPose, sensorOrientation: noCompass })
    );

    const payload = selectLastRestartedPayload(store.getState());
    expect(payload!.lastSensorOrientation?.alpha).toBeNull();
    expect(payload!.lastSensorOrientation?.beta).toBe(12);
  });
});
