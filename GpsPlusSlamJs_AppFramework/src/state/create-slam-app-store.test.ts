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
      // Stage 0 is a default-on production feature (field-validated): a consumer
      // that says nothing still gets the cold-start compass override. Since
      // gps-plus-slam-js 1.16.0 the LIBRARY default is on too, so this assertion
      // no longer distinguishes the two tiers on its own — what it still pins is
      // that the framework records the value as an explicit `gpsData` action
      // rather than leaving replay to infer it from whatever the library
      // currently defaults to.
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
    });

    it('can be opted out via enableCompassColdStartOverride: false', async () => {
      // Why this asserts `false` and not `toBeFalsy()`: it used to assert
      // falsy, which `undefined` satisfies — so the test passed while the
      // opt-out did NOTHING. That was harmless only as long as the LIBRARY
      // default was also off, because "never dispatched" and "dispatched
      // false" then had the same effect. Since gps-plus-slam-js 1.16.0 the
      // library default is ON and `undefined` means "use the library
      // default", so the two differ: only an explicit `false` opts out.
      // `toBeFalsy()` cannot tell them apart, which is exactly why it kept
      // passing. See the replay-fidelity test below for the consequence.
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: false,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(false);
    });

    it('dispatches the opt-in value EXPLICITLY, so the library default cannot decide it', async () => {
      // Why this test matters: this is the regression that shipping
      // gps-plus-slam-js 1.16.0 would otherwise have introduced silently.
      //
      // The framework used to dispatch only when the option was TRUE
      // (`rows.filter(r => r.enabled)`), leaving `coldStartOverrideEnabled`
      // `undefined` on an explicit `false`. The library reads `undefined` as
      // "use DefaultAlignmentConfig", which flipped from `false` to `true` in
      // 1.16.0 — so `enableCompassColdStartOverride: false` silently started
      // meaning ON. RecorderApp replay passes exactly that `false` to keep a
      // recording captured WITHOUT the override from replaying WITH it
      // (see replay-mode.ts), so the failure landed on replay fidelity.
      //
      // The fix is to make the framework's intent explicit in state rather
      // than inferable from a library default: the cold-start row (the one
      // marked `recordWhenFalse`) dispatches its actual value. That removes the
      // class FOR THAT FLAG — a future library-default flip cannot reinterpret a
      // recording, because the recording now carries the value as an action. The
      // other four opt-ins are still dispatch-on-`true` and so still stay
      // `undefined` when disabled; their library defaults are `false`, so they
      // need the marker only if that changes (rule stated on the field).
      for (const value of [true, false]) {
        const store = createSlamAppStore({
          storageBackend: backend,
          enableCompassColdStartOverride: value,
        });
        store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
        await Promise.resolve();
        expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(value);
      }
    });

    it('does NOT overwrite a value the action stream already decided (replay contract)', async () => {
      // Why this test matters: this is the shape that distinguishes "supply an
      // initial value" from "enforce a value forever", and getting it wrong
      // inverts the very bug the explicit dispatch was added to fix.
      //
      // `replay-mode.ts` passes `enableCompassColdStartOverride: false` and then
      // replays a recorded action stream. A session recorded WITH the override
      // carries `setColdStartOverrideEnabled(true)`, which arrives AFTER the
      // framework's opt-in has fired (the opt-in fires on the first `setZeroPos`;
      // the recorded action comes later in the stream). If the listener treats
      // "flag !== my option" as "not applied yet", it re-dispatches `false` over
      // the recorded `true` — because its predicate is edge-triggered on the
      // `gpsData` OBJECT REFERENCE, and the recorded action creates a fresh one.
      // The session would then replay WITHOUT an override it was recorded WITH:
      // the same defect as before, in the opposite direction.
      //
      // So the framework's value is a DEFAULT that the stream overrides, and
      // `isSet` must ask "has this flag been decided at all?", not "does it equal
      // my option?".
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: false,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(false);

      // The recorded action from a session captured WITH the override.
      store.dispatch(setColdStartOverrideEnabled(true));
      await Promise.resolve();
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
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
  // `enableRobustSolverComparison` sets `robustSolverComparisonEnabled` (the
  // alternative robust-solver A/B arm). Both follow the recorded-action
  // opt-in pattern: dispatched only once gpsData exists, default OFF ⇒
  // byte-identical.
  describe('enableCompassExperiment + enableRobustSolverComparison (field-test opt-ins)', () => {
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

    it('enables the Robust-solver comparison once gpsData exists', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableRobustSolverComparison: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.robustSolverComparisonEnabled).toBe(
        true
      );
    });

    it('leaves both off by default (byte-identical)', async () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.compassExperimentEnabled).toBeFalsy();
      expect(s?.robustSolverComparisonEnabled).toBeFalsy();
    });

    // Why: the vote-weight slider (2026-07-19 weight-curve follow-up) rides
    // this option — a number, not a flag, so it is dispatched only when the
    // caller provides one (absent ⇒ library default, byte-identical).
    it('compassVoteWeight dispatches the weight once gpsData exists', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassExperiment: true,
        compassVoteWeight: 0.1,
      });
      expect(store.getState().gpsData).toBeNull();
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.compassExperimentEnabled).toBe(true);
      expect(s?.compassVoteWeight).toBe(0.1);
    });

    it('compassVoteWeight stays absent when not provided', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassExperiment: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.compassVoteWeight).toBeUndefined();
    });

    it('both experiment opt-ins combine with the default Stage-0 override', async () => {
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassExperiment: true,
        enableRobustSolverComparison: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      const s = store.getState().gpsData;
      expect(s?.coldStartOverrideEnabled).toBe(true); // default-on Stage 0
      expect(s?.compassExperimentEnabled).toBe(true);
      expect(s?.robustSolverComparisonEnabled).toBe(true);
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

    it('does NOT fight an explicit later dispatch (the drop case moved to the listener test)', async () => {
      // This test used to assert the OPPOSITE, and the change is deliberate.
      //
      // Field bug (2026-06-27): the opt-in fired against a gpsData that was then
      // recreated (store swap / origin reset) and a one-shot subscription never
      // re-applied it, so the flag ended up dropped. It must be re-applied
      // whenever gpsData exists with the flag UNSET. That requirement still
      // holds — but this test modelled "unset" with an explicit
      // `setColdStartOverrideEnabled(false)`, which was only a valid stand-in
      // while `false` and `undefined` had the same effect. Since gps-plus-slam-js
      // 1.16.0 they do not: `undefined` means "use the library default" (now ON)
      // and `false` is a DECISION. Re-applying `true` over an explicit `false` is
      // exactly what breaks replay of a session recorded with the override off.
      //
      // Where the real coverage lives now: `slam-app-store-listener.test.ts`
      // "re-applies the opt-in when gpsData is recreated" resets gpsData to
      // `null` and dispatches a fresh `setZeroPos`, i.e. the actual field-bug
      // mechanism rather than a proxy for it. It can do that because it builds
      // its own store; a real store here has no way to reach an unset flag (a
      // second `setZeroPos`, even a large origin jump, PRESERVES it — verified).
      //
      // What this test pins instead is the other half of the contract: a value
      // the stream decides is left alone.
      const store = createSlamAppStore({
        storageBackend: backend,
        enableCompassColdStartOverride: true,
      });
      store.dispatch(setZeroPos({ lat: 0, lon: 0 }));
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(true);
      store.dispatch(setColdStartOverrideEnabled(false));
      await Promise.resolve();
      await Promise.resolve();
      expect(store.getState().gpsData?.coldStartOverrideEnabled).toBe(false);
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
