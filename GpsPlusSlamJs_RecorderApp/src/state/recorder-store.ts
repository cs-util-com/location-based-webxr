/**
 * Recorder Store — composable store for the recorder app.
 *
 * Wraps the framework's `createSlamAppStore` factory and supplies the
 * recorder-specific slices (refPoints, routing, scenario) plus the
 * framework `qrDetected` slice, and narrows the state type to
 * `CombinedRootState` for recorder consumers. The framework does not
 * ship a `createRecorderStore`; that wrapper lives here in the app.
 *
 * Historical note: during Iter 1–3 of the
 * [AppFramework / RecorderApp boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)
 * this module also re-exported the framework/state surface so consumers
 * only needed a path swap. That re-export layer is gone — consumers now
 * import each symbol from its true source (e.g. recording actions from
 * `gps-plus-slam-app-framework/state/recording-slice`, GPS/QR actions and
 * raw sensor types from `gps-plus-slam-app-framework/state`, scenario
 * actions from `./scenario-slice`).
 *
 * NOTE: The recorder app takes no direct dependency on `gps-plus-slam-js`;
 * core-library symbols are consumed via the framework's curated re-export
 * surface — see
 * [2026-05-05-recorder-app-drop-direct-core-dep-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-05-recorder-app-drop-direct-core-dep-plan.md).
 * Raw sensor types (`RawDeviceOrientation` & friends) must come from the
 * `gps-plus-slam-app-framework/state` subpath, not the framework root
 * barrel — the root barrel exposes a structurally different (nullable)
 * sensor variant from `sensors/gps.ts`. See §2.2.1 of that plan and
 * `recorder-store-types.test.ts`.
 */

import { type LibraryRootState } from 'gps-plus-slam-app-framework/core';
import {
  createSlamAppStore,
  type SlamAppStore,
} from 'gps-plus-slam-app-framework/state/create-slam-app-store';
import {
  slicePrefixOf,
  qrDetectedReducer,
  recordQrDetection,
  setQrMaxHistory,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state';
import {
  addRefPointEntry,
  refPointsReducer,
  type RefPointsState,
} from './ref-points-slice';
import type { RecordingState } from 'gps-plus-slam-app-framework/state/recording-slice';
import type { TrackingSliceState } from 'gps-plus-slam-app-framework/state/tracking-slice';
import type { TrackingQualitySliceState } from 'gps-plus-slam-app-framework';
import type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
import { ScenarioWrappingStorageBackend } from '../storage/scenario-storage';
import type { SessionMetadata as OpfsSessionMetadata } from 'gps-plus-slam-app-framework/storage/opfs-storage';
import { routingReducer, type RoutingState } from './routing-slice';
import { scenarioReducer, type ScenarioState } from './scenario-slice';

// --- Recorder-owned types ---

/**
 * Combined root state: library state + recorder slices (recording, refPoints,
 * routing, scenario). Composed by `createRecorderStore`.
 */
export interface CombinedRootState extends LibraryRootState {
  recording: RecordingState;
  tracking: TrackingSliceState;
  trackingQuality: TrackingQualitySliceState;
  refPoints: RefPointsState;
  routing: RoutingState;
  scenario: ScenarioState;
  qrDetected: QrDetectedState;
}

/**
 * Per-marker live-history cap the recorder opts into (D-B refinement): a longer
 * debug trail than the framework default (32) WITHOUT moving that shared default
 * for one consumer. The action LOG still captures every detection regardless of
 * the cap; this only bounds the live reduced state the debug viz reads.
 */
export const RECORDER_QR_MAX_HISTORY = 100;

/**
 * Recorder store handle. Same shape as before the Iter 1 split — the
 * framework's `SlamAppStore` already provides this surface; we just narrow
 * the state type to `CombinedRootState` for recorder consumers.
 */
export interface RecorderStore {
  getState: () => CombinedRootState;
  dispatch: SlamAppStore['dispatch'];
  subscribe: (listener: () => void) => () => void;
  writeFrame: (blob: Blob, index: number) => Promise<void>;
  writeSessionMetadata: (metadata: OpfsSessionMetadata) => Promise<void>;
  /**
   * Drains the persistence middleware's async WriteQueue. The stop flow
   * awaits this before anything reads the session's `actions/` (final
   * sync, ZIP export) — see recording-session-handlers `performStop`.
   */
  flushPendingActionWrites: () => Promise<void>;
}

export interface RecorderStoreOptions {
  /** Show toast / surface errors on persistence failures. */
  onWriteFailure?: (error: Error) => void;
  /** Override default OPFS backend (tests / replay → NullStorageBackend). */
  storageBackend?: StorageBackend;
  /** Disable RTK dev-only middleware in high-throughput replay scenarios. */
  enableDevChecks?: boolean;
  /** Override the bundled community license key. */
  licenseKey?: string;
  /**
   * Compass alignment opt-ins (Phase-4). Each is forwarded to `createSlamAppStore`,
   * which enables it on the `gpsData` slice once that slice exists (after the
   * first `setZeroPos`). Sourced from `RecordingOptions.compassDebug` so the
   * operator toggles them in the recorder settings. Defaults follow the framework:
   * **Stage 0 (`enableCompassColdStartOverride`) defaults ON** (field-validated),
   * Stage C + the consistency gate default OFF (field-gated). NB: the resulting
   * `gpsData` actions persist into the recording (replay re-enables them) — turn
   * Stage 0 OFF for §6a calibration captures so the compass behaviour is unmodified.
   */
  enableCompassColdStartOverride?: boolean;
  enableCompassRotationPrior?: boolean;
  enableCompassWebXRConsistency?: boolean;
  /**
   * 2026-07-19 field-test opt-ins (enablement plan): the compass experiment
   * combo (rotation prior + trust tolerance 15° + C′ pair selection) and the
   * alternative robust-solver comparison arm. Sourced from
   * `RecordingOptions.compassDebug.{experiment,robustSolverComparison}`; default OFF.
   */
  enableCompassExperiment?: boolean;
  enableRobustSolverComparison?: boolean;
}

/**
 * Construct the recorder store. Delegates to the framework factory and
 * supplies recorder-only slices via `extraReducers`.
 */
export function createRecorderStore(
  options: RecorderStoreOptions = {}
): RecorderStore {
  const storageBackend: StorageBackend =
    options.storageBackend ?? new ScenarioWrappingStorageBackend();

  const store = createSlamAppStore({
    storageBackend,
    onWriteFailure: options.onWriteFailure,
    enableDevChecks: options.enableDevChecks,
    licenseKey: options.licenseKey,
    enableCompassColdStartOverride: options.enableCompassColdStartOverride,
    enableCompassRotationPrior: options.enableCompassRotationPrior,
    enableCompassWebXRConsistency: options.enableCompassWebXRConsistency,
    enableCompassExperiment: options.enableCompassExperiment,
    enableRobustSolverComparison: options.enableRobustSolverComparison,
    // Persist the recorder-owned refPoints slice and the framework qrDetected
    // slice. Derived from each slice's own action type (never a literal) so a
    // rename can't silently drop data from recordings — see the 2026-05-28
    // refPointsV2/ regression. `slicePrefixOf(recordQrDetection.type)` is
    // `qrDetected`, so every `qrDetected/*` action is whitelisted (matching the
    // refPoints pattern); only `recordQrDetection` is dispatched during recording.
    persistedExtraPrefixes: [
      slicePrefixOf(addRefPointEntry.type),
      slicePrefixOf(recordQrDetection.type),
    ],
    extraReducers: {
      refPoints: refPointsReducer,
      routing: routingReducer,
      scenario: scenarioReducer,
      qrDetected: qrDetectedReducer,
    },
  });

  // Opt into a longer live QR history than the shared framework default (D-B).
  // Dispatched at setup, BEFORE any recording starts, so it is never persisted;
  // the replay store (also built here) gets the same cap so live == replay.
  store.dispatch(setQrMaxHistory(RECORDER_QR_MAX_HISTORY));

  return {
    getState: () => store.getState(),
    dispatch: store.dispatch,
    subscribe: store.subscribe,
    writeFrame: store.writeFrame,
    writeSessionMetadata: store.writeSessionMetadata,
    flushPendingActionWrites: store.flushPendingActionWrites,
  };
}

export type RootState = CombinedRootState;
export type AppDispatch = RecorderStore['dispatch'];
