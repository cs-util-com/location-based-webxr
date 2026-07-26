/**
 * Tests for {@link createSlamAppStoreListenerMiddleware}.
 *
 * Why these tests matter: this listener middleware replaces the former
 * `store.subscribe` + `queueMicrotask` + `scheduled`-guard scaffolding that
 * applied the compass opt-in flags. The whole point of the migration is that a
 * listener-middleware *effect* runs **after** the triggering dispatch unwinds,
 * so the opt-in becomes a top-level dispatch that persists *after* its trigger
 * (the recorder-fidelity invariant pinned in `recorder-store.test.ts`
 * "persists the compass opt-in AFTER setZeroPos"). These tests pin the
 * module-local contract that makes that work:
 *   - the opt-in is dispatched exactly once per gpsData creation,
 *   - it is dispatched AFTER the trigger (never re-entrantly inside it),
 *   - it RE-APPLIES when gpsData is recreated (store-swap / origin-reset
 *     semantics — the 2026-06-27 field bug), and
 *   - nothing fires when no opt-in was requested.
 *
 * See GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md
 */
import { describe, it, expect } from 'vitest';
import {
  configureStore,
  combineReducers,
  type Middleware,
  type UnknownAction,
} from '@reduxjs/toolkit';
import {
  gpsDataReducer,
  setZeroPos,
  setColdStartOverrideEnabled,
  setCompassRotationPriorEnabled,
  type RootState as LibraryRootState,
} from 'gps-plus-slam-js';
import {
  createSlamAppStoreListenerMiddleware,
  type CompassOptIn,
} from './slam-app-store-listener';

const COLD = 'gpsData/setColdStartOverrideEnabled';
const PRIOR = 'gpsData/setCompassRotationPriorEnabled';
const RESET = 'test/reset';

// `isSet` is "has this been DECIDED?" (`!== undefined`), never "does it equal my
// value?". These fixtures previously used `=== true`, which is the shape the
// middleware's sidecar now forbids: because the predicate is edge-triggered on the
// `gpsData` object reference, a value-equality `isSet` makes the listener a value
// ENFORCER that overwrites any other writer — see `slam-app-store-listener.ts.md`
// §Invariants. These are also the in-repo examples a reader is most likely to copy,
// so they must show the correct shape even though this file tests the middleware
// generically and would pass either way.
const coldOptIn: CompassOptIn = {
  isSet: (s) => s.gpsData?.coldStartOverrideEnabled !== undefined,
  apply: (dispatch) => dispatch(setColdStartOverrideEnabled(true)),
};
const priorOptIn: CompassOptIn = {
  isSet: (s) => s.gpsData?.compassRotationPriorEnabled !== undefined,
  apply: (dispatch) => dispatch(setCompassRotationPriorEnabled(true)),
};

/**
 * Minimal store wired exactly like the real factory: the listener middleware
 * is **prepended** (so its effect runs after the trigger fully unwinds) and an
 * action logger is appended so we can assert dispatch order. A root reducer
 * resets `gpsData` to `null` on `test/reset`, reproducing the store-swap /
 * origin-reset recreation that the real library has no in-slice action for.
 */
function makeStore(optIns: readonly CompassOptIn[]): {
  store: ReturnType<typeof configureStore>;
  log: string[];
} {
  const log: string[] = [];
  const logger: Middleware = () => (next) => (action) => {
    const result = next(action);
    const t = (action as UnknownAction).type;
    if (typeof t === 'string') log.push(t);
    return result;
  };
  const baseReducer = combineReducers({ gpsData: gpsDataReducer });
  const rootReducer = (
    state: ReturnType<typeof baseReducer> | undefined,
    action: UnknownAction
  ): ReturnType<typeof baseReducer> =>
    action.type === RESET
      ? baseReducer(undefined, action)
      : baseReducer(state, action);

  const listener = createSlamAppStoreListenerMiddleware(optIns);
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false })
        .prepend(listener)
        .concat(logger),
  });
  return { store, log };
}

/** Let the listener middleware's async effect job run to completion. */
const flushEffects = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('createSlamAppStoreListenerMiddleware', () => {
  it('dispatches the opt-in exactly once, AFTER the trigger', async () => {
    const { store, log } = makeStore([coldOptIn]);
    store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
    await flushEffects();

    // Exactly one opt-in dispatch (no re-entrant storm).
    expect(log.filter((t) => t === COLD)).toHaveLength(1);
    // Ordering: the trigger is logged before the opt-in (the opt-in is a
    // top-level dispatch that runs after setZeroPos's dispatch unwinds).
    expect(log.indexOf('gpsData/setZeroPos')).toBeLessThan(log.indexOf(COLD));
    expect(
      (store.getState() as LibraryRootState).gpsData?.coldStartOverrideEnabled
    ).toBe(true);
  });

  it('dispatches every requested opt-in once', async () => {
    const { store, log } = makeStore([coldOptIn, priorOptIn]);
    store.dispatch(setZeroPos({ lat: 1, lon: 2 }));
    await flushEffects();

    expect(log.filter((t) => t === COLD)).toHaveLength(1);
    expect(log.filter((t) => t === PRIOR)).toHaveLength(1);
    const gps = (store.getState() as LibraryRootState).gpsData;
    expect(gps?.coldStartOverrideEnabled).toBe(true);
    expect(gps?.compassRotationPriorEnabled).toBe(true);
  });

  it('re-applies the opt-in when gpsData is recreated (store-swap / origin-reset)', async () => {
    const { store, log } = makeStore([coldOptIn]);
    store.dispatch(setZeroPos({ lat: 1, lon: 2 }));
    await flushEffects();
    expect(log.filter((t) => t === COLD)).toHaveLength(1);

    // Recreate gpsData with the flag cleared (the field-bug scenario).
    store.dispatch({ type: RESET });
    expect((store.getState() as LibraryRootState).gpsData).toBeNull();
    store.dispatch(setZeroPos({ lat: 3, lon: 4 }));
    await flushEffects();

    // The opt-in must be re-applied — a one-shot would have left it OFF.
    expect(log.filter((t) => t === COLD)).toHaveLength(2);
    expect(
      (store.getState() as LibraryRootState).gpsData?.coldStartOverrideEnabled
    ).toBe(true);
  });

  it('does not dispatch anything when no opt-in is requested', async () => {
    const { store, log } = makeStore([]);
    store.dispatch(setZeroPos({ lat: 1, lon: 2 }));
    await flushEffects();
    expect(log.filter((t) => t === COLD || t === PRIOR)).toHaveLength(0);
  });

  it('does not fire before gpsData exists', async () => {
    const { store, log } = makeStore([coldOptIn]);
    // A non-gpsData-creating action while gpsData is still null must not
    // trigger the opt-in (flags live on gpsData; nothing to set yet).
    store.dispatch({ type: 'test/noop' });
    await flushEffects();
    expect(log.filter((t) => t === COLD)).toHaveLength(0);
  });

  it('does not dispatch-storm when an opt-in apply never sets its flag (version skew)', async () => {
    // Failure mode: the recorder app and the published `gps-plus-slam` library
    // are versioned independently (see CLAUDE.md). On version skew the consumer's
    // action creator can emit a type the library reducer no longer recognises, so
    // `apply` dispatches but `isSet` never flips to true. With a purely
    // level-based predicate ("gpsData present AND some flag unset") that condition
    // stays true forever: every dispatch the effect makes re-satisfies the
    // predicate, re-runs the effect, dispatches again — an unbounded storm that
    // freezes the app. The per-dispatch `isSet` re-check guards against duplicate
    // dispatches of a flag that DID get set; it does nothing when the flag never
    // sets. A defensive predicate must also stop re-firing for the SAME gpsData.
    let applyCount = 0;
    const mismatchedOptIn: CompassOptIn = {
      // Never becomes true (simulates a reducer that ignores the dispatched type).
      isSet: (s) => s.gpsData?.coldStartOverrideEnabled === true,
      apply: (dispatch) => {
        applyCount++;
        // Safety valve so a genuine storm bounds the test instead of hanging.
        if (applyCount > 50) return;
        dispatch({ type: 'gpsData/staleActionFromVersionSkew' });
      },
    };
    const { store } = makeStore([mismatchedOptIn]);
    store.dispatch(setZeroPos({ lat: 1, lon: 2 }));
    // Drain many effect cycles; a converged predicate applies at most once per
    // gpsData creation, a storming one keeps climbing until the safety valve.
    for (let i = 0; i < 20; i++) await flushEffects();

    expect(applyCount).toBeLessThanOrEqual(1);
  });
});
