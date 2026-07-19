/**
 * Tests for `createSlamAppStore` — the framework's composable Redux store
 * factory introduced in Iter 1 of the AppFramework/RecorderApp boundary
 * migration ([plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)).
 *
 * The factory replaces `createRecorderStore` for non-recorder consumers.
 * It wires:
 * - The three library reducers (`gpsData`, `gpsElements`, `arElements`).
 * - The framework-owned recording lifecycle slice (`recorder`).
 * - The persistence middleware bridging Redux → `StorageBackend`.
 *
 * Recorder-only state (routing, ref-points, scenario name) is supplied
 * by the consumer via `extraReducers` / `extraMiddleware`. The factory
 * itself never references those concepts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSlice } from '@reduxjs/toolkit';
import { setZeroPos, setColdStartOverrideEnabled } from 'gps-plus-slam-js';
import { createSlamAppStore } from './create-slam-app-store';
import { startSession, endSession } from './recording-slice';
import type { StorageBackend } from '../storage/storage-backend';
import { NullStorageBackend } from '../storage/null-storage-backend';

function makeBackend(): StorageBackend {
  return new NullStorageBackend();
}

describe('createSlamAppStore', () => {
  let backend: StorageBackend;

  beforeEach(() => {
    backend = makeBackend();
  });

  describe('default state shape', () => {
    it('exposes the three library reducers', () => {
      // Why: any AR+GPS app needs the library's gpsData/gpsElements/arElements
      // state. The factory must wire them unconditionally.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState();
      expect(state.gpsData).toBeDefined();
      expect(state.gpsElements).toBeDefined();
      expect(state.arElements).toBeDefined();
    });

    it('exposes the framework recording slice', () => {
      // Why: recording lifecycle (isRecording, counters, sessionMetadata) is
      // a framework-owned concern; every app built on it gets it for free.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState();
      expect(state.recording).toBeDefined();
      expect(state.recording.isRecording).toBe(false);
      expect(state.recording.actionCount).toBe(0);
    });

    it('does NOT include routing, refPoints, or scenario reducers by default', () => {
      // Why: those are recorder-only concerns. A generic app composing the
      // factory must not pay for them. They land via `extraReducers` only.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState() as Record<string, unknown>;
      expect(state.routing).toBeUndefined();
      expect(state.refPoints).toBeUndefined();
      expect(state.scenario).toBeUndefined();
    });
  });

  describe('extraReducers boundary validation (PR #17 review)', () => {
    it('throws a clear error when an extraReducers key collides with a framework-reserved slice', () => {
      // Why this test matters: extraReducers is spread AFTER the built-ins, so
      // a colliding key (mistake or name clash) silently REPLACED a framework
      // reducer — corrupting e.g. GPS state with no diagnostic. The factory is
      // a public boundary; bad input must fail loudly at construction.
      expect(() =>
        createSlamAppStore({
          storageBackend: backend,
          extraReducers: { gpsData: () => null },
        })
      ).toThrow(/gpsData/);
    });

    it('names every colliding key, not just the first', () => {
      expect(() =>
        createSlamAppStore({
          storageBackend: backend,
          extraReducers: {
            recording: () => ({}),
            trackingQuality: () => ({}),
          },
        })
      ).toThrow(/recording.*trackingQuality|trackingQuality.*recording/);
    });

    it('still accepts non-colliding extraReducers unchanged', () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        extraReducers: { myAppSlice: () => 'ok' },
      });
      expect(
        (store.getState() as unknown as { myAppSlice: string }).myAppSlice
      ).toBe('ok');
    });
  });

  describe('enableCompassColdStartOverride (Stage-0, default-on feature)', () => {
    it('enables the override once gpsData exists (after the first setZeroPos)', async () => {
      // Why: the flag lives on the gpsData slice, which is null until the first
      // setZeroPos; the factory must defer the opt-in until that slice exists.
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: true,
      });
      // Before any GPS fix: gpsData is null, nothing to enable.
      expect(store.getState().gpsData).toBeNull();
      // First fix creates the slice; a prepended listener-middleware effect
      // flips the flag after setZeroPos's dispatch unwinds (so the opt-in
      // persists AFTER setZeroPos — replay fidelity). Effects are async, hence
      // the await. See slam-app-store-listener.ts.
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
    });

    it('enables the override BY DEFAULT (Stage-0 ships on for every consumer)', async () => {
      // Stage 0 is now a default-on production feature (field-validated): a
      // consumer that says nothing still gets the cold-start compass override.
      // The library default stays OFF for replay determinism — default-on lives
      // here at the framework opt-in tier (the dispatch is a recorded action).
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
    });

    it('can be opted out via enableCompassColdStartOverride: false', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: false,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBeFalsy();
    });

    it('leaves the OTHER compass flags off by default (only Stage 0 ships on)', async () => {
      // Stage C (rotation prior) and the WebXR-consistency gate stay
      // field-gated; flipping Stage 0 on must not drag them on too.
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.compassRotationPriorEnabled).toBeFalsy();
      expect(s?.compassWebXRConsistencyEnabled).toBeFalsy();
    });
  });

  describe('enableCompassRotationPrior (Stage-C debug opt-in)', () => {
    it('enables the rotation prior once gpsData exists (after the first setZeroPos)', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassRotationPrior: true,
      });
      expect(store.getState().gpsData).toBeNull();
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.compassRotationPriorEnabled).toBe(true);
    });

    it('leaves it off by default', () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      expect(store.getState().gpsData?.compassRotationPriorEnabled).toBeFalsy();
    });
  });

  // Why these tests matter: the 2026-07-19 recorder enablement plan exposes
  // two on-device field-test opt-ins. `enableCompassExperiment` must set the
  // library's `compassExperimentEnabled` flag (which threads the decided
  // combo: rotation prior + trust tolerance 15° + C′ pair selection — the
  // combo itself is pinned in the LIBRARY's gpsDataSlice tests, not here);
  // `enableRansacComparison` sets `ransacComparisonEnabled` (plain useRansac
  // A/B arm). Both follow the recorded-action opt-in pattern: dispatched only
  // once gpsData exists, default OFF ⇒ byte-identical.
  describe('enableCompassExperiment + enableRansacComparison (field-test opt-ins)', () => {
    it('enables the compass experiment once gpsData exists (after the first setZeroPos)', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassExperiment: true,
      });
      expect(store.getState().gpsData).toBeNull();
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.compassExperimentEnabled).toBe(true);
    });

    it('enables the RANSAC comparison once gpsData exists', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableRansacComparison: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.ransacComparisonEnabled).toBe(true);
    });

    it('leaves both off by default (byte-identical)', async () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.compassExperimentEnabled).toBeFalsy();
      expect(s?.ransacComparisonEnabled).toBeFalsy();
    });

    it('both experiment opt-ins combine with the default Stage-0 override', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassExperiment: true,
        enableRansacComparison: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.coldStartOverrideEnabled).toBe(true); // default-on Stage 0
      expect(s?.compassExperimentEnabled).toBe(true);
      expect(s?.ransacComparisonEnabled).toBe(true);
    });
  });

  describe('enableCompassWebXRConsistency (GPS-free trust gate debug opt-in)', () => {
    it('enables the consistency gate once gpsData exists', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassWebXRConsistency: true,
      });
      expect(store.getState().gpsData).toBeNull();
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.compassWebXRConsistencyEnabled).toBe(
        true
      );
    });

    it('leaves it off by default', () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      expect(
        store.getState().gpsData?.compassWebXRConsistencyEnabled
      ).toBeFalsy();
    });

    it('all three compass opt-ins can be enabled together', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: true,
        enableCompassRotationPrior: true,
        enableCompassWebXRConsistency: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.coldStartOverrideEnabled).toBe(true);
      expect(s?.compassRotationPriorEnabled).toBe(true);
      expect(s?.compassWebXRConsistencyEnabled).toBe(true);
    });

    it('RE-APPLIES the opt-in if the flag is later cleared (robust to the recorder gpsData-recreation race)', async () => {
      // Field bug (2026-06-27): in the recorder the opt-in ended up dropped — the
      // flag fired against a gpsData that was then recreated (store swap / origin
      // reset), and a one-shot subscription never re-applied it. The opt-in must
      // therefore be idempotently re-applied whenever gpsData exists with the flag
      // unset, not fired exactly once. Modelled here by clearing it directly.
      // Re-application runs in a listener-middleware effect (async, level-based
      // predicate: "gpsData exists and a flag is unset"), hence the awaits.
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
      store.dispatch(setColdStartOverrideEnabled(false)); // simulate the drop
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
    });
  });

  describe('lifecycle dispatch', () => {
    it('handles startSession / endSession through the recording slice', () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(
        startSession({
          scenarioName: 'Generic',
          sessionName: 's1',
          startTime: 1,
        })
      );
      expect(store.getState().recording.isRecording).toBe(true);
      store.dispatch(endSession());
      expect(store.getState().recording.isRecording).toBe(false);
    });
  });

  describe('extraReducers', () => {
    it('mounts caller-supplied reducers under their slice keys', () => {
      // Why: composable factory contract — recorder will plug routing /
      // refPoints / scenario through this seam without the framework knowing.
      const counter = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          inc(state) {
            state.value += 1;
          },
        },
      });
      const store = createSlamAppStore({
        storageBackend: backend,
        extraReducers: { counter: counter.reducer },
      });
      expect(
        (store.getState() as { counter: { value: number } }).counter.value
      ).toBe(0);
      store.dispatch(counter.actions.inc());
      expect(
        (store.getState() as { counter: { value: number } }).counter.value
      ).toBe(1);
    });
  });

  describe('extraMiddleware', () => {
    it('runs caller-supplied middleware in order with the persistence middleware', () => {
      // Why: lets consumers add app-specific middleware (logging, analytics,
      // recorder-specific side effects) without forking the factory.
      const seen: string[] = [];
      const trackingMiddleware =
        () => (next: (a: unknown) => unknown) => (action: unknown) => {
          if (
            typeof action === 'object' &&
            action !== null &&
            typeof (action as { type?: unknown }).type === 'string'
          ) {
            seen.push((action as { type: string }).type);
          }
          return next(action);
        };
      const store = createSlamAppStore({
        storageBackend: backend,
        extraMiddleware: [trackingMiddleware],
      });
      store.dispatch(endSession());
      expect(seen).toContain('recording/endSession');
    });
  });

  describe('storage backend wiring', () => {
    it('routes writeFrame / writeSessionMetadata through the supplied backend', async () => {
      // Why: A1 fix — abstraction boundary; tests must be able to substitute
      // a NullStorageBackend / spy backend in place of OPFS.
      const writeFrame = vi.fn().mockResolvedValue(undefined);
      const writeSessionMetadata = vi.fn().mockResolvedValue(undefined);
      const spy: StorageBackend = {
        createSession: vi.fn().mockResolvedValue({ sessionName: 's' }),
        listSessions: vi.fn().mockResolvedValue([]),
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame,
        writeSessionMetadata,
      };
      const store = createSlamAppStore({ storageBackend: spy });
      const blob = new Blob(['x']);
      await store.writeFrame(blob, 1);
      expect(writeFrame).toHaveBeenCalledWith(blob, 1);
      await store.writeSessionMetadata({
        version: 1,
        startedAt: '',
        endedAt: '',
        actionCount: 0,
        frameCount: 0,
        userAgent: '',
      });
      expect(writeSessionMetadata).toHaveBeenCalled();
    });

    // Why: the stop flow must be able to await every queued action write
    // before it reads `actions/` for the final sync / ZIP export (the
    // persistence WriteQueue is async — a mark dispatched moments before
    // Stop could otherwise miss the zip). This pins that the store exposes
    // the middleware's drain hook and that it actually waits for the
    // backend write to settle.
    it('flushPendingActionWrites resolves only after queued action writes settled', async () => {
      let releaseWrite!: () => void;
      const writeAction = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseWrite = resolve;
          })
      );
      const spy: StorageBackend = {
        createSession: vi.fn().mockResolvedValue({ sessionName: 's' }),
        listSessions: vi.fn().mockResolvedValue([]),
        writeAction,
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
      };
      const store = createSlamAppStore({ storageBackend: spy });
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'flush-session',
          startTime: Date.now(),
        })
      );

      let flushed = false;
      const flushPromise = store.flushPendingActionWrites().then(() => {
        flushed = true;
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(writeAction).toHaveBeenCalled();
      expect(flushed).toBe(false);

      releaseWrite();
      await flushPromise;
      expect(flushed).toBe(true);
    });
  });

  describe('license validation', () => {
    it('throws when an invalid license key is supplied', () => {
      // Why: the framework must never run without a valid license — including
      // the bundled community key path. Empty / bad keys are a hard fail.
      expect(() =>
        createSlamAppStore({ storageBackend: backend, licenseKey: '' })
      ).toThrow();
    });
  });
});
