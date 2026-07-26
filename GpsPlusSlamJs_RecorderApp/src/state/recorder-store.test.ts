/**
 * Recorder Store Tests
 *
 * Combined library + recorder Redux store integration tests. Migrated from
 * the framework's old `state/store.test.ts` as part of Iter 1 of the
 * AppFramework / RecorderApp boundary migration — the recorder now owns
 * `createRecorderStore`, so its tests live alongside it.
 *
 * Tests verify that:
 * 1. The library store is properly integrated.
 * 2. GPS events are recorded with paired AR poses.
 * 3. The library's alignment algorithm receives proper data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRecorderStore, type RecorderStore } from './recorder-store';
import {
  startSession,
  endSession,
  recordWriteFailure,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import {
  setZeroPos,
  recordGpsEvent,
  type RawGpsPoint,
} from 'gps-plus-slam-app-framework/state';
import { setCurrentScenarioName } from './scenario-slice';
import { addRefPointEntry, type RefPointEntry } from './ref-points-slice';
import { navigateTo } from './routing-slice';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';

// Persistence writes flow through ScenarioWrappingStorageBackend → opfs-storage.
// Mock only writeAction so the store's action-persistence path can be asserted
// without touching real OPFS; the rest of opfs-storage stays real (partial mock).
vi.mock(
  'gps-plus-slam-app-framework/storage/opfs-storage',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    writeAction: vi.fn().mockResolvedValue(undefined),
  })
);

describe('Recorder Store', () => {
  let store: RecorderStore;

  beforeEach(() => {
    store = createRecorderStore();
  });

  describe('Recorder State', () => {
    it('should initialize with default recorder state', () => {
      const state = store.getState().recording;
      expect(state.isRecording).toBe(false);
      expect(state.sessionMetadata).toBeNull();
      expect(state.actionCount).toBe(0);
    });

    it('should start a session', () => {
      store.dispatch(
        startSession({
          contextTag: 'Test Scenario',
          sessionName: 'recording-2025-01-01_12-00-00utc',
          startTime: Date.now(),
          notes: 'Test notes',
        })
      );

      const state = store.getState().recording;
      expect(state.isRecording).toBe(true);
      expect(state.sessionMetadata?.contextTag).toBe('Test Scenario');
    });

    it('should end a session', () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      store.dispatch(endSession());

      const state = store.getState().recording;
      expect(state.isRecording).toBe(false);
    });

    // Why this test matters: currentScenarioName is used by 6+ modules
    // (recording-session-handlers, folder-manager, main, hud, file-system).
    // Storing it in Redux eliminates callback threading through factory deps.
    it('should initialize currentScenarioName as empty string', () => {
      const state = store.getState().scenario;
      expect(state.currentScenarioName).toBe('');
    });

    // Why this test matters: Verifies the action creator + reducer roundtrip
    // so callers can dispatch setCurrentScenarioName and read via getState().
    it('should update currentScenarioName via setCurrentScenarioName action', () => {
      store.dispatch(setCurrentScenarioName('Park Walk'));
      expect(store.getState().scenario.currentScenarioName).toBe('Park Walk');
    });

    // Why this test matters: Starting a new session should NOT reset the
    // scenario name — user selects it before recording and it persists.
    it('should preserve currentScenarioName across startSession', () => {
      store.dispatch(setCurrentScenarioName('Downtown'));
      store.dispatch(
        startSession({
          scenarioName: 'Downtown',
          sessionName: 'recording-2025-01-01',
          startTime: Date.now(),
        })
      );
      expect(store.getState().scenario.currentScenarioName).toBe('Downtown');
    });
  });

  describe('Library Integration', () => {
    it('should initialize library state as null', () => {
      const state = store.getState();
      expect(state.gpsData).toBeNull();
    });

    it('should set zero position via library action', () => {
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));

      const state = store.getState();
      expect(state.gpsData).not.toBeNull();
      expect(state.gpsData?.zero.lat).toBeCloseTo(48.8566);
      expect(state.gpsData?.zero.lon).toBeCloseTo(2.3522);
    });

    it('should record GPS events via library action', () => {
      // First set zero position
      const zeroRef = { lat: 48.8566, lon: 2.3522 };
      store.dispatch(setZeroPos(zeroRef));

      // Record a GPS event with paired AR pose
      store.dispatch(
        recordGpsEvent({
          odomPosition: [1, 2, 3],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 48.8567,
            longitude: 2.3523,
            altitude: 100,
            latLongAccuracy: 5,
            timestamp: Date.now(),
          },
        })
      );

      const state = store.getState();
      const gpsEvents = state.gpsData?.gpsEvents;
      expect(gpsEvents?.odometryPositions.length).toBe(1);
      // Dispatched [1,2,3] (raw WebXR) -> reducer applies webxrToNUE -> [-3, 2, 1]
      expect(gpsEvents?.odometryPositions[0]).toEqual([-3, 2, 1]);
      expect(gpsEvents?.gpsPositions.length).toBe(1);
      expect(gpsEvents?.gpsPositions[0].latitude).toBeCloseTo(48.8567);
    });

    it('should compute alignment matrix as GPS events accumulate', () => {
      // Set zero position
      const zeroRef = { lat: 48.8566, lon: 2.3522 };
      store.dispatch(setZeroPos(zeroRef));

      // Record multiple GPS events at different positions
      for (let i = 0; i < 5; i++) {
        store.dispatch(
          recordGpsEvent({
            odomPosition: [i * 10, 0, 0],
            odomRotation: [0, 0, 0, 1],
            rawGpsPoint: {
              id: `gps-${i + 1}`,
              latitude: 48.8566 + i * 0.0001,
              longitude: 2.3522,
              latLongAccuracy: 5,
              timestamp: Date.now() + i * 1000,
            },
          })
        );
      }

      const state = store.getState();
      const gpsEvents = state.gpsData?.gpsEvents;

      // Should have 5 positions
      expect(gpsEvents?.odometryPositions.length).toBe(5);

      // Alignment matrix should be computed
      // (Even if identity, it should exist)
      expect(gpsEvents?.alignmentMatrix).toBeDefined();
      expect(gpsEvents?.alignmentMatrix.length).toBe(16);
    });
  });

  describe('Subscriber Notification Optimization', () => {
    /**
     * Regression test for subscriber notification bug.
     *
     * WHY THIS TEST MATTERS:
     * The store wraps library state in a new object on each getState() call.
     * If we compare the wrapper objects (prevState !== currentState), it would
     * always be true because they're different object references even when
     * the underlying state hasn't changed. This would cause unnecessary
     * subscriber notifications on every dispatch, defeating the purpose of
     * the optimization and potentially causing performance issues.
     *
     * The fix compares the individual state slices (libraryStore.getState()
     * and recorderState) which return stable references when unchanged.
     */
    it('should only notify subscribers when state actually changes', () => {
      const listener = vi.fn();
      store.subscribe(listener);

      // Start a session - this SHOULD trigger notification (state changes)
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      expect(listener).toHaveBeenCalledTimes(1);

      // End session - this SHOULD trigger notification (state changes)
      store.dispatch(endSession());
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should notify when library state changes via GPS actions', () => {
      const listener = vi.fn();
      store.subscribe(listener);

      // Set zero position - this SHOULD trigger notification.
      // The tracking-quality listener middleware also fires follow-up
      // dispatches (snapshotPushed, reportUpdated, etc.), so the
      // subscriber is called more than once per user dispatch.
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      const afterZero = listener.mock.calls.length;
      expect(afterZero).toBeGreaterThanOrEqual(1);

      // Record GPS event - this SHOULD trigger additional notifications
      store.dispatch(
        recordGpsEvent({
          odomPosition: [1, 2, 3],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 48.8567,
            longitude: 2.3523,
            altitude: 100,
            latLongAccuracy: 5,
            timestamp: Date.now(),
          },
        })
      );
      expect(listener.mock.calls.length).toBeGreaterThan(afterZero);
    });

    it('should allow multiple subscribers and unsubscribe correctly', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsubscribe1 = store.subscribe(listener1);
      store.subscribe(listener2);

      // Both should be called (middleware may add extra dispatches)
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      const l1AfterZero = listener1.mock.calls.length;
      const l2AfterZero = listener2.mock.calls.length;
      expect(l1AfterZero).toBeGreaterThanOrEqual(1);
      expect(l2AfterZero).toBeGreaterThanOrEqual(1);

      // Unsubscribe listener1
      unsubscribe1();

      // Only listener2 should be called now
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      expect(listener1.mock.calls.length).toBe(l1AfterZero); // Unchanged
      expect(listener2.mock.calls.length).toBeGreaterThan(l2AfterZero);
    });
  });

  describe('Action Persistence', () => {
    /**
     * Why this test matters:
     * The store calls writeAction() to persist gpsData/* and recorder/* actions
     * during recording. This test verifies the persistence logic is invoked
     * with the correct actions.
     *
     * NOTE: This test mocks writeAction. The actual prerequisite (calling
     * startStorageSession before dispatching) is tested in main.test.ts.
     * If writeAction isn't initialized properly, it throws "No active session".
     */
    it('should persist gpsData and recorder actions when recording', async () => {
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');

      // Start session to enable persistence
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // startSession itself should be persisted
      expect(writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recording/startSession' }),
        expect.any(Number)
      );

      // Set zero and record GPS - these should also be persisted
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));

      expect(writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gpsData/setZeroPos' }),
        expect.any(Number)
      );
    });

    /**
     * Why this test matters (regression guard for the F1 class of bugs):
     * Live "Capture" marks are dispatched as `refPoints/addRefPointEntry`
     * (the production slice name, see ref-points-slice.ts). Replay-mode
     * hydrates marks from the persisted ACTION STREAM, not the OPFS sidecar
     * — so if the framework's persistence middleware does not persist this
     * action, freshly recorded sessions silently lose their ref-point marks
     * on replay.
     *
     * This test wires the REAL `refPoints` slice and the REAL persistence
     * middleware together via `createRecorderStore`, so a future rename of
     * the slice (or a stale prefix in the middleware filter) cannot pass
     * unnoticed. A middleware-only unit test that builds its own local
     * slice cannot catch this drift because it never observes the
     * production action type.
     */
    it('should persist refPoints/ mark actions when recording', async () => {
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      vi.mocked(writeAction).mockClear();

      const rawGpsPoint: RawGpsPoint = {
        id: 'gps-1',
        latitude: 50.123,
        longitude: 6.789,
        altitude: 200,
        latLongAccuracy: 4,
        altitudeAccuracy: 3,
        timestamp: 1_700_000_000_000,
      };
      const entry: RefPointEntry = {
        id: '8a1fb46622dffff',
        timestamp: 1_700_000_000_000,
        rawGpsPoint,
      };

      store.dispatch(addRefPointEntry(entry));

      expect(writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refPoints/addRefPointEntry' }),
        expect.any(Number)
      );
    });

    /**
     * Why this test matters (indoor-loop enablement follow-up, 2026-07-12):
     * the field protocol for loop recordings is "re-mark every corner on
     * every pass WITHIN one recording" — multiple `addRefPointEntry`
     * dispatches of the SAME id in one session. Every prior test dispatched
     * a single mark, so a middleware regression that dedupes, drops, or
     * mis-indexes repeated same-id actions would pass unnoticed and starve
     * the investigation ground truth exactly like the 2026-07-11 session.
     * This wires the REAL slice + REAL middleware and pins that all three
     * re-marks persist, each with its own incrementing index and its own
     * payload (none merged away).
     */
    it('persists EVERY re-observation of the same ref-point id with incrementing indices', async () => {
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'recording-loop-session',
          startTime: Date.now(),
        })
      );
      vi.mocked(writeAction).mockClear();

      const baseTs = 1_700_000_000_000;
      const markOf = (timestamp: number): RefPointEntry => ({
        id: '8b1fa0a4970afff', // one physical corner, re-marked per loop pass
        timestamp,
        rawGpsPoint: {
          id: `gps-${timestamp}`,
          latitude: 50.123,
          longitude: 6.789,
          timestamp,
        },
      });

      // Three marks of the same corner, ≥10 s apart (past the UI cooldown).
      store.dispatch(addRefPointEntry(markOf(baseTs)));
      store.dispatch(addRefPointEntry(markOf(baseTs + 15_000)));
      store.dispatch(addRefPointEntry(markOf(baseTs + 30_000)));

      // Writes flow through the middleware's async WriteQueue — rapid
      // successive dispatches are queued, not written synchronously, so the
      // assertion must wait for the queue to drain (this is also why the
      // single-mark tests above never noticed: their one write starts on
      // the first microtask).
      const getMarkWrites = () =>
        vi
          .mocked(writeAction)
          .mock.calls.filter(
            ([action]) =>
              (action as { type?: string }).type ===
              'refPoints/addRefPointEntry'
          );
      await vi.waitFor(() => expect(getMarkWrites()).toHaveLength(3));
      const markWrites = getMarkWrites();
      // Each write keeps its own payload — nothing deduped or overwritten.
      expect(
        markWrites.map(
          ([action]) =>
            (action as { payload: { timestamp: number } }).payload.timestamp
        )
      ).toEqual([baseTs, baseTs + 15_000, baseTs + 30_000]);
      // Indices increment strictly (distinct actions/NNNNNN.json files).
      const indices = markWrites.map(([, index]) => index);
      expect(indices[1]).toBe(indices[0]! + 1);
      expect(indices[2]).toBe(indices[1]! + 1);

      // The REAL slice appends all three (pure append, no dedupe).
      expect(store.getState().refPoints.entries).toHaveLength(3);
    });

    it('should NOT persist actions when not recording', async () => {
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      vi.mocked(writeAction).mockClear();

      // Dispatch without starting a session
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));

      expect(writeAction).not.toHaveBeenCalled();
    });

    it('should use 1-based indexing for action persistence', async () => {
      /**
       * Why this test matters:
       * Design documents (opfs-storage.ts.md) specify that action indices are
       * 1-based (000001.json, 000002.json, etc.) for consistency with the
       * storage layer's directory structure. This test ensures the store
       * passes 1-based indices to writeAction, not 0-based.
       */
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      vi.mocked(writeAction).mockClear();

      // Start session - this is the first persisted action
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // First action should have index 1 (1-based), not 0
      expect(writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recording/startSession' }),
        1
      );

      // Second action should have index 2
      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      expect(writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gpsData/setZeroPos' }),
        2
      );
    });

    it('persists the compass opt-in AFTER setZeroPos so replay re-enables it (recording-fidelity)', async () => {
      // Field finding (2026-06-27): in-house recordings (64c6a294, e7431b85)
      // showed the compass opt-in actions persisted BEFORE the first setZeroPos,
      // so replay dropped them (gpsData is null until setZeroPos) and the override
      // looked OFF on replay even though it worked live. Root cause: the framework
      // applied the opt-ins from a `store.subscribe` listener, which fires INSIDE
      // setZeroPos's dispatch (subscriber notification runs within `next()`),
      // while the persistence middleware enqueues AFTER `next()` — so the opt-in
      // actions get LOWER persistence indices than setZeroPos itself. Pin the
      // ordering BY INDEX (not async write-callback order) so the fix can't
      // silently regress.
      const backend = new NullStorageBackend();
      const writeSpy = vi.spyOn(backend, 'writeAction');
      const s = createRecorderStore({
        storageBackend: backend,
        enableDevChecks: false,
        enableCompassColdStartOverride: true,
        enableCompassRotationPrior: true,
        enableCompassWebXRConsistency: true,
      });
      s.dispatch(
        startSession({
          scenarioName: 'test',
          sessionName: 'fidelity',
          startTime: Date.now(),
        })
      );
      s.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      // Drain the async write queue so every writeAction call is captured.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const byIndex = writeSpy.mock.calls
        .map((c) => ({
          type: (c[0] as { type: string }).type,
          index: c[1],
        }))
        .sort((a, b) => a.index - b.index);
      const zero = byIndex.find((x) => x.type === 'gpsData/setZeroPos');
      const cold = byIndex.find(
        (x) => x.type === 'gpsData/setColdStartOverrideEnabled'
      );
      expect(zero).toBeDefined();
      expect(cold).toBeDefined();
      // Replay applies actions in index order; the opt-in must come AFTER the
      // setZeroPos that creates gpsData, or the reducer drops it (state null).
      expect((zero as { index: number }).index).toBeLessThan(
        (cold as { index: number }).index
      );
      // No re-entrant "storm": each opt-in is persisted EXACTLY ONCE. The old
      // store.subscribe mechanism re-entered itself and double-dispatched each
      // flag; the listener middleware applies each unset flag once per gpsData
      // creation (idempotency re-check before each dispatch).
      const optInTypes = [
        'gpsData/setColdStartOverrideEnabled',
        'gpsData/setCompassRotationPriorEnabled',
        'gpsData/setCompassWebXRConsistencyEnabled',
      ];
      for (const t of optInTypes) {
        expect(byIndex.filter((x) => x.type === t)).toHaveLength(1);
      }
    });

    it('forwards the 2026-07-19 field-test opt-ins to the framework store (experiment + Robust-solver comparison)', async () => {
      // Why: the recorder settings toggles reach the solve only through this
      // forwarding chain (compassDebug → createRecorderStore →
      // createSlamAppStore → recorded gpsData actions). Pin that both new
      // options arrive on the gpsData slice — a dropped forward would make the
      // settings toggle silently inert on device.
      const s = createRecorderStore({
        storageBackend: new NullStorageBackend(),
        enableDevChecks: false,
        enableCompassExperiment: true,
        enableRobustSolverComparison: true,
        compassVoteWeight: 0.1,
      });
      s.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const gpsData = s.getState().gpsData as {
        compassExperimentEnabled?: boolean;
        robustSolverComparisonEnabled?: boolean;
        compassVoteWeight?: number;
      } | null;
      expect(gpsData?.compassExperimentEnabled).toBe(true);
      expect(gpsData?.robustSolverComparisonEnabled).toBe(true);
      expect(gpsData?.compassVoteWeight).toBe(0.1);
    });

    it('should use per-instance action indices, not shared across stores (Bug 10)', async () => {
      /**
       * Why this test matters:
       * actionIndex was a module-level variable shared across all store
       * instances. Creating a second store reset the counter for the first
       * store's future dispatches, causing file-index collisions if an async
       * callback dispatched to the old store after a new store was created.
       * Each store instance must maintain its own independent counter.
       */
      const spyBackend1 = new NullStorageBackend();
      const writeSpy1 = vi.spyOn(spyBackend1, 'writeAction');
      const store1 = createRecorderStore({
        storageBackend: spyBackend1,
        enableDevChecks: false,
        // `false` no longer SUPPRESSES the Stage-0 opt-in action — since
        // gps-plus-slam-js 1.16.0 the library default is `true`, so the framework
        // must record an explicit `setColdStartOverrideEnabled(false)` or the
        // opt-out does nothing. There is therefore no way to get a compass-free
        // action stream any more, which is why the assertions below match a
        // SPECIFIC call instead of the last one: the subject here is the
        // per-instance index counter, not the exact contents of the stream.
        enableCompassColdStartOverride: false,
      });

      // Start session on store1 to enable persistence
      store1.dispatch(
        startSession({
          scenarioName: 'test',
          sessionName: 'session-1',
          startTime: Date.now(),
        })
      );
      // startSession = index 1
      expect(writeSpy1).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'recording/startSession' }),
        1
      );

      // setZeroPos = index 2
      store1.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      expect(writeSpy1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gpsData/setZeroPos' }),
        2
      );

      // Create a SECOND store — this must NOT affect store1's counter
      const spyBackend2 = new NullStorageBackend();
      createRecorderStore({
        storageBackend: spyBackend2,
        enableDevChecks: false,
        enableCompassColdStartOverride: false,
      });

      // Dispatch on store1 again - the index must CONTINUE, not restart at 1.
      // Three changes from the original assertion, all downstream of the
      // framework now recording an explicit Stage-0 opt-out (see the note above):
      //  - index 4, not 3: the stream is startSession(1), setZeroPos(2),
      //    setColdStartOverrideEnabled(false)(3), setZeroPos(4).
      //  - a SPECIFIC call, not the last one: this setZeroPos is an origin jump,
      //    which rebuilds gpsData; the rebuild clears the flag, so the opt-in
      //    re-applies and the LAST write is that re-apply.
      //  - it must AWAIT the drain hook. The write queue caps concurrency at 3
      //    (MAX_CONCURRENT_WRITES), so the 4th write is queued and writeAction is
      //    NOT called synchronously. This test passed before only because it
      //    happened to stay under the cap - a latent fragility the extra action
      //    exposed rather than caused.
      store1.dispatch(setZeroPos({ lat: 1, lon: 1 }));
      await store1.flushPendingActionWrites();
      expect(writeSpy1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gpsData/setZeroPos' }),
        4
      );
    });
  });

  describe('Failed Write Tracking', () => {
    /**
     * TDD tests for Issue #1 Part B: Track failed writes.
     *
     * WHY THESE TESTS MATTER:
     * User feedback showed that write operations can fail silently
     * (NoModificationAllowedError), resulting in 0-byte files.
     * The user needs visibility into failed writes both during recording
     * (via toast) and after (in session summary).
     */

    it('should initialize failedWriteCount to 0', () => {
      // Why: Baseline state should have no failed writes
      const state = store.getState().recording;
      expect(state.failedWriteCount).toBe(0);
    });

    it('should increment failedWriteCount when recordWriteFailure is dispatched', () => {
      // Why: Store needs to track write failures for summary display
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      store.dispatch(recordWriteFailure('Test error message'));

      const state = store.getState().recording;
      expect(state.failedWriteCount).toBe(1);
    });

    it('should accumulate multiple write failures', () => {
      // Why: Multiple failures can occur during a session
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      store.dispatch(recordWriteFailure('Error 1'));
      store.dispatch(recordWriteFailure('Error 2'));
      store.dispatch(recordWriteFailure('Error 3'));

      const state = store.getState().recording;
      expect(state.failedWriteCount).toBe(3);
    });

    it('should reset failedWriteCount when starting a new session', () => {
      // Why: Each session starts fresh; verify the reducer clears failedWriteCount
      // (not just initial store state)
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );
      store.dispatch(recordWriteFailure('Error'));
      expect(store.getState().recording.failedWriteCount).toBe(1);

      // Start a new session on the same store instance - this tests that
      // startSession reducer resets failedWriteCount, not store initialization
      store.dispatch(
        startSession({
          scenarioName: 'Test 2',
          sessionName: 'test-session-2',
          startTime: Date.now(),
        })
      );

      const state = store.getState().recording;
      expect(state.failedWriteCount).toBe(0);
    });

    it('should call onWriteFailure callback when write fails during persistence', async () => {
      // Why: UI layer needs to know about failures to show toast
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      const mockError = new Error('NoModificationAllowedError: read-only');
      vi.mocked(writeAction).mockRejectedValueOnce(mockError);

      const onWriteFailure = vi.fn();
      store = createRecorderStore({ onWriteFailure });

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // Wait for the async write to fail
      await vi.waitFor(() => {
        expect(onWriteFailure).toHaveBeenCalledTimes(1);
      });

      expect(onWriteFailure).toHaveBeenCalledWith(mockError);
    });

    it('should dispatch recordWriteFailure when write fails', async () => {
      // Why: Failed write count needs to be tracked in state for summary
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      const mockError = new Error('Write failed');
      vi.mocked(writeAction).mockRejectedValueOnce(mockError);

      store = createRecorderStore();

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // Wait for the async write to fail and update state
      await vi.waitFor(() => {
        expect(store.getState().recording.failedWriteCount).toBe(1);
      });
    });

    it('should NOT persist recordWriteFailure actions to avoid recursive persistence', async () => {
      /**
       * WHY THIS TEST MATTERS:
       * When writeAction fails, we dispatch recordWriteFailure to track the failure.
       * If recordWriteFailure itself were persisted, and that write also failed,
       * we'd get infinite recursion:
       *   writeAction fails -> recordWriteFailure -> writeAction -> fails -> recordWriteFailure -> ...
       *
       * This test ensures recordWriteFailure is excluded from persistence.
       * This also enables us to use dispatch() consistently in the catch block
       * instead of manually updating state, addressing the code duplication concern.
       */
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      vi.mocked(writeAction).mockClear();

      store = createRecorderStore();

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // Clear mock to focus on recordWriteFailure
      vi.mocked(writeAction).mockClear();

      // Dispatch recordWriteFailure directly
      store.dispatch(recordWriteFailure('Manual test error'));

      // writeAction should NOT have been called for recordWriteFailure
      expect(writeAction).not.toHaveBeenCalled();

      // But state should still be updated
      expect(store.getState().recording.failedWriteCount).toBe(1);
    });

    it('should call onWriteFailure with normalized Error when rejection is non-Error', async () => {
      // Why: JavaScript allows rejecting with any value (string, object, etc.)
      // UI feedback must work regardless of rejection type - without this fix,
      // non-Error rejections would skip the onWriteFailure callback entirely
      const { writeAction } =
        await import('gps-plus-slam-app-framework/storage/opfs-storage');
      const nonErrorRejection = 'string rejection value';
      vi.mocked(writeAction).mockRejectedValueOnce(nonErrorRejection);

      const onWriteFailure = vi.fn();
      store = createRecorderStore({ onWriteFailure });

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      // Wait for the async write to fail
      await vi.waitFor(() => {
        expect(onWriteFailure).toHaveBeenCalledTimes(1);
      });

      // Should receive a normalized Error, not the raw string
      const receivedError = onWriteFailure.mock.calls[0][0] as Error;
      expect(receivedError).toBeInstanceOf(Error);
      expect(receivedError.message).toBe(nonErrorRejection);
    });
  });

  describe('StorageBackend injection', () => {
    /**
     * Why these tests matter:
     * Finding F2: The store hard-imports writeAction from file-system.ts, forcing
     * tests to use vi.mock(). A StorageBackend option decouples the store from
     * concrete persistence, enabling clean testing and replay mode.
     */

    it('should accept a storageBackend option and use it for persistence', () => {
      // Why: Core F2 behavior — injected backend replaces the hard-coded import
      const mockBackend = {
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const injectedStore = createRecorderStore({
        storageBackend: mockBackend,
      });

      injectedStore.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      expect(mockBackend.writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recording/startSession' }),
        1
      );
    });

    it('should use injected backend for GPS actions during recording', () => {
      // Why: GPS actions must also flow through the injected backend
      const mockBackend = {
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const injectedStore = createRecorderStore({
        storageBackend: mockBackend,
      });

      injectedStore.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      injectedStore.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));

      expect(mockBackend.writeAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gpsData/setZeroPos' }),
        2
      );
    });

    it('should call onWriteFailure when injected backend rejects', async () => {
      // Why: Error handling must work with any StorageBackend, not just the mock
      const mockBackend = {
        writeAction: vi.fn().mockRejectedValueOnce(new Error('Backend error')),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };
      const onWriteFailure = vi.fn();

      const injectedStore = createRecorderStore({
        storageBackend: mockBackend,
        onWriteFailure,
      });

      injectedStore.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      await vi.waitFor(() => {
        expect(onWriteFailure).toHaveBeenCalledTimes(1);
      });

      expect(onWriteFailure).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not persist when using NullStorageBackend in replay mode', () => {
      // Why: Validates the replay use case — no persistence side effects
      const backend = new NullStorageBackend();
      const spy = vi.spyOn(backend, 'writeAction');

      // Stage-0 opt-in explicitly OFF. Since gps-plus-slam-js 1.16.0 that no
      // longer means "no compass action": the library default is ON, so the
      // framework MUST record setColdStartOverrideEnabled(false) or the opt-out
      // is a no-op. Hence three persisted actions, not two.
      const replayStore = createRecorderStore({
        storageBackend: backend,
        enableCompassColdStartOverride: false,
      });

      replayStore.dispatch(
        startSession({
          scenarioName: 'Replay',
          sessionName: 'replay-session',
          startTime: Date.now(),
        })
      );
      replayStore.dispatch(setZeroPos({ lat: 50.0, lon: 8.0 }));

      // NullStorageBackend is called (it's the backend) but does nothing
      expect(spy).toHaveBeenCalledTimes(3);
      // State is still updated correctly
      expect(replayStore.getState().gpsData).not.toBeNull();
      expect(replayStore.getState().recording.isRecording).toBe(true);
    });
  });

  describe('writeFrame and writeSessionMetadata delegation (A1)', () => {
    /**
     * Why these tests matter (Finding A1 — Architecture Audit):
     * main.ts imports writeFrame/writeSessionMetadata directly from file-system.ts,
     * bypassing the StorageBackend abstraction. This means NullStorageBackend is
     * ineffective for frame/metadata writes during replay/testing.
     *
     * These tests verify that the store exposes writeFrame() and
     * writeSessionMetadata() methods that delegate to the injected StorageBackend,
     * so main.ts can route ALL persistence through the store.
     */

    it('should expose writeFrame that delegates to the injected StorageBackend', async () => {
      // Why: writeFrame must flow through the backend so NullStorageBackend
      // can suppress writes during replay
      const mockBackend = {
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const injectedStore = createRecorderStore({
        storageBackend: mockBackend,
      });

      const blob = new Blob(['test'], { type: 'image/jpeg' });
      await injectedStore.writeFrame(blob, 42);

      expect(mockBackend.writeFrame).toHaveBeenCalledTimes(1);
      expect(mockBackend.writeFrame).toHaveBeenCalledWith(blob, 42);
    });

    it('should expose writeSessionMetadata that delegates to the injected StorageBackend', async () => {
      // Why: writeSessionMetadata must flow through the backend so
      // NullStorageBackend can suppress writes during replay
      const mockBackend = {
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const injectedStore = createRecorderStore({
        storageBackend: mockBackend,
      });

      const metadata = {
        version: 1 as const,
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T01:00:00.000Z',
        contextTag: 'Test',
        actionCount: 10,
        frameCount: 5,
        userAgent: 'test-agent',
      };

      await injectedStore.writeSessionMetadata(metadata);

      expect(mockBackend.writeSessionMetadata).toHaveBeenCalledTimes(1);
      expect(mockBackend.writeSessionMetadata).toHaveBeenCalledWith(metadata);
    });

    it('should use NullStorageBackend for writeFrame in replay mode — no side effects', async () => {
      // Why: In replay mode, frame writes must be silently suppressed.
      // Before A1 fix, main.ts called file-system.ts directly, ignoring NullStorageBackend.
      const backend = new NullStorageBackend();
      const frameSpy = vi.spyOn(backend, 'writeFrame');
      const metaSpy = vi.spyOn(backend, 'writeSessionMetadata');

      const replayStore = createRecorderStore({ storageBackend: backend });

      const blob = new Blob(['replay-frame'], { type: 'image/jpeg' });
      await replayStore.writeFrame(blob, 1);
      await replayStore.writeSessionMetadata({
        version: 1 as const,
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T01:00:00.000Z',
        contextTag: 'Replay',
        actionCount: 0,
        frameCount: 0,
        userAgent: 'test',
      });

      // NullStorageBackend receives the calls but does nothing
      expect(frameSpy).toHaveBeenCalledTimes(1);
      expect(metaSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Routing State (Bug 2 — SPA audit)', () => {
    // Why: Bug 2 requires currentScreen to live in Redux, not a module
    // variable. The store must include routing state and handle routing/
    // prefixed actions.

    it('should initialize routing state with setup screen', () => {
      const state = store.getState();
      expect(state.routing.currentScreen).toBe('setup');
    });

    it('should update currentScreen via navigateTo action', () => {
      store.dispatch(navigateTo('ar'));
      expect(store.getState().routing.currentScreen).toBe('ar');
    });

    it('should support full navigation lifecycle', () => {
      store.dispatch(navigateTo('ar'));
      store.dispatch(navigateTo('recording'));
      store.dispatch(navigateTo('summary'));
      store.dispatch(navigateTo('setup'));
      expect(store.getState().routing.currentScreen).toBe('setup');
    });

    it('should notify subscribers when routing state changes', () => {
      const listener = vi.fn();
      store.subscribe(listener);

      store.dispatch(navigateTo('ar'));

      expect(listener).toHaveBeenCalled();
    });

    it('should NOT persist routing actions during recording', async () => {
      // Why: routing state is UI-level, not part of the recorded session
      const backend = new NullStorageBackend();
      const spy = vi.spyOn(backend, 'writeAction');
      const persistStore = createRecorderStore({ storageBackend: backend });

      persistStore.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test-session',
          startTime: Date.now(),
        })
      );

      persistStore.dispatch(navigateTo('ar'));

      await vi.waitFor(() => {
        // startSession is persisted, but navigateTo should NOT be
        const persistedTypes = spy.mock.calls.map(
          (call) => (call[0] as { type: string }).type
        );
        expect(persistedTypes).not.toContain('routing/navigateTo');
      });
    });
  });

  describe('Compass alignment debug opt-ins', () => {
    // Why: the recorder exposes the library's Phase-4 compass flags (Stage 0 /
    // Stage C / consistency gate) so the operator can test them on-device. The
    // store must thread each through createSlamAppStore, which enables it on the
    // gpsData slice once that slice exists (after the first setZeroPos).
    it('threads all three compass flags into the library store', async () => {
      const s = createRecorderStore({
        enableCompassColdStartOverride: true,
        enableCompassRotationPrior: true,
        enableCompassWebXRConsistency: true,
      });
      expect(s.getState().gpsData).toBeNull();
      s.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      // The opt-ins are applied on a microtask after gpsData is created (so they
      // persist AFTER setZeroPos for replay fidelity — see the recording-fidelity
      // test above), so await one tick before asserting they landed.
      await Promise.resolve();
      const g = s.getState().gpsData;
      expect(g?.coldStartOverrideEnabled).toBe(true);
      expect(g?.compassRotationPriorEnabled).toBe(true);
      expect(g?.compassWebXRConsistencyEnabled).toBe(true);
    });

    it('inherits the framework defaults when no flags passed (Stage 0 on, others off)', async () => {
      // createRecorderStore forwards undefined → createSlamAppStore applies its
      // defaults: Stage 0 (cold-start override) is a default-on feature, while
      // Stage C + the consistency gate stay field-gated (off). The opt-in is
      // applied async after gpsData exists, hence the await.
      const s = createRecorderStore();
      s.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const g = s.getState().gpsData;
      expect(g?.coldStartOverrideEnabled).toBe(true);
      expect(g?.compassRotationPriorEnabled).toBeFalsy();
      expect(g?.compassWebXRConsistencyEnabled).toBeFalsy();
    });

    it('opts out of Stage 0 when enableCompassColdStartOverride: false', async () => {
      const s = createRecorderStore({ enableCompassColdStartOverride: false });
      s.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(s.getState().gpsData?.coldStartOverrideEnabled).toBeFalsy();
    });
  });
});
