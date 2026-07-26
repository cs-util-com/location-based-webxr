/**
 * `createSlamAppStore` — composable Redux store factory for AR+GPS apps.
 *
 * Introduced in Iter 1 of the AppFramework/RecorderApp boundary migration.
 * Wires the three library reducers (`gpsData`, `gpsElements`, `arElements`),
 * the framework's recording lifecycle slice, and the persistence middleware.
 *
 * Recorder-only state (routing screen, ref-points, scenario) is plugged in
 * by the consumer via `extraReducers` / `extraMiddleware`. The factory itself
 * never references those concepts so apps that don't need them (POI viewers,
 * navigation arrows, …) compose freely.
 *
 * This is the framework's ONLY store factory (the legacy
 * `createRecorderStore`/`store.ts` it replaced moved out in Iter 1D); the
 * core library's license error messages point here as the remediation.
 *
 * @see docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md — Iter 1
 */

import {
  configureStore,
  type Middleware,
  type Reducer,
  type ReducersMapObject,
  type UnknownAction,
} from '@reduxjs/toolkit';
import {
  gpsDataReducer,
  gpsElementsReducer,
  arElementsReducer,
  sanitizeForDevTools,
  validateLicenseKey,
  setZeroPos,
  setColdStartOverrideEnabled,
  setCompassRotationPriorEnabled,
  setCompassWebXRConsistencyEnabled,
  setCompassExperimentEnabled,
  setRobustSolverComparisonEnabled,
  setCompassVoteWeight,
  type RootState as LibraryRootState,
} from 'gps-plus-slam-js';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
import type { StorageBackend } from '../storage/storage-backend';
import type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage';
import {
  recordingReducer,
  recordWriteFailure,
  type RecordingState,
} from './recording-slice';
import { trackingReducer, type TrackingSliceState } from './tracking-slice';
import {
  trackingQualityReducer,
  createTrackingQualityListenerMiddleware,
  type TrackingQualitySliceState,
  type TrackingQualityOptions,
} from './tracking-quality';
import {
  createPersistenceMiddleware,
  slicePrefixOf,
} from './persistence-middleware';
import {
  createSlamAppStoreListenerMiddleware,
  type CompassOptIn,
} from './slam-app-store-listener';

/**
 * Slice prefixes the framework always persists, derived from the actual
 * library / framework action creators (never hand-typed). A rename of the
 * `gpsData` or `recording` slice therefore propagates here automatically
 * instead of silently dropping that slice's actions from recordings.
 */
const BUILTIN_PERSISTED_PREFIXES: readonly string[] = [
  slicePrefixOf(setZeroPos.type), // library `gpsData` slice
  slicePrefixOf(recordWriteFailure.type), // framework `recording` slice
];

type LibraryGpsDataState = NonNullable<LibraryRootState['gpsData']>;

/**
 * `gpsData` fields that can record a boolean compass opt-in. Filtering the
 * key union to boolean-typed fields keeps the opt-in table compile-checked:
 * a typo'd field name OR a field of the wrong type (e.g. the numeric
 * `compassVoteWeight`) fails to type-check as a table row.
 *
 * The guarantee is **read-side only**: `flag` is only ever read (via `isDecided`),
 * while the write goes through `setFlag`, whose reducer owns whichever field its
 * action writes. So the filter does not stop a row from pairing one flag with a
 * DIFFERENT flag's setter — that combination type-checks, and its failure mode is
 * the expensive one: `isSet` reads a field the `apply` never writes, so it never
 * flips, and per the listener's reference guard the opt-in re-fires on every later
 * `gpsData` mutation — i.e. on every GPS fix, for the rest of the session. Keep the
 * two halves of a row visually adjacent so a mismatch is obvious on sight.
 * A numeric field is in fact just an instance of that same mispairing, which is why
 * the filter earns its keep independently of the `isSet` form: no
 * `(value: boolean) => UnknownAction` can write a numeric field, so its `isSet`
 * never flips and it storms identically. (Before 2026-07-26 it failed one step
 * earlier and more visibly — `isSet` compared `=== true` against a value that could
 * never be `true`, i.e. an unsatisfiable comparison rather than an unwritten field.)
 */
type BooleanCompassFlagField = {
  [K in keyof LibraryGpsDataState]-?: NonNullable<
    LibraryGpsDataState[K]
  > extends boolean
    ? K
    : never;
}[keyof LibraryGpsDataState];

/**
 * Base shape produced by `createSlamAppStore` with no `extraReducers`.
 *
 * Library state (`gpsData` / `gpsElements` / `arElements`) plus the
 * framework recording slice (`recording`).
 */
export interface SlamAppRootState extends LibraryRootState {
  recording: RecordingState;
  tracking: TrackingSliceState;
  trackingQuality: TrackingQualitySliceState;
}

/** A bare-minimum middleware signature compatible with RTK's middleware list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlamAppMiddleware = Middleware<any, any, any>;

/**
 * Options for {@link createSlamAppStore}.
 */
export interface SlamAppStoreOptions<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
> {
  /**
   * Persistence backend used to bridge Redux actions to durable storage.
   * Tests / replay paths should pass `NullStorageBackend`.
   */
  storageBackend: StorageBackend;

  /**
   * Caller-supplied reducers added alongside the framework's built-ins.
   * Use this seam to plug recorder slices (routing, refPoints, scenario)
   * or any app-specific state without forking the factory.
   */
  extraReducers?: ExtraReducers;

  /**
   * Caller-supplied middlewares appended after RTK defaults and the
   * persistence middleware.
   */
  extraMiddleware?: ReadonlyArray<SlamAppMiddleware>;

  /**
   * Additional slice prefixes to persist beyond the framework built-ins
   * (`gpsData`, `recording`). Pass caller-owned slice names derived from
   * the slice itself — e.g. `slicePrefixOf(addRefPointEntry.type)` or
   * `refPointsSlice.name` — never a hand-typed literal, so a rename can
   * never silently drop the slice's actions from recordings.
   */
  persistedExtraPrefixes?: readonly string[];

  /**
   * Invoked when the persistence middleware fails to durably write an action.
   */
  onWriteFailure?: (error: Error) => void;

  /**
   * Disables RTK's expensive dev-only middleware (Serializable / Immutable
   * checks). Default `true`; set `false` for high-throughput replay scenarios.
   */
  enableDevChecks?: boolean;

  /**
   * License key for the core library. Defaults to the bundled community key.
   * Apps with a paid license override here. Validation always runs and throws
   * on invalid / expired / empty keys.
   *
   * @see EULA.md §3 — License Key
   */
  licenseKey?: string;

  /**
   * Optional overrides for the tracking-quality reporter
   * (matrix-history size, residual window, thresholds, etc.).
   *
   * @see docs/2026-05-16-tracking-quality-metrics-plan.md
   */
  trackingQualityOptions?: Partial<TrackingQualityOptions>;

  /**
   * Enable the library's Phase-4 **Stage-0** cold-start compass yaw override.
   * **Default `true`** — Stage 0 is a field-validated, default-on feature: at
   * cold start the GPS-derived yaw is unobservable (clustered fixes ⇒ a yaw set
   * by noise that flips as the user looks around), so the compass heading gives
   * a roughly-correct, stable orientation immediately ("open app, stand still,
   * look around" works). It is an observability-gated handover — once a walked
   * baseline conditions the GPS yaw, the solve hands back to GPS — so it does no
   * harm once GPS is observable. Pass `false` to opt out (the recorder exposes
   * this as a settings toggle).
   *
   * The factory dispatches `setColdStartOverrideEnabled(<this value>)` — `false`
   * included — the first time `gpsData` becomes non-null (right after the first
   * `setZeroPos`, since the flag lives on that slice and cannot be set before it
   * exists).
   *
   * Replay/determinism: **since gps-plus-slam-js 1.16.0 the library's
   * `DefaultAlignmentConfig.useCompassColdStartOverride` is `true`**, so "no
   * recorded opt-in action" no longer means "override off" — it means "whatever
   * the library currently defaults to". That is why the value is dispatched
   * explicitly rather than only when true: the recorded action stream states
   * which configuration a session ran with, so a future library-default change
   * cannot reinterpret an existing recording. A recording carrying
   * `setColdStartOverrideEnabled(true)` replays with the override on; one
   * carrying `false` replays with it off, regardless of the library default.
   * **For Stage-A/§6a field-calibration recordings, turn this OFF** (recorder
   * settings) so the captured compass behaviour is unmodified.
   *
   * Caveat for recordings made BEFORE 1.16.0 with the override off: they carry no
   * opt-in action at all, so faithful replay depends on the replaying consumer
   * passing `false` — which `RecorderApp`'s replay mode does (see
   * `replay-mode.ts`).
   *
   * @see GpsPlusSlamJs_Docs/docs/2026-06-26-0701-stage0-field-collection-and-enablement.md
   */
  enableCompassColdStartOverride?: boolean;

  /**
   * **Debug/experiment flag** — enable the library's Phase-4 **Stage-C**
   * trust-gated compass rotation prior (keeps a steady compass vote once GPS yaw
   * is observable + the compass is trusted; supersedes Stage 0). Dispatches
   * `setCompassRotationPriorEnabled(true)` once `gpsData` exists. Default `false`
   * ⇒ byte-identical. Like the Stage-0 flag, the action persists into recordings.
   */
  enableCompassRotationPrior?: boolean;

  /**
   * **Debug/experiment flag** — enable the library's GPS-free compass↔WebXR
   * consistency gate. When on, the compass override (Stage 0 / Stage C) abstains
   * unless the compass is rotating in lock-step with the WebXR pose. Dispatches
   * `setCompassWebXRConsistencyEnabled(true)` once `gpsData` exists. Default
   * `false` ⇒ byte-identical. The action persists into recordings.
   */
  enableCompassWebXRConsistency?: boolean;

  /**
   * **Field-test flag (2026-07-19 enablement plan)** — enable the library's
   * compass EXPERIMENT combo: Stage-C rotation prior + trust tolerance 15°
   * (the census-backed activating value) + C′ compass-guided pair selection.
   * Dispatches `setCompassExperimentEnabled(true)` once `gpsData` exists; the
   * combo itself lives in the library (single boolean crosses the boundary).
   * Default `false` ⇒ byte-identical. The action persists into recordings, so
   * replays/censuses can attribute. Keep OFF for §6a calibration recordings.
   *
   * @see GpsPlusSlamJs_Docs/docs/2026-07-19-0813-compass-experiment-recorder-enablement-plan.md
   */
  enableCompassExperiment?: boolean;

  /**
   * **Field-test flag** — enable the library's alternative robust-solver
   * comparison arm (NOT a compass mechanism — a generic outlier-tolerant
   * position fit, rejected as a default on the evaluation corpus but exposed
   * for on-device A/B against the compass experiment; adds run-to-run
   * variance by nature). Dispatches `setRobustSolverComparisonEnabled(true)`
   * once `gpsData` exists. Default `false` ⇒ byte-identical. The action
   * persists into recordings.
   */
  enableRobustSolverComparison?: boolean;

  /**
   * **Field-test knob** — steady-state compass vote weight ∈ [0,1] for the
   * rotation prior / compass experiment (the recorder's vote-weight slider,
   * 2026-07-19 weight-curve follow-up). Dispatches `setCompassVoteWeight(w)`
   * once `gpsData` exists. Absent ⇒ the library default; only consulted while
   * a rotation prior is active. The action persists into recordings.
   */
  compassVoteWeight?: number;
}

/**
 * Combined root state: the framework's base state plus any caller-supplied
 * extras. Generic so consumers get exact typing for the slices they add.
 */
export type SlamAppCombinedState<
  ExtraReducers extends ReducersMapObject = Record<never, never>,
> = SlamAppRootState & {
  [K in keyof ExtraReducers]: ExtraReducers[K] extends Reducer<infer S>
    ? S
    : never;
};

/**
 * The store object returned by {@link createSlamAppStore}.
 *
 * Wraps RTK's store and adds storage-delegation helpers so consumers can
 * issue frame / metadata writes without holding a separate handle to the
 * `StorageBackend`.
 */
export interface SlamAppStore<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
> {
  getState: () => SlamAppCombinedState<ExtraReducers>;
  dispatch: ReturnType<typeof configureStore>['dispatch'];
  subscribe: (listener: () => void) => () => void;
  /** Persist a captured camera frame via the configured backend. */
  writeFrame: (blob: Blob, index: number) => Promise<void>;
  /** Persist session metadata (`session.json`) via the configured backend. */
  writeSessionMetadata: (metadata: OpfsSessionMetadata) => Promise<void>;
  /**
   * Resolves once every action write queued by the persistence middleware
   * has settled. The stop flow MUST await this before anything reads the
   * session's `actions/` (final sync, ZIP export) — the write queue is
   * async, so an action dispatched moments before Stop could otherwise
   * land after the export enumerated the directory and miss the zip.
   */
  flushPendingActionWrites: () => Promise<void>;
}

/**
 * Build a Redux store wired with library + recording slices, persistence
 * middleware, and any caller-supplied extras. See module docstring for the
 * design rationale.
 */
export function createSlamAppStore<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
>(options: SlamAppStoreOptions<ExtraReducers>): SlamAppStore<ExtraReducers> {
  const {
    storageBackend,
    extraReducers,
    extraMiddleware,
    persistedExtraPrefixes,
    onWriteFailure,
    enableDevChecks = true,
    licenseKey = COMMUNITY_LICENSE_KEY,
    trackingQualityOptions,
    // Stage 0 (cold-start compass override) ships ON by default; Stage C and the
    // WebXR-consistency gate stay field-gated (default OFF).
    enableCompassColdStartOverride = true,
    enableCompassRotationPrior = false,
    enableCompassWebXRConsistency = false,
    // Field-test opt-ins (2026-07-19 enablement plan) — default OFF.
    enableCompassExperiment = false,
    enableRobustSolverComparison = false,
    compassVoteWeight,
  } = options;

  validateLicenseKey(licenseKey);

  // Boundary validation: `extraReducers` is spread AFTER the built-ins, so a
  // colliding key would silently REPLACE a framework reducer (e.g. a custom
  // `gpsData` corrupting GPS state with no diagnostic). Fail loudly instead,
  // naming every offending key (PR #17 review).
  const builtins = {
    gpsData: gpsDataReducer,
    gpsElements: gpsElementsReducer,
    arElements: arElementsReducer,
    recording: recordingReducer,
    tracking: trackingReducer,
    trackingQuality: trackingQualityReducer,
  };
  if (extraReducers) {
    const collisions = Object.keys(extraReducers).filter((key) =>
      Object.prototype.hasOwnProperty.call(builtins, key)
    );
    if (collisions.length > 0) {
      throw new Error(
        `extraReducers must not overwrite framework-reserved slice(s): ` +
          `${collisions.join(', ')}. Reserved keys: ${Object.keys(builtins).join(', ')}.`
      );
    }
  }

  const reducer = {
    ...builtins,
    ...(extraReducers ?? ({} as ExtraReducers)),
  };

  const trackingQualityMiddleware = createTrackingQualityListenerMiddleware(
    trackingQualityOptions
  );

  // Debug/experiment opt-ins for the compass alignment flags. They live on the
  // `gpsData` slice, which is `null` until the first `setZeroPos`, so a listener
  // middleware applies them once that slice exists. Each opt-in: a predicate
  // reading whether the flag is already set, and the action that sets it.
  //
  // Why a listener middleware (not a `store.subscribe` dispatch): the apply must
  // dispatch a follow-up action in reaction to `gpsData` appearing. A synchronous
  // `store.subscribe` dispatch runs INSIDE the trigger's `next()`, and the
  // persistence middleware assigns its replay index AFTER `next()` — so the opt-in
  // would get a LOWER index than the `setZeroPos` that created `gpsData`, be
  // recorded BEFORE its trigger, and be dropped on replay (field bug 2026-06-27,
  // recordings 64c6a294 / e7431b85). A prepended listener-middleware effect runs
  // after the trigger unwinds, so the opt-in is a top-level dispatch persisted
  // AFTER setZeroPos — correct replay order by construction, no `queueMicrotask`
  // / re-entrancy guard to hand-maintain. See `slam-app-store-listener.ts` and
  // GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md.
  // The five boolean opt-ins share one shape — an options flag, the gpsData
  // field that records it, and the library action that sets it — so they are
  // one table row each: adding a compass toggle means adding a row (plus its
  // option + doc above), not hand-rolling another push block. The vote weight
  // is NOT a row because it carries a NUMBER rather than a boolean, so it cannot
  // satisfy `BooleanCompassFlagField`; its `isSet` follows the same
  // "decided" (`!== undefined`) rule as the rows, and its action dispatches the
  // value. Anything added here does too — see `slam-app-store-listener.ts.md`
  // §Invariants for why a value-equality `isSet` is forbidden.
  const booleanOptInRows: ReadonlyArray<{
    enabled: boolean;
    flag: BooleanCompassFlagField;
    setFlag: (value: boolean) => UnknownAction;
    /**
     * Record the value even when it is `false`, instead of dispatching only on
     * `true`. **Required for any flag whose LIBRARY default is not `false`**, and
     * that is the whole rule: dispatching only on `true` leaves the flag
     * `undefined`, which the library reads as "use `DefaultAlignmentConfig`", so
     * "absent" only means "off" while the library agrees that it is off.
     */
    recordWhenFalse?: boolean;
  }> = [
    {
      enabled: enableCompassColdStartOverride,
      flag: 'coldStartOverrideEnabled',
      setFlag: setColdStartOverrideEnabled,
      // The library default is `true` since gps-plus-slam-js 1.16.0, so an
      // absent action would mean ON and an explicit opt-OUT would be a silent
      // no-op — which is exactly what happened, so a capture the operator had
      // switched the override OFF for ran WITH it, and replay of such a session
      // could not correct that either.
      recordWhenFalse: true,
    },
    {
      enabled: enableCompassRotationPrior,
      flag: 'compassRotationPriorEnabled',
      setFlag: setCompassRotationPriorEnabled,
    },
    {
      enabled: enableCompassWebXRConsistency,
      flag: 'compassWebXRConsistencyEnabled',
      setFlag: setCompassWebXRConsistencyEnabled,
    },
    {
      enabled: enableCompassExperiment,
      flag: 'compassExperimentEnabled',
      setFlag: setCompassExperimentEnabled,
    },
    {
      enabled: enableRobustSolverComparison,
      flag: 'robustSolverComparisonEnabled',
      setFlag: setRobustSolverComparisonEnabled,
    },
  ];
  // A row is dispatched when it is enabled OR when it must be recorded even at
  // `false` — and it then dispatches its ACTUAL value, not a hardcoded `true`.
  //
  // Until 2026-07-26 this was `.filter((row) => row.enabled)`, so an explicit
  // opt-OUT dispatched nothing and left the `gpsData` flag `undefined`. The library
  // reads `undefined` as "use `DefaultAlignmentConfig`", which made "absent" and
  // "false" equivalent only while the library default was also `false`. When
  // gps-plus-slam-js 1.16.0 flipped `useCompassColdStartOverride` to `true`,
  // `enableCompassColdStartOverride: false` silently began meaning **ON**, in TWO
  // places, and the live one is the worse of the two:
  //  - **Recording (worse).** A calibration capture, whose whole point is to record
  //    unmodified compass behaviour, would have run WITH the override active while
  //    the operator had switched it off — and the recording carries no action
  //    saying so either way. That is corrupt data, not a misreading of good data.
  //  - **Replay.** `replay-mode.ts` passes the same `false` to stop a session
  //    captured without the override from replaying with one; that stopped working,
  //    so a correct recording was replayed wrongly.
  // `recordWhenFalse` fixes both, since the live store dispatches the `false` too.
  // The tests missed it because the assertion was `toBeFalsy()`, which `undefined`
  // satisfies.
  //
  // Why only the cold-start row carries `recordWhenFalse` rather than all five:
  // recording every flag unconditionally would add four no-op actions to EVERY
  // recording (measured: a minimal session went from 1 opt-in action to 5) to fix
  // one flag. The other four are debug/experiment flags whose library default is
  // `false`, so for them "absent ⇒ off" is a stable contract. The rule to apply
  // when that changes is written on the `recordWhenFalse` field above: any flag
  // whose library default stops being `false` needs it.
  // `isSet` asks "has this flag been DECIDED yet?", not "does it equal my
  // option?", and the distinction is the whole replay contract.
  //
  // The listener's predicate is edge-triggered on the `gpsData` OBJECT REFERENCE,
  // and every library reducer mutation produces a fresh one. So an `isSet` of the
  // form `flag === enabled` turns the listener into a value ENFORCER: a replayed
  // `setColdStartOverrideEnabled(true)` re-arms the predicate, the effect sees
  // `true !== false`, and it dispatches `false` straight over the recorded value.
  // A session recorded WITH the override would then replay WITHOUT one — the same
  // defect this whole change exists to fix, merely inverted.
  //
  // `!== undefined` gives the right semantics in one line: the framework supplies
  // the INITIAL value, and anything the action stream (or any later explicit
  // dispatch) decides wins. It also preserves the 2026-06-27 field-bug fix, since
  // a recreated `gpsData` has the flag back at `undefined` and so gets re-applied.
  const isDecided =
    (flag: BooleanCompassFlagField) =>
    (s: LibraryRootState): boolean =>
      s.gpsData?.[flag] !== undefined;
  const compassOptIns: CompassOptIn[] = booleanOptInRows
    .filter((row) => row.enabled || row.recordWhenFalse)
    .map(({ enabled, flag, setFlag }) => ({
      isSet: isDecided(flag),
      apply: (dispatch) => dispatch(setFlag(enabled)),
    }));
  if (compassVoteWeight !== undefined) {
    compassOptIns.push({
      // "decided", not `=== compassVoteWeight`, for the same reason as the rows
      // above. Not an active bug today — `replay-mode.ts` never passes this
      // option, so the opt-in is not registered on a replay store — but a session
      // recorded with the rotation prior active DOES carry `setCompassVoteWeight`
      // in its stream, so the old shape's safety rested entirely on replay never
      // opting in. Making it uniform removes the contingency instead of
      // documenting it.
      isSet: (s) => s.gpsData?.compassVoteWeight !== undefined,
      apply: (dispatch) => dispatch(setCompassVoteWeight(compassVoteWeight)),
    });
  }

  // Listener middlewares are prepended (outermost) so their effects dispatch
  // OUTSIDE the trigger's `next()`. The guard below used to make the compass
  // listener conditional, so a consumer requesting no opt-in paid zero per-action
  // overhead; since `recordWhenFalse` the cold-start row is always present, so
  // `compassOptIns` is never empty and the guard is always true. Kept because it
  // is still the correct precondition (a `createSlamAppStoreListenerMiddleware([])`
  // would run a predicate per action to decide nothing), not because it can fire.
  const prependedListeners: SlamAppMiddleware[] = [trackingQualityMiddleware];
  if (compassOptIns.length > 0) {
    prependedListeners.push(
      createSlamAppStoreListenerMiddleware(compassOptIns)
    );
  }

  // Created outside configureStore so its `flushPendingWrites` drain hook
  // can be exposed on the returned store (the stop flow awaits it before
  // reading `actions/`).
  const persistenceMiddleware = createPersistenceMiddleware({
    storageBackend,
    onWriteFailure,
    persistedPrefixes: [
      ...BUILTIN_PERSISTED_PREFIXES,
      ...(persistedExtraPrefixes ?? []),
    ],
  });

  const store = configureStore({
    reducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // E-7 (2026-07-10 quality review): both dev checks deep-walk on every
        // dispatch, and `tracking/poseReceived` dispatches at 60–90 Hz — so
        // the per-frame action (serializable) and the per-frame slice
        // (immutable) are excluded specifically. Everything else stays fully
        // checked in dev builds; RTK strips both checks from production
        // builds entirely, so this is a dev-experience fix, not a prod one.
        serializableCheck: enableDevChecks
          ? { ignoredActions: ['tracking/poseReceived'] }
          : false,
        immutableCheck: enableDevChecks
          ? { ignoredPaths: ['tracking'] }
          : false,
      })
        .prepend(...prependedListeners)
        .concat(persistenceMiddleware, ...(extraMiddleware ?? [])),
    devTools: {
      actionSanitizer: sanitizeForDevTools,
      stateSanitizer: sanitizeForDevTools,
    },
  });

  return {
    getState: () => store.getState() as SlamAppCombinedState<ExtraReducers>,
    dispatch: store.dispatch,
    subscribe: (listener: () => void) => store.subscribe(listener),
    writeFrame: (blob: Blob, index: number) =>
      storageBackend.writeFrame(blob, index),
    writeSessionMetadata: (metadata: OpfsSessionMetadata) =>
      storageBackend.writeSessionMetadata(metadata),
    flushPendingActionWrites: () => persistenceMiddleware.flushPendingWrites(),
  };
}
