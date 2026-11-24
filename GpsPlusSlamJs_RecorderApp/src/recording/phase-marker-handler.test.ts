/**
 * Unit tests for the phase-marker tap handler.
 *
 * Why these tests matter: the "Mark phase" button is tapped mid-walk with the
 * phone held up, so the tap has to (a) land in the recording's action stream
 * exactly when the recording can still carry it, (b) say so on screen in a
 * way that can be read at a glance, and (c) say so just as clearly when it
 * did NOT count. A marker the user believes was recorded but was not is the
 * one failure the offline analysis cannot detect afterwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRecorderStore } from '../state/recorder-store';
import { OpfsStorageBackend } from 'gps-plus-slam-app-framework/storage/opfs-storage-backend';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  initOpfsStorage,
  createSession,
  resetOpfsStorage,
} from 'gps-plus-slam-app-framework/storage/opfs-storage';
import { exportSessionAsZip } from 'gps-plus-slam-app-framework/storage/zip-export';
import { loadActionsFromZip } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { installOPFSMocks } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import {
  startSession,
  endSession,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import { phaseMarked, selectPhaseMarkers } from '../state/phase-markers-slice';
import { createPhaseMarkerHandler } from './phase-marker-handler';
import { showToast } from '../ui/toast';
import { setPhaseMarkButtonLabel } from '../ui/hud';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../ui/hud', () => ({ setPhaseMarkButtonLabel: vi.fn() }));

const T0 = 1_750_000_000_000;

function recordingStore() {
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
  });
  store.dispatch(
    startSession({ contextTag: 'test', sessionName: 'test', startTime: T0 })
  );
  return store;
}

beforeEach(() => {
  vi.mocked(showToast).mockClear();
  vi.mocked(setPhaseMarkButtonLabel).mockClear();
});

describe('createPhaseMarkerHandler', () => {
  it('records marker 1, then 2, each with the tap time, and confirms each on screen', () => {
    const store = recordingStore();
    let now = T0 + 1000;
    const handler = createPhaseMarkerHandler({
      getStore: () => store,
      isStopInProgress: () => false,
      now: () => now,
    });

    expect(handler.markPhase()).toBe(1);
    now += 3000;
    expect(handler.markPhase()).toBe(2);

    expect(selectPhaseMarkers(store.getState())).toEqual([
      { number: 1, timestamp: T0 + 1000 },
      { number: 2, timestamp: T0 + 4000 },
    ]);
    // The confirmation names the number: that is how the walker matches a
    // marker to the protocol step on the sheet.
    expect(showToast).toHaveBeenLastCalledWith(
      'Phase 2 marked',
      expect.objectContaining({ severity: 'info' })
    );
    expect(setPhaseMarkButtonLabel).toHaveBeenLastCalledWith(2);
  });

  // Why: the failure path of the async-feedback rule. A refused tap must not
  // be numbered, must not change the button, and must say it did not count.
  it.each([
    ['outside a recording', false, false],
    ['while the recording is stopping', true, true],
  ])('refuses a tap %s and says so', (_label, recording, stopping) => {
    const store = recording
      ? recordingStore()
      : createRecorderStore({ storageBackend: new NullStorageBackend() });
    const handler = createPhaseMarkerHandler({
      getStore: () => store,
      isStopInProgress: () => stopping,
    });

    expect(handler.markPhase()).toBeNull();
    expect(selectPhaseMarkers(store.getState())).toEqual([]);
    expect(setPhaseMarkButtonLabel).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Not recording - phase marker not saved',
      expect.objectContaining({ severity: 'warning' })
    );
  });

  // Why: a new recording gets a new store; the handler must follow it and
  // number from 1 again rather than continue the previous walk's count.
  it('follows a store swap and numbers the next recording from 1', () => {
    let store = recordingStore();
    const handler = createPhaseMarkerHandler({
      getStore: () => store,
      isStopInProgress: () => false,
    });
    handler.markPhase();
    handler.markPhase();
    store = recordingStore();
    expect(handler.markPhase()).toBe(1);
  });

  // Why: the whole point of the marker is that it reaches the session zip.
  // This runs the real persistence middleware, the real OPFS writer (on the
  // in-memory OPFS mock), the real zip export and the real zip reader, then
  // replays the read actions into a fresh store.
  it('survives the session zip round trip', async () => {
    const { cleanup } = installOPFSMocks();
    try {
      await initOpfsStorage();
      const { sessionName } = await createSession(new Date(T0), 'test');
      const store = createRecorderStore({
        storageBackend: new OpfsStorageBackend(),
      });
      store.dispatch(
        startSession({ contextTag: 'test', sessionName, startTime: T0 })
      );
      let now = T0;
      const handler = createPhaseMarkerHandler({
        getStore: () => store,
        isStopInProgress: () => false,
        now: () => (now += 2000),
      });
      handler.markPhase();
      handler.markPhase();
      handler.markPhase();
      store.dispatch(endSession());
      await store.flushPendingActionWrites();

      const { blob } = await exportSessionAsZip(sessionName);
      const entries = await loadActionsFromZip(
        new Uint8Array(await blob.arrayBuffer())
      );
      const recorded = entries
        .map((e) => e.action)
        .filter((a) => a.type === phaseMarked.type);
      expect(recorded.map((a) => a.payload)).toEqual([
        { number: 1, timestamp: T0 + 2000 },
        { number: 2, timestamp: T0 + 4000 },
        { number: 3, timestamp: T0 + 6000 },
      ]);

      const replay = createRecorderStore({
        storageBackend: new NullStorageBackend(),
      });
      for (const { action } of entries) replay.dispatch(action);
      expect(selectPhaseMarkers(replay.getState())).toEqual(
        selectPhaseMarkers(store.getState())
      );
    } finally {
      resetOpfsStorage();
      cleanup();
    }
  });
});
