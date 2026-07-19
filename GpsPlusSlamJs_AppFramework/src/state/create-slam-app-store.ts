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
  setRansacComparisonEnabled,
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
   * When enabled the factory dispatches `setColdStartOverrideEnabled(true)` the
   * first time `gpsData` becomes non-null (right after the first `setZeroPos`,
   * since the flag lives on that slice and cannot be set before it exists).
   *
   * Replay/determinism: the library's `DefaultAlignmentConfig` stays OFF, so
   * historical recordings replay unchanged; default-on lives here as a recorded
   * `gpsData` action. A recording made with this on therefore replays with the
   * override on. **For Stage-A/§6a field-calibration recordings, turn this OFF**
   * (recorder settings) so the captured compass behaviour is unmodified.
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
   * **Field-test flag** — enable the library's plain-RANSAC comparison arm
   * (`useRansac`; NOT a compass mechanism — position-residual RANSAC,
   * corpus-rejected as a default, exposed for on-device A/B against the
   * compass experiment; adds seed-dependent run-to-run variance by nature).
   * Dispatches `setRansacComparisonEnabled(true)` once `gpsData` exists.
   * Default `false` ⇒ byte-identical. The action persists into recordings.
   */
  enableRansacComparison?: boolean;
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
    enableRansacComparison = false,
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
  const compassOptIns: CompassOptIn[] = [];
  if (enableCompassColdStartOverride) {
    compassOptIns.push({
      isSet: (s) => s.gpsData?.coldStartOverrideEnabled === true,
      apply: (dispatch) => dispatch(setColdStartOverrideEnabled(true)),
    });
  }
  if (enableCompassRotationPrior) {
    compassOptIns.push({
      isSet: (s) => s.gpsData?.compassRotationPriorEnabled === true,
      apply: (dispatch) => dispatch(setCompassRotationPriorEnabled(true)),
    });
  }
  if (enableCompassWebXRConsistency) {
    compassOptIns.push({
      isSet: (s) => s.gpsData?.compassWebXRConsistencyEnabled === true,
      apply: (dispatch) => dispatch(setCompassWebXRConsistencyEnabled(true)),
    });
  }
  if (enableCompassExperiment) {
    compassOptIns.push({
      isSet: (s) => s.gpsData?.compassExperimentEnabled === true,
      apply: (dispatch) => dispatch(setCompassExperimentEnabled(true)),
    });
  }
  if (enableRansacComparison) {
    compassOptIns.push({
      isSet: (s) => s.gpsData?.ransacComparisonEnabled === true,
      apply: (dispatch) => dispatch(setRansacComparisonEnabled(true)),
    });
  }

  // Listener middlewares are prepended (outermost) so their effects dispatch
  // OUTSIDE the trigger's `next()` — the compass listener is only added when an
  // opt-in is requested, so the common path keeps zero per-action overhead.
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
