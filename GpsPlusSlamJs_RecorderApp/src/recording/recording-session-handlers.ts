/**
 * Recording Session Handlers
 *
 * Encapsulates all recording-session lifecycle state and event handlers,
 * extracted from main.ts (Finding #7 — main.ts decomposition, Step 3).
 *
 * The factory pattern allows main.ts to inject dependencies that change
 * over the app lifecycle (store, scenario name, recording options, etc.).
 *
 * All other dependencies (sensors, storage, UI) are imported directly —
 * the same modules they were imported from in main.ts.
 */

import {
  resetCoordinatorState,
  createGpsPositionHandler,
  updateDeviceOrientation,
} from 'gps-plus-slam-app-framework/state/gps-event-coordinator';
import { startSession } from 'gps-plus-slam-app-framework/state/recording-slice';
import type { RecorderStore } from '../state/recorder-store';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import type { RecordingOptions } from '../state/recording-options';
import { formatTimestamp } from 'gps-plus-slam-app-framework/storage/file-system-utils';
import {
  startSession as startStorageSession,
  getCurrentScenarioHandle,
} from '../storage/scenario-storage';
import { getSaveFileHandle } from '../storage/external-file-storage';
import { createSyncManager } from '../storage/sync-manager';
import { syncScenarioSessionToExternalZip } from '../storage/scenario-zip-export';
import {
  startGpsWatch,
  startOrientationWatch,
} from 'gps-plus-slam-app-framework/sensors/gps';
import {
  startAbsoluteOrientationWatch,
  getLatestAbsoluteOrientation,
} from 'gps-plus-slam-app-framework/sensors/absolute-orientation';
import { createGpsErrorHandler } from 'gps-plus-slam-app-framework/sensors/gps-error-handler';
import {
  getCurrentArPose,
  startImageCapture,
  startDepthCapture,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import {
  createImageQualityAnalyzer,
  type ImageQualityClient,
} from './image-quality-client';
import { createWriteFailureTracker } from '../storage/write-failure-tracker';
import { createCaptureFailureTracker } from 'gps-plus-slam-app-framework/ar/capture-failure-tracker';
import {
  showRecordingControls,
  setStopButtonBusy,
  showError,
  updateStatus,
  updateSyncStatus,
  setAbsCompassStatus,
} from '../ui/hud';
import type { QrSightingFeeder } from '../qr/qr-sighting-feeder';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { enableBeforeUnloadWarning, pushScreenState } from '../ui/navigation';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { FALLBACK_SCENARIO, type SessionRuntime } from './session-runtime';
import { buildZipContributors } from './zip-contributors';
import {
  performStop,
  stopAbsCompassHudUpdates,
  stopLiveFeeds,
} from './stop-recording';
import type { LatLong, Matrix4 } from 'gps-plus-slam-app-framework/core';
import { magneticHeadingFromEnuQuat } from 'gps-plus-slam-app-framework/core';
import type { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';

const log = createLogger('RecordingSession');

/** AbsCompass HUD refresh cadence. 5 Hz — readable, no DOM thrash. Immutable
 *  config, so it is module-level; the timer *handle* it drives is per-instance
 *  state owned by the factory closure (see `createRecordingSessionHandlers`). */
const ABS_COMPASS_HUD_INTERVAL_MS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordingSessionDeps {
  /** Access the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** Replace the module-level store in main.ts. */
  setStore: (store: RecorderStore) => void;
  /**
   * Re-point the WebXR session at the new store so live AR frames keep
   * dispatching `poseReceived` into the store that drives the current
   * recording. Without this, the new store's `tracking.phase` stays at
   * `'initializing'` and the tracking-quality phase gate keeps the HUD
   * pinned to "AR LOST" for the entire recording (Finding #1,
   * 2026-05-23 user feedback). Main injects the framework's
   * `rebindTrackingStore` — the one runtime mutation that survived the
   * fold of the pre-init setters into initAR's callbacks struct.
   */
  rebindTrackingStore: (store: RecorderStore) => void;
  /**
   * Swap the off-thread image-quality analyzer for the CURRENT recording
   * (or clear it with `null`). Recordings start/stop within one AR session,
   * so the per-recording Worker cannot be an initAR-time constant — main.ts
   * passes initAR a stable wrapper delegating to the ref this setter writes.
   */
  setImageQualityAnalyzer: (
    analyzer: ImageQualityClient['analyze'] | null
  ) => void;
  /** Create a fresh store instance. */
  createNewStore: () => RecorderStore;
  /** Read the current recording options (owned by main.ts). */
  getRecordingOptions: () => RecordingOptions;
  /** Access the map overlay (may be null if AR not started). */
  getMapOverlay: () => LeafletMapOverlay | null;
  /** The session QR sighting fold, or null when QR recording is off. */
  getQrSightingFeeder: () => QrSightingFeeder | null;
  /** Read session notes from UI. */
  getSessionNotes: () => string;
  /** Wait for GPS zero reference (polling store, owned by main.ts). */
  waitForZeroReference: (timeoutMs?: number) => Promise<LatLong | null>;
  /** Load and display prior ref points from a scenario. */
  loadAndDisplayRefPoints: (
    handle: FileSystemDirectoryHandle
  ) => Promise<{ refPointCount: number; observationCount: number }>;
  /** Collect error messages from a failure tracker and reset it. */
  collectTrackerErrors: (
    tracker: { getFailureCount(): number; reset(): void } | null,
    label: string,
    errors: string[]
  ) => void;
  /** Apply alignment matrix to AR scene (passed to store subscribers). */
  applyAlignmentMatrix: (matrix: Matrix4) => void;
  /** Optional callback for each new GPS lat/lng (proximity detection). */
  onNewGpsLatLng?: (lat: number, lng: number) => void;
}

export interface RecordingSessionHandlers {
  /** Start a new recording session. */
  handleStartRecording(): Promise<void>;
  /** Stop the current recording session. */
  handleStopRecording(): Promise<void>;
  /** Handle back-button press during recording (confirmation dialog). */
  handleBackDuringRecording(): Promise<void>;

  /** Get the current session name. */
  getCurrentSessionName(): string;
  /** Set the current session name. */
  setCurrentSessionName(name: string): void;

  /** Record a successful image write (null-safe proxy to internal tracker). */
  recordWriteSuccess(): void;
  /** Record a failed image write (null-safe proxy to internal tracker). */
  recordWriteFailure(err: unknown): void;
  /** Record a successful image capture (null-safe proxy to internal tracker). */
  recordCaptureSuccess(): void;
  /** Record a failed image capture (null-safe proxy to internal tracker). */
  recordCaptureFailure(): void;

  /** Clean up recording-session state for soft reset (new recording). */
  cleanupForNewRecording(): void;
  /** Full reset of all state. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Per-recording state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRecordingSessionHandlers(
  deps: RecordingSessionDeps
): RecordingSessionHandlers {
  // --- State ---
  /**
   * Everything ONE recording owns. See {@link SessionRuntime}.
   *
   * Per-instance rather than module-level, so independent handler instances
   * never share or overwrite each other's resources — the factory's "no
   * module-level mutable state" invariant (see sidecar).
   */
  const runtime: SessionRuntime = {
    writeFailureTracker: null,
    captureFailureTracker: null,
    currentSessionName: '',
    syncManager: null,
    latestQrAnchorOutcomes: [],
    lastSyncResult: null,
    unsubscribeStore: null,
    imageQualityClient: null,
    absCompassHudTimer: null,
  };

  /**
   * RE-ENTRANCY GUARDS, deliberately NOT in {@link SessionRuntime}.
   *
   * They guard a HANDLER against being entered twice, not a resource the
   * recording owns — `stopInProgress` is false again before `handleStopRecording`
   * returns, while everything in `runtime` outlives the call that created it.
   * A guard also has to stay where its handler is: travelling with an extracted
   * stop flow is precisely what it must not do, or a second entry would find a
   * fresh copy and proceed.
   */
  let backDuringRecordingInProgress = false;
  let stopInProgress = false;

  // --- Internal helpers ---

  function startAbsCompassHudUpdates(): void {
    stopAbsCompassHudUpdates(runtime);
    runtime.absCompassHudTimer = setInterval(() => {
      const reading = getLatestAbsoluteOrientation();
      if (!reading) return; // unavailable / not warmed up → leave onStatus text
      setAbsCompassStatus({
        state: 'active',
        headingDeg: magneticHeadingFromEnuQuat(reading.quaternion),
      });
    }, ABS_COMPASS_HUD_INTERVAL_MS);
  }

  /**
   * Load and visualize reference points from prior sessions in the current scenario.
   */
  async function loadPriorReferencePoints(): Promise<void> {
    const scenarioHandle = getCurrentScenarioHandle();
    if (!scenarioHandle) {
      log.warn('No scenario handle - skipping prior ref points');
      return;
    }

    try {
      // A3 (2026-07-06 round-4): load + dispatch BEFORE the zeroRef wait.
      // The entries live in local OPFS and the 2D map needs only lat/lon from
      // the store; only the 3D sphere placement needs GPS (the visualizer
      // stays zeroRef-gated internally). Ordering the load after the wait
      // starved the live map for up to 30 s — or entirely on timeout.
      const { refPointCount, observationCount } =
        await deps.loadAndDisplayRefPoints(scenarioHandle);
      const loadedSummary = `${refPointCount} ref points (${observationCount} observations) loaded`;

      updateStatus('Waiting for GPS signal...');

      const zeroRef = await deps.waitForZeroReference(30000);

      if (!zeroRef) {
        log.warn('No zero reference after 30s - cannot display ref points');
        showError(
          'No GPS signal received. Move outdoors for better reception.'
        );
        // The status must reflect BOTH durable facts: GPS is missing (3D/AR
        // placement is degraded) AND the local load succeeded (the map shows
        // the points) — round-4 interview decision 6.
        updateStatus(
          `Recording: ${runtime.currentSessionName} | GPS unavailable | ${loadedSummary}`
        );
        return;
      }

      refPointVisualizer.setZeroRef(zeroRef);

      updateStatus(
        `Recording: ${runtime.currentSessionName} | ${loadedSummary}`
      );
    } catch (err) {
      log.error('Failed to load prior reference points:', err);
    }
  }

  // --- Handlers ---

  async function handleStartRecording(): Promise<void> {
    log.info('Start recording');

    resetCoordinatorState();
    gpsEventVisualizer.clearAll();
    // clearAll() resets the shared visualizer to its pristine VISIBLE state (so a
    // prior live opt-out can't leak into replay). This clearAll runs AFTER
    // Enter-AR already applied the operator's `visualization.gpsAlignmentMarkers`
    // opt-out via setVisible(), so without re-asserting it here the markers spawned
    // by the live store-subscriber during recording reappear despite the toggle
    // being off (regression 2026-06-18). Re-apply the current option now.
    gpsEventVisualizer.setVisible(
      deps.getRecordingOptions().visualization.gpsAlignmentMarkers
    );

    // Cleanup previous store subscription if any
    if (runtime.unsubscribeStore) {
      runtime.unsubscribeStore();
      runtime.unsubscribeStore = null;
    }

    // Read scenario name from the CURRENT store BEFORE creating a new one.
    // The dropdown dispatches setCurrentScenarioName on the current store;
    // a fresh store would lose this selection (Issue #12).
    const scenarioName =
      deps.getStore().getState().scenario.currentScenarioName ||
      FALLBACK_SCENARIO;

    // Create new store for this session
    const store = deps.createNewStore();
    deps.setStore(store);
    // Finding #1 (2026-05-23 user feedback): the WebXR session captured a
    // reference to the PREVIOUS store at app boot. If we do not re-point it
    // now, every `poseReceived` dispatch flows into the orphaned store and
    // the new store's `tracking.phase` never leaves `'initializing'`, which
    // pins the tracking-quality HUD to "AR LOST" for the whole recording.
    deps.rebindTrackingStore(store);

    // Generate session name from timestamp
    const now = new Date();
    runtime.currentSessionName = `recording-${formatTimestamp(now)}`;

    // Initialize storage session BEFORE subscribing to store updates
    try {
      await startStorageSession(scenarioName);
    } catch (err) {
      log.error('Failed to start storage session:', err);
      showError('Failed to create session folder. Check folder permissions.');
      return;
    }

    // Subscribe to state updates AFTER storage is successfully initialized.
    // Use a late-binding proxy so the map overlay created lazily (on button
    // click) is picked up by the subscriber — same pattern as replay mode.
    const mapOverlayProxy = {
      setGpsPosition(lat: number, lon: number): void {
        deps.getMapOverlay()?.setGpsPosition(lat, lon);
      },
      render(data: MapData): void {
        deps.getMapOverlay()?.render(data);
      },
    };
    runtime.unsubscribeStore = wireStoreSubscribers(store, {
      applyAlignmentMatrix: deps.applyAlignmentMatrix,
      gpsEventVisualizer,
      mapOverlay: mapOverlayProxy,
      onNewGpsLatLng: deps.onNewGpsLatLng,
    });
    // NOTE: the ref-point VIEW subscribers (3D spheres + live-map markers)
    // are no longer wired here. They are AR-scoped and follow store swaps
    // via main's storeRef (ui/ref-point-view-wiring.ts, round-3 feedback
    // 2026-07-05) — the setStore(store) call above triggers their re-wire.

    // Initialize failure trackers
    runtime.writeFailureTracker = createWriteFailureTracker({
      onWarning: showError,
    });
    runtime.captureFailureTracker = createCaptureFailureTracker({
      onWarning: showError,
    });

    // Read session notes from UI
    const notes = deps.getSessionNotes();
    const recordingOptions = deps.getRecordingOptions();

    // Dispatch session start
    store.dispatch(
      startSession({
        // The recorder's scenario name rides along in the framework's opaque
        // `contextTag` slot (renamed from `scenarioName` on 2026-06-21).
        contextTag: scenarioName,
        sessionName: runtime.currentSessionName,
        startTime: now.getTime(),
        deviceInfo: navigator.userAgent,
        ...(notes && { notes }),
        recordingOptions,
      })
    );

    // Load and visualize prior reference points from this scenario
    loadPriorReferencePoints().catch((err) => {
      log.error('Unhandled error loading prior ref points:', err);
    });

    // Start GPS watch with position handler
    const gpsHandler = createGpsPositionHandler({
      store,
      getArPose: getCurrentArPose,
    });
    const gpsErrorHandler = createGpsErrorHandler(showError);
    startGpsWatch(gpsHandler, gpsErrorHandler);

    // Start orientation watch
    startOrientationWatch(updateDeviceOrientation);

    // Start the AbsoluteOrientationSensor capture (Phase 1 — independent north
    // reference). Passive instrumentation: on-when-available, clean no-op off
    // Chrome Android. The HUD row shows the live magnetic heading so a field
    // tester can confirm capture is live and cross-check it against the v3 demo.
    void startAbsoluteOrientationWatch(setAbsCompassStatus);
    startAbsCompassHudUpdates();

    // Start periodic image/depth capture (if enabled). Forward the *whole*
    // validated options section (minus the recorder-only `enabled` gate) as a
    // single config object, so a newly-added tunable reaches the sampler
    // without editing this seam. Re-listing fields here is the field-drop
    // hazard that left `resolutionDivisor` bolted on and the depth knobs dead
    // (see 2026-06-12-1130-payload-rebuild-field-drop-audit.md F3).
    if (recordingOptions.images.enabled) {
      const { enabled: _imagesEnabled, ...imageConfig } =
        recordingOptions.images;
      // Off-thread blur/blackness gate (opt-in). Spawn the worker-backed
      // analyzer ONLY when enabled — a disabled session never creates a worker —
      // and inject it BEFORE startImageCapture (the manager reads the analyzer
      // when constructed). Always (re)set the analyzer so a previous recording's
      // worker can't leak into this one.
      if (imageConfig.qualityFilter.enabled) {
        try {
          // A client can still be live here only when a start races/skips the
          // stop (performStop disposes on the normal flow) — dispose it so the
          // previous recording's Worker can't leak, matching this block's
          // stated contract.
          runtime.imageQualityClient?.dispose();
          runtime.imageQualityClient = createImageQualityAnalyzer(
            imageConfig.qualityFilter
          );
          deps.setImageQualityAnalyzer(runtime.imageQualityClient.analyze);
          log.info('Image-quality gate enabled (off-thread blur/blackness)');
        } catch (err) {
          // The worker is constructed synchronously; on a locked-down
          // deployment (e.g. CSP `worker-src`) `new Worker` can throw. The gate
          // is optional and fail-open everywhere, so disable it and keep
          // recording rather than aborting a session whose GPS/orientation
          // watches are already running.
          runtime.imageQualityClient = null;
          deps.setImageQualityAnalyzer(null);
          log.warn(
            'Image-quality gate unavailable (worker init failed) — recording without it',
            err
          );
        }
      } else {
        deps.setImageQualityAnalyzer(null);
      }
      startImageCapture(imageConfig);
      log.info(
        `Image capture started (interval: ${imageConfig.intervalMs}ms, quality: ${imageConfig.quality}, resolutionDivisor: ${imageConfig.resolutionDivisor})`
      );
    } else {
      log.info('Image capture disabled by user settings');
    }

    if (recordingOptions.depth.enabled) {
      const { enabled: _depthEnabled, ...depthConfig } = recordingOptions.depth;
      startDepthCapture(depthConfig);
      log.info(
        `Depth sampling started (interval: ${depthConfig.intervalMs}ms, grid: ${depthConfig.gridSize}×${depthConfig.gridSize})`
      );
    } else {
      log.info('Depth sampling disabled by user settings');
    }

    // Start external ZIP sync if user has chosen a save location
    const saveFileHandle = getSaveFileHandle();
    if (saveFileHandle) {
      runtime.syncManager = createSyncManager(
        async () => {
          runtime.lastSyncResult = await syncScenarioSessionToExternalZip(
            saveFileHandle,
            scenarioName,
            runtime.currentSessionName,
            {
              contributors: buildZipContributors(runtime, deps),
            }
          );
        },
        {
          onStatusChange: (status) => {
            log.debug('Sync status changed:', status);
            updateSyncStatus(status);
          },
        }
      );
      runtime.syncManager.start();
      log.info('External ZIP sync started');
    } else {
      log.debug('No external save location - OPFS-only storage');
    }

    // Warn on accidental tab close during recording
    enableBeforeUnloadWarning();

    // Push recording screen state for back-button navigation
    pushScreenState('recording');

    // Update UI to RECORDING state
    showRecordingControls();
    updateStatus(`Recording: ${runtime.currentSessionName}`);
  }

  /**
   * Re-entrancy-guarded entry point for stopping a recording.
   *
   * The teardown awaits a final external sync that can take many seconds for
   * large sessions. Without a guard, a second Stop tap during that window ran
   * the whole teardown concurrently and stopped + nulled the shared
   * `runtime.syncManager` out from under the first call, which then threw
   * "Cannot read properties of null (reading 'stop')" (Sentry issue
   * 7319627943). The guard makes the second tap a no-op; `setStopButtonBusy`
   * additionally disables the button so the double-tap cannot be issued.
   */
  async function handleStopRecording(): Promise<void> {
    if (stopInProgress) {
      log.info(
        'Stop recording already in progress, ignoring duplicate request'
      );
      return;
    }
    stopInProgress = true;
    setStopButtonBusy(true);
    try {
      await performStop(runtime, deps);
    } catch (err) {
      // performStop guards its slow I/O (metadata write, final sync, ZIP export)
      // individually, but its tail (end-session dispatch, summary build/render)
      // is unguarded and runs *before* hideRecordingControls(). If it throws,
      // the recording controls stay on screen with the Stop button stuck busy
      // + "Stopping…" — a bricked UI. Restore the button to idle so the user can
      // retry, then re-throw so the failure is still reported (Sentry).
      setStopButtonBusy(false);
      throw err;
    } finally {
      stopInProgress = false;
    }
  }

  async function handleBackDuringRecording(): Promise<void> {
    if (backDuringRecordingInProgress) {
      log.info('Back during recording already in progress, ignoring');
      pushScreenState('recording');
      return;
    }

    backDuringRecordingInProgress = true;
    try {
      const confirmed = await showConfirmDialog({
        message: 'Stop recording and go back?',
        confirmLabel: 'Stop recording',
        cancelLabel: 'Keep recording',
      });

      if (confirmed) {
        log.info('User confirmed stop recording via back button');
        await handleStopRecording();
      } else {
        log.info('User cancelled back during recording — re-pushing state');
        pushScreenState('recording');
      }
    } catch (err) {
      log.error('Error in handleBackDuringRecording:', err);
      pushScreenState('recording');
    } finally {
      backDuringRecordingInProgress = false;
    }
  }

  // --- Lifecycle ---

  /**
   * The START-OVER teardown. Its only production caller is `main.ts`'s
   * `resetForNewRecording()`, which is reached exclusively from the SUMMARY
   * screen ("New recording", or Back from the summary) — i.e. always after
   * `performStop()` has already run. That is why it does not disable the
   * `beforeunload` warning: `performStop` disabled it on the way here, and
   * there is no path that reaches this function with a recording still live.
   * If a caller is ever added that can, the warning must be disabled here too.
   */
  function cleanupForNewRecording(): void {
    // Teardown parity with performStop: this path must also stop the
    // captures/watches/analyzer, not only the bookkeeping.
    stopLiveFeeds(runtime, deps);
    if (runtime.unsubscribeStore) {
      runtime.unsubscribeStore();
      runtime.unsubscribeStore = null;
    }

    if (runtime.writeFailureTracker) {
      runtime.writeFailureTracker.reset();
      runtime.writeFailureTracker = null;
    }
    if (runtime.captureFailureTracker) {
      runtime.captureFailureTracker.reset();
      runtime.captureFailureTracker = null;
    }

    if (runtime.syncManager) {
      runtime.syncManager.stop();
      runtime.syncManager = null;
    }
    runtime.lastSyncResult = null;
    // Never carry a previous recording's verdicts into this one's summary:
    // a session with QR off writes no outcomes, so a stale list would be
    // shown as if it described the recording just finished.
    runtime.latestQrAnchorOutcomes = [];

    runtime.currentSessionName = '';
  }

  function reset(): void {
    cleanupForNewRecording();
    backDuringRecordingInProgress = false;
    stopInProgress = false;
  }

  return {
    handleStartRecording,
    handleStopRecording,
    handleBackDuringRecording,
    getCurrentSessionName: () => runtime.currentSessionName,
    setCurrentSessionName: (name: string) => {
      runtime.currentSessionName = name;
    },
    recordWriteSuccess: () => runtime.writeFailureTracker?.recordSuccess(),
    recordWriteFailure: (err: unknown) =>
      runtime.writeFailureTracker?.recordFailure(err),
    recordCaptureSuccess: () => runtime.captureFailureTracker?.recordSuccess(),
    recordCaptureFailure: () => runtime.captureFailureTracker?.recordFailure(),
    cleanupForNewRecording,
    reset,
  };
}
