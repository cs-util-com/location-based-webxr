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
import {
  startSession,
  endSession,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import type { RecorderStore } from '../state/recorder-store';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import { selectRefPointEntries } from '../state/ref-points-slice';
import { buildSessionSummary } from './build-session-summary';
import type { RecordingOptions } from '../state/recording-options';
import { formatTimestamp } from 'gps-plus-slam-app-framework/storage/file-system-utils';
import {
  startSession as startStorageSession,
  getCurrentScenarioHandle,
} from '../storage/scenario-storage';
import {
  getSaveFileHandle,
  getSaveFileName,
  generateSessionFilename,
} from '../storage/external-file-storage';
import { createSyncManager, type SyncManager } from '../storage/sync-manager';
import {
  type ZipExportResult,
  type ZipExportContributor,
} from 'gps-plus-slam-app-framework/storage/zip-export';
import {
  syncScenarioSessionToExternalZip,
  exportScenarioSessionAsZip,
} from '../storage/scenario-zip-export';
import { createRefPointsZipContributor } from '../storage/ref-points-zip-contributor';
import { createColmapZipContributor } from '../colmap/colmap-zip-contributor';
import { selectFrameTilesInWebXR } from 'gps-plus-slam-app-framework/state';
import { getOccupancyGrid } from '../state/occupancy-grid-provider';
import {
  startGpsWatch,
  stopGpsWatch,
  startOrientationWatch,
  stopOrientationWatch,
} from 'gps-plus-slam-app-framework/sensors/gps';
import {
  startAbsoluteOrientationWatch,
  stopAbsoluteOrientationWatch,
  getLatestAbsoluteOrientation,
} from 'gps-plus-slam-app-framework/sensors/absolute-orientation';
import { createGpsErrorHandler } from 'gps-plus-slam-app-framework/sensors/gps-error-handler';
import {
  getCurrentArPose,
  startImageCapture,
  stopImageCapture,
  startDepthCapture,
  stopDepthCapture,
  getImageCaptureFrameCount,
  getDepthSampleCount,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import {
  createImageQualityAnalyzer,
  type ImageQualityClient,
} from './image-quality-client';
import { createWriteFailureTracker } from '../storage/write-failure-tracker';
import { createCaptureFailureTracker } from 'gps-plus-slam-app-framework/ar/capture-failure-tracker';
import type { FailureTracker } from 'gps-plus-slam-app-framework/utils/failure-tracker';
import {
  showRecordingControls,
  hideRecordingControls,
  setStopButtonBusy,
  showError,
  updateStatus,
  hideFrameCount,
  hideTrackingQuality,
  updateSyncStatus,
  setAbsCompassStatus,
  hideAbsCompass,
  hideQrStatus,
} from '../ui/hud';
import { showSessionSummary } from '../ui/session-summary';
import { showConfirmDialog } from '../ui/confirm-dialog';
import {
  enableBeforeUnloadWarning,
  disableBeforeUnloadWarning,
  pushScreenState,
  replaceScreenState,
} from '../ui/navigation';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import {
  gpsPathToCoverageCells,
  H3_RESOLUTION,
} from 'gps-plus-slam-app-framework/geo';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { LatLong, Matrix4 } from 'gps-plus-slam-app-framework/core';
import { magneticHeadingFromEnuQuat } from 'gps-plus-slam-app-framework/core';
import type { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';
import { getBuildInfo } from '../utils/build-info';
import { DEFAULT_SCENARIO } from '../storage/session-zip-naming';

const log = createLogger('RecordingSession');

/** AbsCompass HUD refresh cadence. 5 Hz — readable, no DOM thrash. Immutable
 *  config, so it is module-level; the timer *handle* it drives is per-instance
 *  state owned by the factory closure (see `createRecordingSessionHandlers`). */
const ABS_COMPASS_HUD_INTERVAL_MS = 200;

/**
 * Single fallback used everywhere a scenario name is needed but unavailable.
 * Re-exported from `session-zip-naming.DEFAULT_SCENARIO` so that the recording
 * pipeline and the replay browser's metadata-merge contract stay in sync
 * (any divergence would silently break the "missing-metadata + Default
 * Scenario" merge for newly-recorded zips).
 */
const FALLBACK_SCENARIO = DEFAULT_SCENARIO;

function getSanitizedPageUrl(): string | undefined {
  const href = globalThis.location?.href;

  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href);
    // Clearing search/hash and using toString() (rather than origin+pathname)
    // preserves the scheme correctly for URLs with opaque origins
    // (e.g. file:// where url.origin is the literal string "null").
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const queryIndex = href.indexOf('?');
    const hashIndex = href.indexOf('#');
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    return cutIndex === undefined ? href : href.slice(0, cutIndex);
  }
}

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
// Factory
// ---------------------------------------------------------------------------

export function createRecordingSessionHandlers(
  deps: RecordingSessionDeps
): RecordingSessionHandlers {
  // --- State ---
  let writeFailureTracker: FailureTracker | null = null;
  let captureFailureTracker: FailureTracker | null = null;
  let currentSessionName = '';
  let syncManager: SyncManager | null = null;
  let lastSyncResult: ZipExportResult | null = null;
  let backDuringRecordingInProgress = false;
  let stopInProgress = false;
  let unsubscribeStore: (() => void) | null = null;
  /** Off-thread blur/blackness analyzer worker for this recording (null when the
   *  quality gate is disabled). Owned here: created on start, disposed on stop. */
  let imageQualityClient: ImageQualityClient | null = null;
  /**
   * Live AbsCompass HUD refresh timer for THIS recording. The capture module
   * surfaces lifecycle via its onStatus callback but not per-reading; this polls
   * the latest reading a few times a second to show the live magnetic heading
   * (the same number the v3 absolute-compass demo shows), so a field tester can
   * point at a landmark and cross-check it on the spot. Armed on start, cleared
   * on stop. Per-instance (not module-level) so independent handler instances do
   * not share/overwrite each other's timer — the factory's "no module-level
   * mutable state" invariant (see sidecar).
   */
  let absCompassHudTimer: ReturnType<typeof setInterval> | null = null;

  // --- Internal helpers ---

  function startAbsCompassHudUpdates(): void {
    stopAbsCompassHudUpdates();
    absCompassHudTimer = setInterval(() => {
      const reading = getLatestAbsoluteOrientation();
      if (!reading) return; // unavailable / not warmed up → leave onStatus text
      setAbsCompassStatus({
        state: 'active',
        headingDeg: magneticHeadingFromEnuQuat(reading.quaternion),
      });
    }, ABS_COMPASS_HUD_INTERVAL_MS);
  }

  function stopAbsCompassHudUpdates(): void {
    if (absCompassHudTimer !== null) {
      clearInterval(absCompassHudTimer);
      absCompassHudTimer = null;
    }
  }

  /**
   * Build the ZIP export contributors for the current session. Used by BOTH
   * the periodic crash-safety sync and the final export so the on-disk backup
   * is continuously up to date (a contributor added here therefore runs on
   * every sync — COLMAP export plan Q2).
   *
   * The COLMAP contributor reads the maintained live state directly (poses via
   * `selectFrameTilesInWebXR`, the session-constant `projectionMatrix` from the
   * latest depth sample, and the shared occupancy grid) — never a from-scratch
   * re-parse of `actions/`, which would be O(session²) over a recording.
   */
  function buildZipContributors(): ZipExportContributor[] {
    return [
      createRefPointsZipContributor(
        getCurrentScenarioHandle(),
        currentSessionName
      ),
      createColmapZipContributor({
        getFrames: () => selectFrameTilesInWebXR(deps.getStore().getState()),
        getProjectionMatrix: () =>
          deps.getStore().getState().recording.latestDepthSample
            ?.projectionMatrix,
        getOccupancyGrid,
        // Same noise floor the voxel view uses (`occupancy.minConfidence`), read
        // live so a changed value applies to the next crash-safety sync / export
        // — keeps phantom behind-surface points out of the reconstruction.
        getMinConfidence: () =>
          deps.getRecordingOptions().occupancy.minConfidence,
      }),
    ];
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
          `Recording: ${currentSessionName} | GPS unavailable | ${loadedSummary}`
        );
        return;
      }

      refPointVisualizer.setZeroRef(zeroRef);

      updateStatus(`Recording: ${currentSessionName} | ${loadedSummary}`);
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
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
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
    currentSessionName = `recording-${formatTimestamp(now)}`;

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
    unsubscribeStore = wireStoreSubscribers(store, {
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
    writeFailureTracker = createWriteFailureTracker({ onWarning: showError });
    captureFailureTracker = createCaptureFailureTracker({
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
        sessionName: currentSessionName,
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
          imageQualityClient?.dispose();
          imageQualityClient = createImageQualityAnalyzer(
            imageConfig.qualityFilter
          );
          deps.setImageQualityAnalyzer(imageQualityClient.analyze);
          log.info('Image-quality gate enabled (off-thread blur/blackness)');
        } catch (err) {
          // The worker is constructed synchronously; on a locked-down
          // deployment (e.g. CSP `worker-src`) `new Worker` can throw. The gate
          // is optional and fail-open everywhere, so disable it and keep
          // recording rather than aborting a session whose GPS/orientation
          // watches are already running.
          imageQualityClient = null;
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
      syncManager = createSyncManager(
        async () => {
          lastSyncResult = await syncScenarioSessionToExternalZip(
            saveFileHandle,
            scenarioName,
            currentSessionName,
            {
              contributors: buildZipContributors(),
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
      syncManager.start();
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
    updateStatus(`Recording: ${currentSessionName}`);
  }

  /**
   * Re-entrancy-guarded entry point for stopping a recording.
   *
   * The teardown awaits a final external sync that can take many seconds for
   * large sessions. Without a guard, a second Stop tap during that window ran
   * the whole teardown concurrently and stopped + nulled the shared
   * `syncManager` out from under the first call, which then threw
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
      await performStop();
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

  /**
   * Stop everything that actively FEEDS a recording — captures, sensor
   * watches, the off-thread quality analyzer — plus their HUD readouts. The
   * ONE teardown for this resource cluster, shared by `performStop` (the
   * ordered stop flow) and `cleanupForNewRecording` (the start-over path),
   * which previously skipped it and left the camera/GPS feeds and the analyzer
   * Worker running (recurring PR #115/#120/#123 review finding). Every call is
   * idempotent, so running it on an already-stopped session is a no-op.
   *
   * NOT the XR-session-end path, despite what this comment said until
   * 2026-08-17: a system-ended XRSession is handled by `system-session-end.ts`,
   * which calls the regular `handleStopRecording` — so that path reaches this
   * function through `performStop`, never through `cleanupForNewRecording`.
   */
  function stopLiveFeeds(): void {
    stopImageCapture();
    // Tear down the off-thread quality analyzer (worker) for this recording
    // and clear the injected callback so the next recording starts clean.
    deps.setImageQualityAnalyzer(null);
    imageQualityClient?.dispose();
    imageQualityClient = null;
    hideFrameCount();
    hideTrackingQuality();
    stopDepthCapture();
    stopGpsWatch();
    stopOrientationWatch();
    stopAbsCompassHudUpdates();
    stopAbsoluteOrientationWatch();
    hideAbsCompass();
    hideQrStatus();
  }

  async function performStop(): Promise<void> {
    log.info('Stop recording');

    disableBeforeUnloadWarning();

    // Capture counts before stopping
    const imageCount = getImageCaptureFrameCount();
    const depthSampleCount = getDepthSampleCount();

    stopLiveFeeds();

    // Capture authoritative end time immediately when recording stops,
    // before async operations (metadata write, sync, ZIP export) that
    // may take several seconds. Used for both metadata and summary.
    const endTime = Date.now();

    // Get state before dispatch
    const store = deps.getStore();

    // Drain the persistence middleware's async WriteQueue BEFORE anything
    // reads this session's `actions/` (the final external sync and the OPFS
    // zip export below) — an action dispatched moments before Stop could
    // otherwise land after the export enumerated the directory and silently
    // miss the zip (indoor-loop enablement follow-up §3.6b, 2026-07-12).
    try {
      await store.flushPendingActionWrites();
    } catch (err) {
      log.error('Failed to flush pending action writes:', err);
    }

    const state = store.getState();
    const sessionMetadata = state.recording.sessionMetadata;
    const gpsEvents = state.gpsData?.gpsEvents;
    // Reference points come from the recorder's flat `refPoints` slice (the
    // canonical post-slice-collapse source). The legacy `gpsData.referencePoints`
    // slice is no longer dispatched to (Step 5.7a-1), so reading it here would
    // always yield an empty list. The flat entries carry `timestamp`, which the
    // summary map needs to classify each marker as prior vs. current.
    const refPoints = selectRefPointEntries(state.refPoints);
    const gpsPositions = gpsEvents?.gpsPositions ?? [];

    if (!sessionMetadata?.startTime) {
      log.error(
        'sessionMetadata.startTime is missing at stop — this indicates an inconsistent state. ' +
          'The recorded startedAt will be incorrect (≈ endedAt).'
      );
    }

    // Write session metadata
    try {
      let buildInfo;

      try {
        buildInfo = getBuildInfo();
      } catch (error) {
        log.warn('Build metadata unavailable for session metadata', error);
      }

      // Per-tour H3 coverage index (Step 2 / D1): deduped res-11 cells the GPS
      // path crossed, so the map-centric browser can place this tour without
      // unzipping its GPS data. Computed here at stop while the path is in state.
      const h3Cells = gpsPathToCoverageCells(
        gpsPositions.map((p) => ({ lat: p.latitude, lng: p.longitude }))
      );

      await store.writeSessionMetadata({
        version: 1,
        odomCoordVersion: 5,
        startedAt: sessionMetadata?.startTime
          ? new Date(sessionMetadata.startTime).toISOString()
          : new Date(endTime).toISOString(),
        endedAt: new Date(endTime).toISOString(),
        contextTag: sessionMetadata?.contextTag ?? FALLBACK_SCENARIO,
        actionCount: gpsPositions.length,
        frameCount: imageCount,
        userAgent: navigator.userAgent,
        ...(buildInfo ? { build: buildInfo } : {}),
        pageUrl: getSanitizedPageUrl(),
        h3Cells,
        h3Resolution: H3_RESOLUTION,
      });
    } catch (err) {
      log.error('Failed to write session metadata:', err);
    }

    // Final sync before stopping. Capture the manager into a local and claim
    // ownership (null the shared field) *before* the await, so any concurrent
    // teardown path (a second stop, or cleanupForNewRecording) sees null and
    // no-ops instead of stopping it from under us.
    // Defense in depth alongside the re-entrancy guard (Sentry issue 7319627943).
    const sm = syncManager;
    syncManager = null;
    if (sm) {
      try {
        log.info('Triggering final sync before stopping...');
        await sm.syncNow();
        log.info('Final sync completed successfully');
      } catch (err) {
        log.error('Final sync failed:', err);
      }
      sm.stop();
      log.info('External ZIP sync stopped');
    }

    // Cleanup store subscription
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }

    // Collect tracker errors before resetting
    const errors: string[] = [];
    deps.collectTrackerErrors(
      writeFailureTracker,
      'image write failures',
      errors
    );
    writeFailureTracker = null;
    deps.collectTrackerErrors(
      captureFailureTracker,
      'image capture failures',
      errors
    );
    captureFailureTracker = null;

    // Hide map overlay
    const mapOverlay = deps.getMapOverlay();
    if (mapOverlay?.isVisible()) {
      mapOverlay.hide();
    }

    // Generate ZIP from OPFS when no external save location
    if (!lastSyncResult) {
      try {
        log.info('No external save location — generating ZIP from OPFS...');
        updateStatus('Packaging session...');
        const scenarioName =
          deps.getStore().getState().scenario.currentScenarioName ||
          FALLBACK_SCENARIO;
        const result = await exportScenarioSessionAsZip(
          scenarioName,
          currentSessionName,
          {
            contributors: buildZipContributors(),
          }
        );
        lastSyncResult = result;
        log.info(
          `OPFS ZIP created: ${result.blob.size} bytes, ${result.fileCount} files`
        );
      } catch (err) {
        log.error('Failed to generate ZIP from OPFS:', err);
      }
    }

    // Dispatch session end
    store.dispatch(endSession());

    // Build summary data (pure derivation — see build-session-summary.ts)
    const summaryData = buildSessionSummary({
      endTime,
      startTime: sessionMetadata?.startTime,
      imageCount,
      depthSampleCount,
      errors,
      failedWriteCount: state.recording.failedWriteCount,
      gpsPositions,
      odometryPositions: gpsEvents?.odometryPositions ?? [],
      alignmentMatrix: gpsEvents?.alignmentMatrix ?? null,
      alignmentSnapshotNuePositions:
        gpsEventVisualizer.getAlignmentSnapshotPositions(),
      refPoints,
      syncResult: lastSyncResult,
      zipFilename: lastSyncResult
        ? (getSaveFileName() ?? generateSessionFilename())
        : undefined,
    });

    // Clean up sync result reference
    lastSyncResult = null;

    log.info('Session summary:', summaryData);

    hideRecordingControls();
    replaceScreenState('summary');
    showSessionSummary(summaryData);
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
    stopLiveFeeds();
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }

    if (writeFailureTracker) {
      writeFailureTracker.reset();
      writeFailureTracker = null;
    }
    if (captureFailureTracker) {
      captureFailureTracker.reset();
      captureFailureTracker = null;
    }

    if (syncManager) {
      syncManager.stop();
      syncManager = null;
    }
    lastSyncResult = null;

    currentSessionName = '';
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
    getCurrentSessionName: () => currentSessionName,
    setCurrentSessionName: (name: string) => {
      currentSessionName = name;
    },
    recordWriteSuccess: () => writeFailureTracker?.recordSuccess(),
    recordWriteFailure: (err: unknown) =>
      writeFailureTracker?.recordFailure(err),
    recordCaptureSuccess: () => captureFailureTracker?.recordSuccess(),
    recordCaptureFailure: () => captureFailureTracker?.recordFailure(),
    cleanupForNewRecording,
    reset,
  };
}
