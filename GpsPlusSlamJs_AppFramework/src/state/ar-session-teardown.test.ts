import { describe, expect, it } from 'vitest';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { teardownArSessionState } from './ar-session-teardown';
import { startSession } from './recording-slice';
import { recordGpsEvent, setZeroPos } from 'gps-plus-slam-js';
import { selectGpsPositions, selectZeroReference } from './app-selectors';

/**
 * Why this test matters: three consumer apps ended AR sessions without any
 * state teardown, so a re-entry blended the dead session's odometry-origin
 * GPS pairs into the new session's alignment solve (found across the
 * PR #359 and M3/M4 review rounds). This is the ONE shared sequence (DEC-H3
 * unification) — proven against the real slices: recording closed, pairs
 * dropped, the ZERO preserved (scene content is placed relative to it).
 */
describe('teardownArSessionState', () => {
  it('closes the recording, drops the session pairs, keeps the zero', () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    store.dispatch(
      startSession({ contextTag: 't', sessionName: 'live', startTime: 1 })
    );
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    store.dispatch(
      recordGpsEvent({
        odomPosition: [0, 0, 0],
        odomRotation: [0, 0, 0, 1],
        rawGpsPoint: {
          id: 'fix-1',
          latitude: 47.5,
          longitude: 8.7,
          latLongAccuracy: 5,
          timestamp: 1756150000000,
        },
      })
    );
    expect(selectGpsPositions(store.getState()).length).toBe(1);

    teardownArSessionState(store);

    expect(store.getState().recording.isRecording).toBe(false);
    expect(selectGpsPositions(store.getState()).length).toBe(0);
    expect(selectZeroReference(store.getState())).toEqual({
      lat: 47.5,
      lon: 8.7,
    });
  });
});
