/**
 * GpsPlusSlamJs Recorder App - Main Entry Point
 *
 * This module initializes the WebXR AR session, Three.js renderer,
 * and wires up the UI controls for recording sessions.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * and docs/issue-library-integration.md
 * - Uses the GpsPlusSlamJs library for GPS/AR alignment
 * - GPS events trigger combined GPS+AR recordings
 * - AR pose is read at GPS moment (not recorded independently)
 */

// Initialize Sentry as early as possible for error tracking.
// Guard with PROD check to avoid sending test/dev data to Sentry.
// NOTE: We use PROD rather than a dedicated VITE_SENTRY_ENABLED env var because:
// 1. Cloudflare preview deployments are dev builds where we don't want Sentry noise
// 2. If staging with separate Sentry is needed later, we'd use VITE_SENTRY_DSN anyway
// 3. PROD is idiomatic Vite and requires zero configuration
import { initSentry } from './utils/sentry';
if (import.meta.env.PROD) {
  initSentry();
}

import {
  initUI,
  showError,
  updateStatus,
  updateArInfo,
  updateGpsInfo,
  updateFrameCount,
  populateScenarios,
  showRecordingControls,
  hideRecordingControls,
  validateEnterButton,
  updatePermissionStatus,
  setPermissionsReady,
  setFolderSelected,
  setSaveLocationSelected,
  setFolderImportExpanded,
  setFolderImportProgress,
  updateFolderStatus,
  updateSaveStatus,
  resetUIForNewRecording,
  showSetupModal,
  updateRefPointButtonLabel,
  setNewRefPointButtonVisible,
  updateRefPointHint,
  updateTrackingQuality,
  showUnsupportedPlatformNotice,
} from './ui/hud';
import {
  initSessionSummary,
  showSessionSummary,
  hideSessionSummary,
} from './ui/session-summary';
import {
  initLogPanel,
  showLogPanel,
  hideLogPanel,
  toggleLogPanel,
} from './ui/log-panel';
import { initToast, showToast, TOAST_DURATION_ERROR } from './ui/toast';
import { destroyConfirmDialog } from './ui/confirm-dialog';
import * as THREE from 'three';
import {
  initAR,
  endARSession,
  setImageCaptureCallback,
  setDepthCaptureCallback,
  setCameraFrameCallback,
  setFrameCallback,
  setTrackingLostCallback,
  setTrackingCallbacks,
  setTrackingRecoveredCallback,
  setTrackingStore,
  setSessionEndCallback,
  getCurrentArPose,
  getScene,
  getCamera,
  getArWorldGroup,
  setScene,
  setArWorldGroup,
  getDepthInfoFromFrame,
  type CapturedImage,
  type DepthSample,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { DepthOccluder } from 'gps-plus-slam-app-framework/ar/depth-occluder';
import { registerXrFrameUpdate } from 'gps-plus-slam-app-framework/ar/xr-frame-loop';
import { getXrErrorMessage } from 'gps-plus-slam-app-framework/ar/xr-error-handler';
import { applyChromiumProjectionLayerWorkaround } from 'gps-plus-slam-app-framework/ar/chromium-camera-access-workaround';
import {
  initStorage,
  resetForNewSession,
  clearRefPointsCacheForAllScenarios,
  getCurrentScenarioHandle,
} from './storage/scenario-storage';
import {
  getReadFolderHandle,
  resetForNewRecording as resetExternalForNewRecording,
  hasReadFolderPermission,
} from './storage/external-file-storage';
import { createRecordingSessionHandlers } from './recording/recording-session-handlers';
import { createSystemSessionEndHandler } from './recording/system-session-end';
import {
  createFolderManager,
  type FolderManagerDeps,
} from './storage/folder-manager';

import {
  setImportedRefPointEntries,
  selectImportedKnownAnchors,
  type RefPointEntry,
} from './state/ref-points-slice';

import {
  showRefPointPicker,
  createRefPointPickerHtml,
  isRefPointPickerVisible,
  cancelRefPointPicker,
} from './ui/ref-point-picker';
import {
  initNavigation,
  pushScreenState,
  replaceScreenState,
  getCurrentScreen,
} from './ui/navigation';
import {
  createRecorderStore,
  add2dImage,
  recordDepthSample,
} from './state/recorder-store';
import {
  startGpsWatch,
  stopGpsWatch,
  requestOrientationPermission,
} from 'gps-plus-slam-app-framework/sensors/gps';
import {
  checkAllPermissions,
  requestAllPermissions,
  subscribePermissionChanges,
} from 'gps-plus-slam-app-framework/sensors/permission-checker';

import type {
  LatLong,
  LoopClosureHandler,
} from 'gps-plus-slam-app-framework/core';
import {
  createLoopClosureHandler,
  odometryTrackingRestarted,
} from 'gps-plus-slam-app-framework/core';
import { createStoreRef } from './state/store-ref';
import {
  wireRefPointViews,
  type RefPointViewWiring,
} from './ui/ref-point-view-wiring';
import { refPointVisualizer } from './visualization/ref-point-visualizer';
import { subscribeHudToTrackingQuality } from './ui/hud-tracking-quality-subscriber';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import {
  createCameraFollower,
  type CameraFollower,
} from 'gps-plus-slam-app-framework/visualization/camera-follower';
import {
  createAlignmentLerper,
  type AlignmentLerper,
} from 'gps-plus-slam-app-framework/visualization/alignment-lerper';
import { createGpsCompassCubes } from 'gps-plus-slam-app-framework/visualization/gps-compass-cubes';
import { FrameTileVisualizer } from './visualization/frame-tile-visualizer';
import { decodeFrameTexture } from './visualization/frame-texture-decoder';
import { wireFrameTileSubscribers } from './visualization/wire-frame-tile-subscribers';
import { FrameBlobCache } from './visualization/frame-blob-cache';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { OccupancyCubesVisualizer } from './visualization/occupancy-cubes-visualizer';
import {
  createOccluderSink,
  type OccluderSink,
  type OccluderSinkHandle,
} from './visualization/occluder-sink';
import { wireOccupancyGridSubscribers } from './visualization/wire-occupancy-grid-subscribers';
import { setOccupancyGrid } from './state/occupancy-grid-provider';
import { SESSION_IMAGES_DIR } from 'gps-plus-slam-app-framework/storage/file-system-utils';

import {
  initReplayUI,
  switchToReplayMode,
  populateReplayScenarios,
} from './ui/replay-ui';
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
} from './ui/session-browser';
import type { SessionEntry } from './ui/session-browser';
import { createMapBrowser, type MapBrowserInstance } from './ui/map-browser';
import {
  streamRecordingIndex,
  type RecordingCoverage,
} from './ui/recording-index';
import {
  backfillCoverageIntoZips,
  type BackfillCandidate,
} from './storage/coverage-backfill';
import { gpsPathToCoverageCells } from 'gps-plus-slam-app-framework/geo';
import { createReplayHandlers } from './replay/replay-handlers';
import { createRefPointHandlers } from './ref-points/ref-point-handlers';
import { createMeasurementPointHandlers } from './measurement-points/measurement-point-handlers';
import { MeasurementPointVisualizer } from './visualization/measurement-point-visualizer';
import { wireMeasurementPointSubscribers } from './visualization/wire-measurement-point-subscribers';
import {
  createMeasurementUI,
  type MeasurementUIInstance,
} from './ui/measurement-ui';
import {
  selectMeasurementDraft,
  selectProvisionalMeasurement,
} from './state/measurement-points-slice';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  loadRecordingOptions,
  type RecordingOptions,
} from 'gps-plus-slam-app-framework/state/recording-options';
import { initSettingsModal } from './ui/settings-modal';
import {
  createStatsOverlay,
  type StatsOverlayHandle,
} from './ui/stats-overlay';
import { wireQrRecording } from './qr/wire-qr-recording';
import type { QrDetectionController } from 'gps-plus-slam-app-framework/ar';

import { listFormatter } from 'gps-plus-slam-app-framework/utils/list-formatter';

const log = createLogger('Recorder');

/**
 * Handle write failure by showing toast notification.
 * User Feedback Issue #1 Part B: Real-time feedback on write failures.
 */
function handleWriteFailure(error: Error): void {
  log.warn('Write failure detected:', error.message);
  showToast('⚠️ Save failed - check folder permissions', {
    severity: 'error',
    duration: TOAST_DURATION_ERROR,
  });
}

/**
 * Factory function for creating the recorder store with standard configuration.
 * Centralizes store creation to ensure consistent options (DRY principle).
 */
function createNewStore() {
  // Compass alignment debug opt-ins from the persisted recording settings, so a
  // new store (boot or per-session swap) picks up the operator's toggles.
  const compass = recordingOptions?.compassDebug;
  return createRecorderStore({
    onWriteFailure: handleWriteFailure,
    enableCompassColdStartOverride: compass?.coldStartOverride,
    enableCompassRotationPrior: compass?.rotationPrior,
    enableCompassWebXRConsistency: compass?.webXRConsistency,
  });
}

// Global store instance with write failure callback.
//
// `storeRef` mirrors the same value but emits to subscribers on every swap.
// Long-lived subscribers (e.g. the HUD tracking-quality subscriber, F1 fix
// from 2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md)
// must observe `storeRef` instead of capturing `store` in a closure, or they
// silently freeze against the boot store after `Start Recording` / replay.
// Recording options loaded at module init so the boot store — and every
// `createNewStore` swap — can read `compassDebug` for the alignment opt-ins.
// `main()` reloads it (harmless) before the rest of init.
let recordingOptions: RecordingOptions = loadRecordingOptions();

let store = createNewStore();
const storeRef = createStoreRef(store);

// Map overlay instance (created when AR session starts)
let mapOverlay: LeafletMapOverlay | null = null;

// Issue 8: Camera follower — GPS-aligned anchor for map and compass cubes
let cameraFollower: CameraFollower | null = null;

// Issue 4: Alignment lerper — smooths alignment-matrix transitions
let alignmentLerper: AlignmentLerper | null = null;

// F3.5d — live frame-tile visualization. The recorder caches every captured
// frame blob in memory keyed by its `frames/<filename>` path, so the
// FrameTileVisualizer can paint the same textures the replay path uses.
// The wirer subscribes to `selectFrameTilesInWebXR` (memoised over
// `state.gpsData.odometryPath.points`), and FrameTileVisualizer.addTile
// reads the blob out of this cache. Cleared on `resetMainState`.
//
// Step 7 of the 2026-05-27 slice-collapse plan: bounded by an LRU byte
// cap so multi-hour outdoor sessions don't accumulate every JPEG in RAM
// (review §E). The wirer processes frames tail-first and never re-reads a
// blob once its tile is decoded, so evicting cold/old blobs is safe.
const LIVE_FRAME_BLOB_CACHE_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB
const liveFrameBlobs = new FrameBlobCache({
  maxBytes: LIVE_FRAME_BLOB_CACHE_MAX_BYTES,
});
let frameTileVisualizer: FrameTileVisualizer | null = null;
let unsubscribeFrameTiles: (() => void) | null = null;

// Perf stats overlay (visualization.statsOverlay, OFF by default) — Step 0 of
// the 2026-07-03 long-session fps plan. Mounted into the #app dom-overlay root
// at Enter-AR, advanced from the setFrameCallback tick, disposed on re-enter +
// in resetMainState (same lifecycle as the frame-tile visualizer).
let statsOverlay: StatsOverlayHandle | null = null;

// Occupancy-grid cubes (2026-06-11 depth occupancy-grid port plan): the
// grid is derived state fed from `recordDepthSample` actions via
// `wireOccupancyGridSubscribers`; the instanced-cube visualizer paints it
// in the live AR scene at ~1 Hz.
let occupancyGrid: OccupancyGrid | null = null;
let occupancyCubesVisualizer: OccupancyCubesVisualizer | null = null;
// Persistent depth-only occluder (ON by default — occupancy.persistentOcclusion).
// One handle owns the mesh + off-thread worker + sink (occluder-sink.ts, the
// wiring shared with replay); dispose() releases all three and no-ops the
// async sink callbacks. Disposed on re-enter + in resetMainState.
let occluderSinkHandle: OccluderSinkHandle | null = null;
// Live CPU-depth occluder (off by default — occupancy.liveOcclusion). Lifecycle
// mirrors `occluderSinkHandle`: disposed on re-enter + in resetMainState (not via the
// framework session-disposer registry). `liveOccluderUnregisterFrame` unhooks
// the per-frame depth feed alongside the dispose.
let liveOccluder: DepthOccluder | null = null;
let liveOccluderUnregisterFrame: (() => void) | null = null;
let unsubscribeOccupancyGrid: (() => void) | null = null;

// Live loop-closure capture (opt-in, recording-options `loopClosureDebug`).
// The handler is (re)bound lazily to the CURRENT store inside the per-frame
// callback — stores swap per recording session, and a rebind also resets the
// handler's last-pose memory, which is exactly right for a fresh session.
// Disposed on re-enter + in resetMainState, mirroring the live occluder.
let loopClosureHandler: LoopClosureHandler | null = null;
let loopClosureHandlerBoundStore: unknown = null;
let loopClosureUnregisterFrame: (() => void) | null = null;

// Live QR recording (opt-in, recording-options `qr`). The thin RAW producer
// (created in handleEnterAR when enabled) receives camera frames via the
// `setCameraFrameCallback` registered before initAR; `wireQrRecording` owns the
// producer + the WS-5 debug-viz subscriber and returns a dispose handle.
let qrProducer: QrDetectionController | null = null;
let unsubscribeQrRecording: (() => void) | null = null;

// HUD tracking-quality subscription. `subscribeHudToTrackingQuality` returns a
// dispose function that detaches both the per-store subscription and the
// store-swap listener. We keep the handle here so re-entering AR (back to
// setup → Enter AR again) and `resetMainState` can tear it down instead of
// leaking an extra subscriber on every cycle.
let unsubscribeTrackingQuality: (() => void) | null = null;

// Ref-point view wiring (3D spheres + live-map markers) — AR-scoped and
// store-swap-following via storeRef (round-3 feedback 2026-07-05). Wired at
// Enter AR so the views react in AR_READY too (e.g. a folder import finishing
// before the first recording); torn down on re-enter + in resetMainState.
let refPointViews: RefPointViewWiring | null = null;

// Replay mode handlers — encapsulates all replay state and event handlers
// (Finding #7 decomposition: extracted from main.ts to replay/replay-handlers.ts)
const replayHandlers = createReplayHandlers({
  setStore: (newStore) => {
    store = newStore;
    storeRef.set(newStore);
  },
});

// Recording session handlers — encapsulates start/stop recording lifecycle
// (Finding #7 decomposition Step 3: extracted from main.ts to recording/recording-session-handlers.ts)
const recordingSessionHandlers = createRecordingSessionHandlers({
  getStore: () => store,
  setStore: (newStore) => {
    store = newStore;
    storeRef.set(newStore);
  },
  setTrackingStore,
  createNewStore,
  getRecordingOptions: () => recordingOptions,
  getMapOverlay: () => mapOverlay,
  getSessionNotes,
  waitForZeroReference,
  loadAndDisplayRefPoints: (handle) =>
    folderManager.loadAndDisplayRefPoints(handle),
  collectTrackerErrors,
  applyAlignmentMatrix: (matrix: readonly number[]) =>
    alignmentLerper?.setTarget(matrix),
  onNewGpsLatLng: (lat: number, lng: number) => {
    const nearby = refPointHandlers.checkNearbyRefPoint(lat, lng);
    updateRefPointButtonLabel(nearby?.displayName);
    setNewRefPointButtonVisible(nearby?.isNeighborCell ?? false);
    // D3: inline confirmation hint so the name relabel reads as "you're at X".
    updateRefPointHint(nearby);
  },
});

// Ref-point handlers — encapsulates all ref-point state and event handlers
// (Finding #7 decomposition Step 2: extracted from main.ts to ref-points/ref-point-handlers.ts)
const refPointHandlers = createRefPointHandlers({
  getStore: () => store,
  getCurrentSessionName: () => recordingSessionHandlers.getCurrentSessionName(),
});

// Measurement Point handlers — wired with replay guard (FIX 2)
const measurementPointHandlers = createMeasurementPointHandlers({
  getStore: () => store,
  getCurrentSessionName: () => recordingSessionHandlers.getCurrentSessionName(),
  showError,
  showToast,
  isReplayMode: () => replayHandlers.getIsReplayMode(),
});

// Measurement UI — created lazily when the AR session starts (Phase 4).
// Disposed on session end / store swap.
let measurementUI: MeasurementUIInstance | null = null;
let measurementPointVisualizer: MeasurementPointVisualizer | null = null;
let unsubscribeMeasurementPoints: (() => void) | null = null;

/**
 * Integrated "Mark Ref Point" flow.
 *
 * If the measurement system has an active, confirmable triangulated draft,
 * the ref point is created at the triangulated 3D position and the measurement
 * is also persisted. Otherwise, falls back to the original behavior
 * (ref point at the camera's current position).
 */
async function integratedMarkRefPoint(
  options?: {
    forceNew?: boolean;
  },
  confirmationMode?: 'quality' | 'override'
): Promise<void> {
  const state = store.getState();
  const draft = selectMeasurementDraft(state);
  const provisional = selectProvisionalMeasurement(state);

  // A solved point can be saved even when quality is below the recommended
  // threshold; the UI labels this action "Save anyway" and shows the warning.
  if (provisional?.point && state.measurementPoints.pendingRays.length >= 1) {
    const overridePosition: Vector3 = provisional.point;
    if (!draft.canConfirm) {
      log.warn(
        'Integrated mark: saving a low-quality triangulated measurement',
        draft.lastQualityScore
      );
    }
    log.info(
      `Integrated mark: using triangulated point [${overridePosition.map((v: number) => v.toFixed(2)).join(', ')}]`
    );

    // Persist the measurement directly. The legacy reference-point workflow
    // has its own naming picker and must not block measurement saving.
    await measurementPointHandlers.handleConfirmPoint(
      folderManager.getCurrentScenarioName(),
      confirmationMode
    );
  } else {
    // No active measurement — original behavior (ref point at camera)
    await refPointHandlers.handleMarkRefPoint(options);
  }
}

// Folder manager — encapsulates folder selection, save location, scenario management
// (Finding #7 decomposition Step 4: extracted from main.ts to storage/folder-manager.ts)
// --- Map-centric recording browser (Step 4C) ---

let mapBrowser: MapBrowserInstance | null = null;
/** Aborts the in-flight coverage stream when the browser is torn down. */
let mapBrowserAbort: AbortController | null = null;

/** Remove the map browser, abort any in-flight stream, and drop its container. */
function teardownMapBrowser(): void {
  mapBrowserAbort?.abort();
  mapBrowserAbort = null;
  mapBrowser?.destroy();
  mapBrowser = null;
  document.getElementById('map-browser-root')?.remove();
}

/**
 * Present the map-centric browser as the primary replay selector (D3a) for an
 * opened replay folder. The map is mounted **immediately** (empty) and
 * recordings are **streamed** onto it as each is indexed — metadata-present
 * ones first/instantly, legacy ones as their GPS path is read — so the user
 * sees and can use the map right away instead of blocking on the full index
 * (Slice A). A progress pill counts up and then hides on completion.
 *
 * Picking a tour starts a single-tour replay (D3) and tears the browser down.
 * The owned `AbortController` cancels the stream if the browser is closed or
 * another folder is opened mid-index, so a torn-down map never receives tiles.
 */
async function launchMapBrowser(
  folderHandle: FileSystemDirectoryHandle
): Promise<void> {
  teardownMapBrowser();

  const container = ensureMapBrowserRoot();
  const abort = new AbortController();
  mapBrowserAbort = abort;

  // Legacy recordings that carry coverage worth embedding into their zips — the
  // one-time backfill candidates (B1), accumulated as the index streams in.
  const backfillCandidates: BackfillCandidate[] = [];

  const browser = createMapBrowser(container, {
    onPlayTour: (recording) => {
      teardownMapBrowser();
      void replayHandlers.startReplayForEntry(recording.entry);
    },
    onClose: teardownMapBrowser,
    onBackfill: async () => {
      const result = await backfillCoverageIntoZips(
        folderHandle,
        backfillCandidates,
        { signal: abort.signal }
      );
      if (result.permissionDenied) {
        showError(
          "Couldn't get write access — recordings will be re-indexed each open."
        );
      } else if (result.failed > 0) {
        showToast(
          `Embedded coverage into ${result.embedded} recordings (${result.failed} failed)`,
          { severity: 'warning' }
        );
      } else if (result.embedded > 0) {
        showToast(
          `Embedded coverage into ${result.embedded} recordings — future loads will be instant`
        );
      }
      return result;
    },
  });
  if (!browser) {
    teardownMapBrowser();
    return;
  }
  mapBrowser = browser;

  try {
    await streamRecordingIndex(folderHandle, {
      onTotal: (total) => {
        if (total === 0) {
          // Nothing to browse spatially — leave the modal list as the fallback
          // (don't show an empty map).
          teardownMapBrowser();
          return;
        }
        browser.setIndexingProgress(0, total);
      },
      onRecording: (rec) => {
        browser.addRecording(rec);
        if (rec.backfilled && rec.cells.length > 0) {
          backfillCandidates.push({
            fileHandle: rec.entry.fileHandle,
            filename: rec.entry.filename,
            cells: rec.cells,
          });
        }
      },
      onProgress: ({ done, total }) => browser.setIndexingProgress(done, total),
      signal: abort.signal,
    });
  } catch (err) {
    // An aborted stream (browser closed / folder switched) is expected — only
    // surface genuine failures.
    if (!abort.signal.aborted) {
      log.error('Map browser coverage stream failed', err);
      showError('Failed to index recordings for the map — see logs.');
    }
  }
}

/** Create (or reuse) the full-bleed root container for the map browser. */
function ensureMapBrowserRoot(): HTMLElement {
  let container = document.getElementById('map-browser-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'map-browser-root';
    container.className = 'fixed inset-0 z-[80]';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Reduce a fixture tour (GPS path of `{lat,lng}`) to a `RecordingCoverage` so
 * Playwright can mount/stream the browser without a real recordings folder.
 */
function fixtureToRecordingCoverage(
  f: {
    filename: string;
    scenario: string;
    path: Array<{ lat: number; lng: number }>;
  },
  index: number
): RecordingCoverage {
  const cells = gpsPathToCoverageCells(f.path);
  return {
    entry: {
      filename: f.filename,
      fileHandle: {} as FileSystemFileHandle,
      date: new Date(Date.UTC(2026, 0, 1 + index)),
      h3Cells: cells,
    },
    scenario: f.scenario,
    cells,
    backfilled: false,
  };
}

const folderManager = createFolderManager({
  getStore: () => store,
  getIsReplayMode: () => replayHandlers.getIsReplayMode(),
  setReplayZipScenariosCache: (cache) =>
    replayHandlers.setReplayZipScenariosCache(cache),
  onReplayFolderScanned: (folderHandle) => launchMapBrowser(folderHandle),
  showError,
  updateStatus,
  populateScenarios,
  setFolderSelected,
  setSaveLocationSelected,
  setFolderImportExpanded,
  validateEnterButton,
  // D2/D3 (2026-07-05): the eager ref-point indexing pass drives the
  // determinate progress bar inside the folder-import section and announces
  // its terminal outcome (durable end state + toast).
  onIndexingProgress: ({ done, total }) =>
    setFolderImportProgress({ kind: 'progress', done, total }),
  onIndexingSettled: (outcome) => handleRefPointIndexingSettled(outcome),
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
  populateReplayScenarios,
  updateFolderStatus,
  updateSaveStatus,
});

/**
 * Terminal outcome of the eager folder-import ref-point indexing pass
 * (D2/D3, 2026-07-05 folder-import feedback):
 * - success → drive the progress bar's durable ✓ end state; when new points
 *   were written, additionally announce it with an info toast. The toast
 *   mounts in the #app overlay, so a user who entered AR mid-index (the pass
 *   never gates Enter AR) still sees the completion signal. A no-op pass
 *   (every store already up to date) stays quiet — the bar end state suffices.
 * - error → reset the bar and raise an error toast (the folder-manager also
 *   routes the message to the HUD error banner for the start screen).
 * - aborted → reset the bar silently (teardown / replaced by a new pick).
 *
 * Exported for testing.
 */
export function handleRefPointIndexingSettled(
  outcome: Parameters<NonNullable<FolderManagerDeps['onIndexingSettled']>>[0]
): void {
  if (outcome.status === 'success') {
    setFolderImportProgress({
      kind: 'done',
      refPointsWritten: outcome.refPointsWritten,
      zipFilesTotal: outcome.zipFilesTotal,
    });
    if (outcome.refPointsWritten > 0) {
      const points = `${outcome.refPointsWritten} reference point${outcome.refPointsWritten === 1 ? '' : 's'}`;
      const recordings = `${outcome.zipFilesTotal} recording${outcome.zipFilesTotal === 1 ? '' : 's'}`;
      showToast(`Recovered ${points} from ${recordings}`, {
        severity: 'info',
      });
    }
    return;
  }
  setFolderImportProgress(null);
  if (outcome.status === 'error') {
    showToast(`Reference point indexing failed: ${outcome.message}`, {
      severity: 'error',
      duration: TOAST_DURATION_ERROR,
    });
  }
}

// --- Exported for testing ---

/**
 * Get imported reference points from the V2 slice.
 * Returns one entry per sidecar-imported known anchor (timestamp === 0).
 * Exported for testing.
 */
export function getImportedRefPoints() {
  return selectImportedKnownAnchors(store.getState().refPoints);
}

/**
 * Replace the imported ref-point set wholesale (for testing).
 * Dispatches `setImportedRefPointEntries` into the V2 slice. Each input
 * becomes a `RefPointEntry` with `timestamp: 0` (sidecar marker).
 */
export function setImportedRefPointsForTesting(
  refPoints: ReadonlyArray<{
    id: string;
    name?: string;
    lat: number;
    lon: number;
    alt?: number;
    sourceZipName?: string;
  }>
): void {
  const entries: RefPointEntry[] = refPoints.map((rp) => ({
    id: rp.id,
    timestamp: 0,
    name: rp.name,
    rawGpsPoint: {
      id: `imported-${rp.id}`,
      latitude: rp.lat,
      longitude: rp.lon,
      ...(rp.alt !== undefined ? { altitude: rp.alt } : {}),
      timestamp: 0,
    },
  }));
  store.dispatch(setImportedRefPointEntries(entries));
}

/**
 * Get the current scenario name.
 * Exported for testing purposes.
 */
export function getCurrentScenarioName(): string {
  return folderManager.getCurrentScenarioName();
}

/**
 * Set the current scenario name.
 * Called when user selects a scenario from the dropdown.
 */
export function setCurrentScenarioName(name: string): void {
  folderManager.setCurrentScenarioName(name);
}

/**
 * Tear down the live CPU-depth occluder: unhook its per-frame depth feed and
 * dispose it (which removes its full-screen mesh from `arWorldGroup`). Safe to
 * call when nothing is wired. Used on re-enter and in `resetMainState`, mirroring
 * how `occluderSinkHandle` is managed.
 */
function disposeLiveOccluder(): void {
  liveOccluderUnregisterFrame?.();
  liveOccluderUnregisterFrame = null;
  liveOccluder?.dispose();
  liveOccluder = null;
}

/**
 * Tear down the live loop-closure capture wiring. Safe to call when nothing
 * is wired. Used on re-enter and in `resetMainState`, mirroring
 * `disposeLiveOccluder`.
 */
function disposeLoopClosureWiring(): void {
  loopClosureUnregisterFrame?.();
  loopClosureUnregisterFrame = null;
  loopClosureHandler = null;
  loopClosureHandlerBoundStore = null;
}

/**
 * Wire the live loop-closure capture (recording-options `loopClosureDebug`,
 * default OFF). Feeds each frame's RAW WebXR pose (the reducer converts
 * frames itself) into the library handler, so an AR relocalization jump
 * (>1 m between consecutive frames) dispatches `arLoopClosureDetected` into
 * the session store — and therefore into the recording. This is the corpus
 * producer the pair-refresh T5 verdict is blocked on; see
 * GpsPlusSlamJs_Docs/docs/2026-07-06-recorder-loop-closure-detector-wiring-plan.md.
 */
function wireLoopClosureCapture(): void {
  loopClosureUnregisterFrame = registerXrFrameUpdate(() => {
    // Lazy (re)bind to the CURRENT store: `store` swaps per recording
    // session, and dispatching into a stale store would silently drop the
    // closures from the recording. A rebind starts with empty last-pose
    // memory — correct for a fresh session/frame.
    if (loopClosureHandlerBoundStore !== store) {
      loopClosureHandler = createLoopClosureHandler(store);
      loopClosureHandlerBoundStore = store;
    }
    // `getCurrentArPose()` is nulled by the framework on tracking loss and
    // only repopulated AFTER this callback ran on the recovery frame, so the
    // first pose the handler sees after a reset is genuinely fresh — a
    // recovery jump can never be misread as a loop closure.
    const pose = getCurrentArPose();
    if (!pose) {
      return;
    }
    loopClosureHandler!.processPose(
      [pose.position.x, pose.position.y, pose.position.z],
      [
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
      ]
    );
  });
}

/**
 * Reset main module state.
 * Exported for testing purposes to ensure test isolation.
 */
// eslint-disable-next-line complexity
export function resetMainState(): void {
  if (mapOverlay) {
    mapOverlay.dispose();
    mapOverlay = null;
  }
  if (cameraFollower) {
    cameraFollower.dispose();
    cameraFollower = null;
  }
  if (alignmentLerper) {
    alignmentLerper.dispose();
    alignmentLerper = null;
  }
  // Tear down the HUD tracking-quality subscription so it doesn't outlive the
  // AR session (prevents accumulating subscribers across enter-AR cycles).
  if (unsubscribeTrackingQuality) {
    unsubscribeTrackingQuality();
    unsubscribeTrackingQuality = null;
  }
  // Ref-point views (3D + map) — AR-scoped; detach the storeRef follower and
  // remove any drawn map markers.
  if (refPointViews) {
    refPointViews.unsubscribe();
    refPointViews = null;
  }
  // F3.5d — tear down frame-tile visualizer + drop cached frame blobs so
  // GPU textures and JPEG bytes don't outlive the AR session.
  if (unsubscribeFrameTiles) {
    unsubscribeFrameTiles();
    unsubscribeFrameTiles = null;
  }
  if (frameTileVisualizer) {
    frameTileVisualizer.dispose();
    frameTileVisualizer = null;
  }
  // Perf stats overlay — remove the panels so they don't linger (frozen) on
  // the setup screen after the AR session ends.
  if (statsOverlay) {
    statsOverlay.dispose();
    statsOverlay = null;
  }
  // Occupancy-grid teardown — stop feeding the grid and release the
  // instanced mesh once the AR session ends.
  if (unsubscribeOccupancyGrid) {
    unsubscribeOccupancyGrid();
    unsubscribeOccupancyGrid = null;
  }
  if (occupancyCubesVisualizer) {
    occupancyCubesVisualizer.dispose();
    occupancyCubesVisualizer = null;
  }
  occluderSinkHandle?.dispose();
  occluderSinkHandle = null;
  disposeLiveOccluder();
  disposeLoopClosureWiring();
  occupancyGrid = null;
  setOccupancyGrid(null);
  // Live QR teardown — stop capture, detach the producer + debug-viz subscriber.
  if (unsubscribeQrRecording) {
    unsubscribeQrRecording();
    unsubscribeQrRecording = null;
  }
  qrProducer = null;
  liveFrameBlobs.clear();
  recordingSessionHandlers.reset();
  refPointHandlers.reset();
  destroyConfirmDialog();
  folderManager.reset();
  replayHandlers.reset();
  // Phase 4: Dispose measurement UI and 3D visualization on session cleanup
  measurementUI?.dispose();
  measurementUI = null;

  if (unsubscribeMeasurementPoints) {
    unsubscribeMeasurementPoints();
    unsubscribeMeasurementPoints = null;
  }
  if (measurementPointVisualizer) {
    measurementPointVisualizer.dispose();
    measurementPointVisualizer = null;
  }
  setFolderSelected(false);
  setSaveLocationSelected(false);
}

/**
 * Set cached OPFS scenarios (for testing purposes).
 * Allows tests to simulate OPFS scenarios without re-initializing storage.
 */
export function setCachedOpfsScenariosForTesting(scenarios: string[]): void {
  folderManager.setCachedOpfsScenarios(scenarios);
}

/**
 * Load and display reference points (for testing purposes).
 * Delegates to folderManager.loadAndDisplayRefPoints.
 */
export function loadAndDisplayRefPoints(
  handle: FileSystemDirectoryHandle
): Promise<{ refPointCount: number; observationCount: number }> {
  return folderManager.loadAndDisplayRefPoints(handle);
}

/**
 * Clear the cached ref-point definitions across all OPFS scenarios so that
 * the next scenario load re-imports them from the read folder's *.zip
 * recordings. If a scenario is currently selected, immediately reload its
 * ref points so the user sees the freshly imported state without leaving
 * the start screen.
 *
 * Wired to the "Clear Reference Point Cache" button in the settings modal
 * (confirm dialog handled by settings-modal.ts).
 */
export async function handleClearRefPointCache(): Promise<void> {
  try {
    const result = await clearRefPointsCacheForAllScenarios();

    // If a scenario is already selected, force a re-import so the visualizers
    // and the H3 cache reflect the cleared state immediately.
    const currentHandle = getCurrentScenarioHandle();
    if (currentHandle) {
      try {
        await folderManager.loadAndDisplayRefPoints(currentHandle);
      } catch (err) {
        log.warn('Re-import after cache clear failed:', err);
        // Re-import failed — clear in-memory imported ref points so proximity
        // checks don't keep referring to stale entries from before the cache
        // was cleared.
        store.dispatch(setImportedRefPointEntries([]));
      }
    } else {
      // No active scenario — clear in-memory imported ref points so any
      // proximity checks don't keep referring to stale entries.
      store.dispatch(setImportedRefPointEntries([]));
    }

    const cleared = result.scenariosCleared;
    const errs = result.errors.length;
    const message =
      errs > 0
        ? `⚠️ Cleared ref-point cache for ${cleared} scenario${cleared === 1 ? '' : 's'} (${errs} failed)`
        : cleared === 0
          ? 'No cached ref points to clear'
          : `✅ Cleared ref-point cache for ${cleared} scenario${cleared === 1 ? '' : 's'}`;
    showToast(message);
    log.info(message, result);
  } catch (err) {
    log.error('Failed to clear ref-point cache:', err);
    showError('Failed to clear ref-point cache — see logs');
  }
}

/**
 * Get current replay session entries (for testing purposes).
 * Allows tests to verify scenario change populates the session list.
 */
export function getReplaySessionEntriesForTesting(): SessionEntry[] {
  return replayHandlers.getSessionEntries();
}

/**
 * Soft reset for starting a new recording without a page reload.
 *
 * Preserves:
 * - Read folder handle (so user doesn't re-select the folder)
 * - Imported reference points (loaded from the read folder)
 * - Recording options (user settings from localStorage)
 * - OPFS root/scenarios directory handles (storage stays initialized)
 * - Logger subscribers and buffer
 *
 * Resets:
 * - AR/WebXR session (ended — the setup screen requires Enter AR again, and
 *   initAR() throws on a live session, so a preserved session would make the
 *   first Enter AR after the reset fail; see
 *   GpsPlusSlamJs_Docs docs/2026-07-04-soft-reset-end-ar-session-plan.md)
 * - Store (fresh Redux store for new session)
 * - Session/scenario names
 * - Sync manager, trackers, map overlay
 * - OPFS session-level handles (actions/frames dirs)
 * - External save file handle (new ZIP per session)
 * - HUD state (shows setup modal, clears save location status)
 * - Session summary panel (hidden)
 *
 * Issue 4 (2026-02-06 user feedback): Retain read permission on new recording.
 */
export async function resetForNewRecording(): Promise<void> {
  log.info('Soft reset: starting new recording...');

  // --- Clean up recording-level state ---
  recordingSessionHandlers.cleanupForNewRecording();

  // Clean up map overlay
  if (mapOverlay) {
    mapOverlay.dispose();
    mapOverlay = null;
  }

  // End the WebXR session so the next Enter AR initializes cleanly (initAR
  // rejects while a session is live). Fires the framework session-end
  // callback with requestedByApp: true, which the system-session-end handler
  // deliberately ignores. Best-effort: a rejected end must not abort the
  // reset — endARSession() leaves the framework re-initialisable either way.
  try {
    await endARSession();
  } catch (err) {
    log.warn('Ending AR session during soft reset failed; continuing:', err);
  }

  // Reset recording-level counters
  gpsEventVisualizer.clearAll();

  // Fresh store for next session
  store = createNewStore();
  storeRef.set(store);

  // --- Reset storage (preserve OPFS root, clear session handles) ---
  resetForNewSession();
  resetExternalForNewRecording(); // clears save file handle, keeps read folder handle

  // --- Check if read folder permission is still valid ---
  const folderStillGranted = await hasReadFolderPermission();

  // --- Reset UI ---
  hideSessionSummary();
  resetUIForNewRecording({ keepFolder: folderStillGranted });

  // Issue 7 Phase 2: Reset navigation state to setup screen
  replaceScreenState('setup');

  // If folder permission is still valid, update folder status display
  if (folderStillGranted) {
    // Defensive: getReadFolderHandle() should be non-null when folderStillGranted
    // is true, but we guard to satisfy TypeScript and tolerate future refactors.
    const folderHandle = getReadFolderHandle();
    if (folderHandle) {
      const refPointCount = selectImportedKnownAnchors(
        store.getState().refPoints
      ).length;
      updateFolderStatus(`✅ ${folderHandle.name} (${refPointCount} ref pts)`);
    }
  } else {
    // Permission lost — clear imported ref points too since they came from that folder
    store.dispatch(setImportedRefPointEntries([]));
  }

  log.info(
    `Soft reset complete. Folder permission ${folderStillGranted ? 'retained' : 'lost'}.`
  );
}

/**
 * Get the map overlay instance.
 * Exported for testing purposes.
 */
export function getMapOverlay(): LeafletMapOverlay | null {
  return mapOverlay;
}

/**
 * Read session notes from the UI textarea.
 * Returns trimmed value, or empty string if not found or empty.
 */
export function getSessionNotes(): string {
  const textarea = document.getElementById(
    'session-notes'
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    return '';
  }
  return textarea.value.trim();
}

/**
 * Wait for zero reference to be set in the store.
 * Returns when gpsData.zero is available, or null if timeout.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds (default 30s)
 * @returns The zero reference if set, or null if timeout
 */
export async function waitForZeroReference(
  timeoutMs: number = 30000
): Promise<LatLong | null> {
  // Check if already set
  const currentState = store.getState();
  if (currentState.gpsData?.zero) {
    return currentState.gpsData.zero;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.gpsData?.zero && !resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(state.gpsData.zero);
      }
    });

    // Timeout fallback
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        resolve(null);
      }
    }, timeoutMs);
  });
}

/**
 * Collect error messages from a failure tracker and reset it.
 * Extracts the duplicated tracker-cleanup pattern from handleStopRecording.
 *
 * @param tracker - The tracker instance (or null if not initialized)
 * @param label - Human-readable label for the error message (e.g. "image write failures")
 * @param errors - Array to push error messages into
 */
export function collectTrackerErrors(
  tracker: { getFailureCount(): number; reset(): void } | null,
  label: string,
  errors: string[]
): void {
  if (!tracker) {
    return;
  }
  const failureCount = tracker.getFailureCount();
  if (failureCount > 0) {
    errors.push(`${failureCount} ${label}`);
  }
  tracker.reset();
}

// --- End testing exports ---

async function main(): Promise<void> {
  log.info('Initializing...');

  // Load recording options from localStorage (before any other init)
  recordingOptions = loadRecordingOptions();
  log.info('Recording options loaded:', recordingOptions);

  // Apply Chromium camera-access tab-crash workaround if opted in. Must run
  // before any WebXR session is created. Three.js reads the relevant
  // prototype members lazily when the first session starts, so doing this at
  // bootstrap (before initAR) is sufficient.
  if (
    recordingOptions.arCrashIsolation.applyChromiumProjectionLayerWorkaround
  ) {
    const workaroundResult = applyChromiumProjectionLayerWorkaround();
    log.info('Applied Chromium projection-layer workaround:', workaroundResult);
  }

  // Initialize settings modal with callback to update options
  // This must happen early so settings button works even if WebXR fails
  initSettingsModal(
    (newOptions) => {
      recordingOptions = newOptions;
      log.info('Recording options updated:', recordingOptions);
    },
    () => handleClearRefPointCache()
  );

  // Initialize ref point picker modal content BEFORE WebXR check
  // This allows E2E tests to work even without WebXR support
  const pickerModal = document.getElementById('ref-point-picker-modal');
  if (pickerModal) {
    pickerModal.innerHTML = createRefPointPickerHtml();
  }

  // Register browser back-button handler for modals + screens (Issue 7 Phase 1+2)
  // - Modal: back while ref-point picker is open → cancel picker
  // - AR: back from AR_READY → return to setup
  // - Recording: back is consumed (prevented) to avoid data loss
  // - Summary: back → soft reset to setup
  initNavigation(
    {
      onCloseModal: () => {
        if (isRefPointPickerVisible()) {
          cancelRefPointPicker();
        }
      },
      onBackToSetup: () => {
        showSetupModal();
        log.info('Back from AR — returned to setup');
      },
      onBackFromSummary: () => {
        log.info('Back from summary — triggering soft reset');
        void resetForNewRecording();
      },
      onBackDuringRecording: () => {
        void recordingSessionHandlers.handleBackDuringRecording();
      },
    },
    // Bug 9 fix: pass a getter so navigation always resolves the current store
    // (store is replaced on each soft reset via createNewStore())
    () => store
  );

  // Expose ref point picker API on window for E2E testing
  // This allows Playwright tests to trigger the real application behavior
  window.refPointPickerApi = {
    showRefPointPicker,
  };

  // Initialize UI event handlers BEFORE WebXR check
  // This ensures change handlers work in E2E tests even without WebXR
  initUI({
    onOpenFolder: () => folderManager.handleOpenFolder(),
    onChooseSaveLocation: () => folderManager.handleChooseSaveLocation(),
    onEnterAR: handleEnterAR,
    onStartRecording: async () => {
      await recordingSessionHandlers.handleStartRecording();
      // Starting a recording swaps the Redux store. Rebind the measurement HUD
      // to that new store instead of leaving it subscribed to AR_READY state.
      measurementUI?.dispose();
      measurementUI = createMeasurementUI({
        container: document.getElementById('app') as HTMLElement,
        arCanvas: document.getElementById('app') as HTMLElement,
        handlers: measurementPointHandlers,
        store,
        getScenarioId: () => folderManager.getCurrentScenarioName(),
        onConfirmIntegrated: (mode) => integratedMarkRefPoint(undefined, mode),
      });
      measurementUI.show();
    },
    onStopRecording: async () => {
      measurementUI?.dispose();
      measurementUI = null;
      await recordingSessionHandlers.handleStopRecording();
    },
    onMarkRefPoint: () => integratedMarkRefPoint(),
    onMarkNewRefPoint: () => integratedMarkRefPoint({ forceNew: true }),
    onToggleMap: handleToggleMap,
    onMapZoomIn: handleMapZoomIn,
    onMapZoomOut: handleMapZoomOut,
    onScenarioChange: (name: string) =>
      void folderManager.handleScenarioChange(name),
    onRequestPermissions: handleRequestPermissions,
  });

  // Initialize session summary panel (shown after recording stops)
  initSessionSummary({
    onNewRecording: () => {
      // Issue 4: Soft reset instead of page reload to retain read folder permission
      void resetForNewRecording();
    },
    onViewLogs: () => {
      // Issue #5: Show log panel from summary screen
      showLogPanel();
    },
  });

  // Initialize log panel (tap status to show, or from summary)
  initLogPanel();

  // Initialize toast notification system (Issue #1 Part B)
  initToast();

  // Auto-initialize OPFS storage (Issue 1a - 2026-01-27 user feedback)
  // This replaces the confusing "Select folder" button that did nothing after OPFS migration
  try {
    const scenarios = await initStorage();
    folderManager.setCachedOpfsScenarios(scenarios);
    populateScenarios(scenarios);
    updateStorageStatus('Ready', true);
    log.info('OPFS storage initialized, found scenarios:', scenarios);
  } catch (err) {
    log.error('OPFS storage initialization failed:', err);
    updateStorageStatus('Error', false);
    showError('Storage initialization failed. Please refresh the page.');
  }

  // Check all permissions early and update UI
  // This provides immediate feedback on what's available/needed
  const initialPermissions = await checkAllPermissions();
  updatePermissionStatus(initialPermissions);

  // Subscribe to out-of-band permission changes so a user flipping
  // location/camera in browser settings is reflected in the setup modal
  // without requiring a page reload. See
  // docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md (Issue 2).
  subscribePermissionChanges((result) => {
    updatePermissionStatus(result);
    if (result.allMandatoryReady) {
      updateStatus('Ready - Configure scenario');
    }
  });

  // Update status based on permission state
  if (!initialPermissions.webxr.supported) {
    // Desktop browser: WebXR not available. Switch to replay mode
    // instead of showing a dead-end error (replay-mode design doc, Issue 1).
    stopGpsWatch(); // Clean up any GPS warm-up watch (Bug 5)
    replayHandlers.setIsReplayMode(true);
    switchToReplayMode();
    // D1 (2026-06-16 user feedback, Finding 1): explain *why* recording is
    // unavailable on this platform (typically iOS, which lacks immersive-ar)
    // instead of silently landing on the replay screen with no guidance.
    showUnsupportedPlatformNotice();
    initReplayUI({
      onScenarioChange: (name: string) =>
        void replayHandlers.handleReplayScenarioChange(name),
      onSessionSelect: (index: number) =>
        void replayHandlers.handleReplaySessionSelect(index),
      onStartReplay: (speed: number) =>
        void replayHandlers.handleStartReplay(speed),
      onPlayPause: () => replayHandlers.handleReplayPlayPause(),
      onSpeedChange: (speed: number) =>
        replayHandlers.handleReplaySpeedChange(speed),
      onCameraToggle: () => replayHandlers.handleReplayCameraToggle(),
      onMapToggle: () => replayHandlers.handleReplayMapToggle(),
      onMapZoomIn: () => replayHandlers.handleReplayMapZoomIn(),
      onMapZoomOut: () => replayHandlers.handleReplayMapZoomOut(),
      onRestart: () => void replayHandlers.handleReplayRestart(),
      onSeek: (actionIndex: number) =>
        void replayHandlers.handleReplaySeek(actionIndex),
      onStepForward: () => {
        const idx = replayHandlers.getCurrentActionIndex();
        void replayHandlers.handleReplaySeek(idx + 1);
      },
      onStepBackward: () => {
        const idx = replayHandlers.getCurrentActionIndex();
        if (idx > 0) {
          void replayHandlers.handleReplaySeek(idx - 1);
        }
      },
    });
    updateStatus('Replay Mode — Open a recordings folder');
    // In replay mode the recordings folder is the PRIMARY action (you browse
    // recordings from it), so surface the otherwise-collapsed folder section.
    setFolderImportExpanded(true);
    log.info('WebXR not supported — entered replay mode');
  } else if (initialPermissions.allMandatoryReady) {
    updateStatus('Ready - Configure scenario');
  } else {
    updateStatus('Grant permissions to continue');
  }
}

/**
 * Update the storage status display in the UI.
 */
function updateStorageStatus(text: string, success: boolean): void {
  const statusEl = document.getElementById('storage-status-text');
  if (statusEl) {
    statusEl.textContent = success ? `✅ ${text}` : `❌ ${text}`;
    statusEl.className = success
      ? 'text-sm text-green-400'
      : 'text-sm text-red-400';
  }
}

/**
 * Handle the "Grant Permissions" button click.
 * Requests all pending permissions and updates the UI.
 */
async function handleRequestPermissions(): Promise<void> {
  log.info('Requesting permissions...');
  updateStatus('Requesting permissions...');

  try {
    const result = await requestAllPermissions();
    updatePermissionStatus(result);

    if (result.allMandatoryReady) {
      updateStatus('Ready - Configure scenario');
    } else {
      // Some permissions were denied
      const deniedList: string[] = [];
      if (result.geolocation.granted === false) {
        deniedList.push('Location');
      }
      if (result.camera.granted === false) {
        deniedList.push('Camera');
      }

      if (deniedList.length > 0) {
        showError(
          `${listFormatter.format(deniedList)} access denied. Please enable in browser settings.`
        );
      } else {
        updateStatus('Some permissions pending - tap Grant Permissions');
      }
    }

    // Issue 4 (2026-02-27 user feedback): Start GPS warm-up as soon as
    // geolocation permission is confirmed. This primes the GPS hardware
    // so that waitForZeroReference resolves faster when recording starts.
    // startGpsWatch is idempotent, so calling it again in handleStartRecording
    // with the real handler safely replaces this warm-up watch.
    if (result.geolocation.granted) {
      log.info('Geolocation granted — starting GPS warm-up watch');
      startGpsWatch(() => {
        /* warm-up: discard positions */
      });
    }
  } catch (err) {
    log.error('Permission request failed:', err);
    showError('Failed to request permissions. Please try again.');
  }
}

async function handleEnterAR(): Promise<void> {
  try {
    updateStatus('Starting AR session...');

    // Request orientation permission (required on iOS)
    // Field Test Readiness Issue #2: Check return value and warn user
    const orientationGranted = await requestOrientationPermission();
    if (!orientationGranted) {
      // Don't block AR start, but warn user about missing compass data
      log.warn('Orientation permission denied - compass data unavailable');
      showError(
        'Compass permission denied. Device orientation will be unavailable.'
      );
    }

    // Set up depth capture callback BEFORE initAR (sampler is created during init)
    // Field Test Readiness Issue #8: Pass unavailable callback to warn user
    setDepthCaptureCallback(handleDepthSampleCaptured, () => {
      log.warn('Depth sensing unavailable - device may not support it');
      showError(
        'Depth sensing unavailable. Your device may not support this feature.'
      );
    });

    // Live QR (opt-in): register the camera-frame callback BEFORE initAR (the
    // frame source is created during init). Only when QR is enabled, so a
    // disabled session never builds the source. The producer is created after
    // initAR (handleEnterAR's arWorldGroup block) and forwarded frames here.
    if (recordingOptions.qr.enabled) {
      setCameraFrameCallback((image) => qrProducer?.offerFrame(image));
    }

    // Set up tracking lost callback to warn user when AR tracking fails
    setTrackingLostCallback(() => {
      updateArInfo('⚠️ LOST');
      // Stop feeding poses + forget the last pose: the pose jump across a
      // loss must never be recorded as a loop closure.
      loopClosureHandler?.setTrackingActive(false);
      showError(
        'AR tracking lost. Try moving to a well-lit area with more visual features.'
      );
    });

    // Wire tracking restart detection BEFORE initAR() — this enables the
    // tracking slice and XRReferenceSpace reset event listener.
    // When tracking resumes after an origin reset (Case 2), the store's
    // odometryTrackingRestarted reducer clears stale data and accumulates
    // offsets so alignment continues correctly across resets.
    setTrackingStore(store);
    setTrackingCallbacks((payload) => {
      store.dispatch(odometryTrackingRestarted(payload));
      // Origin reset: clear the loop-closure handler's last-pose memory
      // (deactivate ⇒ reset) before re-arming — the reference-space jump is
      // an origin correction, not a relocalization loop closure.
      loopClosureHandler?.setTrackingActive(false);
      loopClosureHandler?.setTrackingActive(true);
      updateArInfo('');
      log.info('AR tracking restarted — alignment correction dispatched');
    });

    // Wire seamless recovery callback (Case 1: same coordinate frame).
    // Clears the "LOST" UI warning without dispatching alignment correction.
    setTrackingRecoveredCallback(() => {
      loopClosureHandler?.setTrackingActive(true);
      updateArInfo('');
      log.info('AR tracking recovered (same coordinate frame)');
    });

    // Live loop-closure capture (experimental, default OFF): dispose any
    // previous wiring, then register the per-frame feed only when the
    // operator opted in — OFF keeps the frame loop untouched (zero cost).
    disposeLoopClosureWiring();
    if (recordingOptions.loopClosureDebug.detectorEnabled) {
      wireLoopClosureCapture();
    }

    // F3 (2026-07-04): react to a SYSTEM-initiated session end (Android back
    // gesture ends the XRSession directly — uncancelable). Mid-recording this
    // auto-stops + saves and lands on the summary with a toast; in AR_READY it
    // returns to setup. The framework clears this callback on every session
    // end, so it is re-registered here on each Enter AR.
    const systemSessionEndHandler = createSystemSessionEndHandler({
      getCurrentScreen,
      stopRecording: () => recordingSessionHandlers.handleStopRecording(),
      replaceScreen: replaceScreenState,
      showSetupUi: showSetupModal,
      showToast: (message) => showToast(message),
      showError,
    });
    // Fire-and-forget: the handler resolves its own errors (showError); the
    // framework callback contract is synchronous.
    setSessionEndCallback((info) => {
      void systemSessionEndHandler(info);
    });

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      throw new Error('Missing #app container element');
    }
    // Live depth occluder (opt-in, off by default): request the
    // `cpu-optimized` depth-sensing feature for the live occluder even when
    // depth *recording* is off, so the session negotiates the depth stream the
    // occluder consumes. The render-side integration (the full-screen
    // DepthOccluder fed per frame) is wired below once arWorldGroup exists; its
    // on-device occlusion quality is still being tuned.
    await initAR(appContainer, recordingOptions.arCrashIsolation, {
      requestDepthOcclusion: recordingOptions.occupancy.liveOcclusion === true,
    });

    // Set up image capture callback (must be done after AR init)
    // Issue #11: Pass onCaptureFailed callback to track capture failures
    // User feedback: Pass onSuspiciousImage callback to log black/empty frames
    setImageCaptureCallback(
      handleImageCaptured,
      getScreenRotation,
      () => recordingSessionHandlers.recordCaptureFailure(),
      (blobSize: number, frameIndex: number) => {
        // Log suspicious images so they appear in the expandable log panel
        log.error(
          `Suspicious image detected at frame ${frameIndex}: ` +
            `size ${blobSize} bytes - image may be black/empty. ` +
            `This can occur when WebGL hasn't composited the frame yet.`
        );
      }
    );

    // Issue 8: Create CameraFollower at scene root (not arWorldGroup)
    // The follower tracks the camera position but stays GPS-aligned (identity rotation),
    // so the map and compass cubes don't rotate with the camera or alignment matrix.
    const arWorldGroup = getArWorldGroup();
    const arScene = getScene();
    if (arWorldGroup && arScene) {
      // Issue 4: Create alignment lerper for smooth alignment transitions
      alignmentLerper = createAlignmentLerper(arWorldGroup);

      cameraFollower = createCameraFollower(arScene);

      // Live debug-overlay visibility (recording-options `visualization`, read
      // ONCE here at Enter-AR — toggling mid-session applies on the next
      // Enter-AR, not retroactively; replay is never gated). Finding B / DB-2 of
      // GpsPlusSlamJs_Docs/docs/2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md.
      const viz = recordingOptions.visualization;

      // Perf stats overlay (Step 0 of the 2026-07-03 long-session fps plan).
      // Teardown is unconditional (turning the toggle off must remove a prior
      // cycle's panels); creation is gated. Mounted into the #app dom-overlay
      // root so it composites over the AR view; advanced once per XR frame in
      // the setFrameCallback tick below. Best-effort: a failure must not
      // break the AR session.
      statsOverlay?.dispose();
      statsOverlay = null;
      if (viz.statsOverlay) {
        try {
          statsOverlay = createStatsOverlay(appContainer);
        } catch (err) {
          log.warn('Stats overlay skipped; session continues without it', err);
        }
      }

      // Compass cubes — recorder-side skip. Nothing non-visual depends on them.
      if (viz.compassCubes) {
        createGpsCompassCubes(cameraFollower.object3D);
      }

      // GPS+VIO alignment spheres — NOT skipped (their snapshot positions feed
      // the session-summary map at stop), only hidden via the framework
      // visibility API. Live only; replay keeps them visible because clearAll
      // resets the shared singleton's visibility on each store swap.
      gpsEventVisualizer.setVisible(viz.gpsAlignmentMarkers);

      // Ref-point views (3D spheres + live-map markers) — AR-scoped and
      // store-swap-following via storeRef (round-3 feedback 2026-07-05:
      // previously session-scoped, so imports finishing before the first
      // recording filled the store with no view subscribed). Dispose-first
      // on re-enter, same leak-guard pattern as the layers below.
      refPointViews?.unsubscribe();
      refPointViews = wireRefPointViews(storeRef, {
        visualizer: refPointVisualizer,
        getMap: () => mapOverlay?.getLeafletMap() ?? null,
      });

      // F3.5d — wire the frame-tile visualizer into the live AR scene so
      // captured frames appear as textured planes during recording, using
      // the same listener+visualizer stack as replay. Best-effort: failures
      // must not break the AR session.
      try {
        // Dispose any frame-tile wiring left over from a prior enter-AR
        // cycle (handleEnterAR runs again on back-to-setup → Enter AR).
        // Without this the old storeRef subscriber stays attached and the
        // previous visualizer's GPU textures are orphaned — same leak class
        // as the tracking-quality subscription disposed below.
        unsubscribeFrameTiles?.();
        unsubscribeFrameTiles = null;
        frameTileVisualizer?.dispose();
        frameTileVisualizer = null;

        // Gate creation on the toggle (teardown above stays unconditional so
        // turning the overlay off cleanly removes a prior cycle's tiles). The
        // live frame-blob cache is populated in handleImageCaptured,
        // independent of this wiring, so skipping it never affects capture.
        if (viz.frameTiles) {
          // Parent under arWorldGroup (NOT the scene root): the selector
          // emits raw-WebXR poses, so tiles must ride the camera's
          // alignment × WEBXR_TO_NUE chain. See the followup frame-check doc.
          // maxTiles: LIVE-ONLY FIFO cap (Step 4, 2026-07-03 fps plan) — the
          // replay wiring deliberately omits it so coverage auditing sees the
          // full recorded path.
          frameTileVisualizer = new FrameTileVisualizer(arWorldGroup, {
            maxTiles: recordingOptions.frameTileDisplay.maxTiles,
          });
          // D7-resolution: downscale the live display texture by the
          // configured frameTileDisplay divisor (default ÷2) to cut per-tile
          // GPU memory. Read once here at Enter-AR alongside the other viz
          // settings; capture quality (images.resolutionDivisor) is untouched.
          const frameTileDivisor = recordingOptions.frameTileDisplay.divisor;
          unsubscribeFrameTiles = wireFrameTileSubscribers({
            storeRef,
            visualizer: frameTileVisualizer,
            blobSource: (imageFile) =>
              Promise.resolve(liveFrameBlobs.get(imageFile) ?? null),
            decodeTexture: (blob) => decodeFrameTexture(blob, frameTileDivisor),
            onError: (err, imageFile) => {
              log.warn(`Frame tile decode failed for "${imageFile}"`, err);
            },
          });
        }
      } catch (err) {
        log.warn(
          'Frame tile visualizer wiring skipped; recording continues without frame tiles',
          err
        );
      }

      // Occupancy-grid cubes — voxelized depth geometry in the live AR
      // scene (port plan Iter 5). The cells are raw-WebXR coordinates, so
      // the visualizer hangs off arWorldGroup (NOT the scene root) and
      // rides the alignment like the camera does (Iter 7 reparenting fix).
      // Best-effort: failures must not break the AR session.
      try {
        // Dispose any occupancy-grid wiring left over from a prior enter-AR
        // cycle (handleEnterAR runs again on back-to-setup → Enter AR).
        // Without this the old storeRef swap-listener stays attached forever
        // and the previous visualizer's instanced-mesh GPU resources are
        // orphaned — same leak class as the tracking-quality subscription
        // disposed below. The grid is a plain data structure (no dispose).
        unsubscribeOccupancyGrid?.();
        unsubscribeOccupancyGrid = null;
        occupancyCubesVisualizer?.dispose();
        occupancyCubesVisualizer = null;
        occluderSinkHandle?.dispose();
        occluderSinkHandle = null;
        occupancyGrid = null;
        setOccupancyGrid(null);

        // Voxel size is a user setting (recording-options `occupancy.cellSizeM`,
        // clamped 1–20 cm); read it at construction so a changed value applies
        // on the next Enter-AR. Same source main.ts uses for arCrashIsolation.
        occupancyGrid = new OccupancyGrid({
          cellSizeM: recordingOptions.occupancy.cellSizeM,
        });
        // Publish the single live grid so non-visualizer consumers (the COLMAP
        // ZIP contributor, future floor/nav-mesh builders) can read it without a
        // one-off reference. Mirrors main.ts's `occupancyGrid` var exactly; the
        // teardown paths below clear it back to null (COLMAP export plan Q2).
        setOccupancyGrid(occupancyGrid);

        // The occupancyCubes toggle gates ONLY the rendered debug cubes — the
        // grid itself is always built and fed, because COLMAP export and other
        // non-visualizer consumers read it via getOccupancyGrid(). When the
        // overlay is off we wire a no-op sink so the grid still folds in every
        // depth sample without allocating the cube InstancedMesh.
        let occupancyVisualizerSink: {
          refresh(grid: OccupancyGrid): void;
          clear(): void;
        };
        if (viz.occupancyCubes) {
          occupancyCubesVisualizer = new OccupancyCubesVisualizer(
            arWorldGroup,
            // Noise filter: only render voxels seen ≥ minConfidence times
            // (recording-options `occupancy.minConfidence`, default 3). Read
            // here so a changed value applies on the next Enter-AR, same as
            // cellSizeM above.
            { minObservations: recordingOptions.occupancy.minConfidence }
          );
          occupancyVisualizerSink = occupancyCubesVisualizer;
        } else {
          occupancyVisualizerSink = { refresh: () => {}, clear: () => {} };
        }

        // Persistent depth-only occluder (ON by default). When on, it
        // re-meshes the grid on the same throttle as the cubes and writes depth
        // (no color) under arWorldGroup so real geometry hides virtual content
        // placed behind it. The shared factory (occluder-sink.ts — one wiring
        // for live AND replay) snapshots the SAME minConfidence floor the
        // cubes/COLMAP use, so the three consumers can't silently diverge; its
        // handle owns mesh + worker teardown (endARSession disposes it).
        let occluderSink: OccluderSink | undefined;
        if (recordingOptions.occupancy.persistentOcclusion) {
          occluderSinkHandle = createOccluderSink(
            arWorldGroup,
            recordingOptions.occupancy
          );
          occluderSink = occluderSinkHandle.sink;
        }
        // With any camera-relative window active (the cubes window by
        // default; the occluder when occluderRadiusM > 0), a settled grid
        // must still re-render when the camera moves — ε = one chunk edge
        // (16 cells; 2.4 m at the 0.15 m default). See the wirer's
        // revision-guard docs (Step 2 correctness detail).
        const anyWindowedConsumer =
          viz.occupancyCubes ||
          (recordingOptions.occupancy.persistentOcclusion &&
            recordingOptions.occupancy.occluderRadiusM > 0);
        unsubscribeOccupancyGrid = wireOccupancyGridSubscribers({
          storeRef,
          grid: occupancyGrid,
          visualizer: occupancyVisualizerSink,
          occluder: occluderSink,
          refreshOnCameraMoveM: anyWindowedConsumer
            ? 16 * recordingOptions.occupancy.cellSizeM
            : undefined,
          // Tie the cube-refresh throttle to the depth-sample cadence so a
          // faster `depth.intervalMs` (e.g. 500 ms) isn't capped at the old
          // hardcoded 1 Hz. At the default 1000 ms this equals the previous
          // DEFAULT_REFRESH_INTERVAL_MS, so default recordings are unchanged
          // (2026-06-22 cube cadence/locality plan §2).
          refreshIntervalMs: recordingOptions.depth.intervalMs,
          onError: (err) => {
            log.warn('Occupancy grid update failed', err);
          },
          // Cells-over-time telemetry (Step 0 of the 2026-07-03 long-session
          // fps plan): one line per ~30 s so a log export correlates grid
          // growth with the stats overlay's fps trend.
          onGridSize: (cells) => {
            log.info(`[OccupancyGrid] ${cells} cells`);
          },
        });
      } catch (err) {
        log.warn(
          'Occupancy grid wiring skipped; recording continues without depth cubes',
          err
        );
      }

      // Live CPU-depth occluder (opt-in — occupancy.liveOcclusion). The
      // full-screen depth-write path (v1): each frame we read the full depth and
      // feed it to the occluder, whose clip-space mesh writes gl_FragDepth so the
      // real surface hides ALL virtual content behind it — like the persistent
      // mesh, but for the surface the camera sees *this* frame. Best-effort: a
      // wiring failure (or a per-frame throw — the registry is try/catch-safe per
      // callback) must never break the AR session. The on-device occlusion render
      // is still being brought up, so the checkbox stays experimental.
      try {
        disposeLiveOccluder(); // guard a re-enter (mirrors occluderSinkHandle teardown)
        if (recordingOptions.occupancy.liveOcclusion) {
          const occluder = new DepthOccluder();
          liveOccluder = occluder;
          // The mesh's vertex shader ignores transforms, but parenting under
          // arWorldGroup keeps it in the AR render pass alongside the content.
          arWorldGroup.add(occluder.getOcclusionMesh());
          liveOccluderUnregisterFrame = registerXrFrameUpdate(
            ({ frame, referenceSpace }) => {
              const pose = frame.getViewerPose(referenceSpace);
              const depthInfo = getDepthInfoFromFrame(frame, pose);
              if (depthInfo) occluder.update(depthInfo);
            }
          );
        }
      } catch (err) {
        log.warn(
          'Live depth occluder wiring skipped; recording continues without it',
          err
        );
      }

      // Live QR RAW recording + WS-5 debug viz (opt-in). Gated on the operator
      // setting; the camera-frame callback was registered before initAR above.
      // Best-effort: a wiring failure must not break the AR session. Disposed
      // first to avoid leaking the producer/subscriber across enter-AR cycles
      // (same leak class as the occupancy/tracking-quality wiring).
      try {
        unsubscribeQrRecording?.();
        unsubscribeQrRecording = null;
        qrProducer = null;
        if (recordingOptions.qr.enabled) {
          unsubscribeQrRecording = wireQrRecording({
            storeRef,
            getArWorldGroup,
            qr: recordingOptions.qr,
            setProducer: (producer) => {
              qrProducer = producer;
            },
          });
        }
      } catch (err) {
        log.warn(
          'QR recording wiring skipped; recording continues without QR capture',
          err
        );
      }
    }

    // Measurement point visualizer
    const measScene = getScene();
    if (arWorldGroup && measScene) {
      unsubscribeMeasurementPoints?.();
      measurementPointVisualizer?.dispose();
      measurementPointVisualizer = new MeasurementPointVisualizer(
        arWorldGroup,
        measScene
      );
      unsubscribeMeasurementPoints = wireMeasurementPointSubscribers(
        storeRef,
        measurementPointVisualizer
      );
    }

    // Issue #14: Map overlay is created lazily on first toggle (not here)
    // Register per-frame callback for smooth map position updates and follower tracking
    // This is called every XR frame (~60+ Hz) rather than on GPS events (~1 Hz)
    let lastFrameTime = performance.now();
    setFrameCallback(() => {
      const now = performance.now();
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      // Advance the perf stats panels (FPS/ms/MB) once per rendered XR frame.
      statsOverlay?.update();

      // Update alignment lerper (Issue 4) — interpolate arWorldGroup.matrix
      alignmentLerper?.update(dt);

      // Update follower position (lerp toward camera world position)
      const camera = getCamera();
      if (cameraFollower && camera) {
        cameraFollower.update(camera, dt);
      }

      if (mapOverlay?.isVisible()) {
        // Pass the live render camera so heading-up rotation is computed
        // relative to where the user is actually looking (the same camera the
        // CSS3D overlay is composited through). See the 2026-06-29 plan.
        mapOverlay.updatePosition(dt, camera ?? undefined);
      }
    });

    // Issue #2 fix: Update status to match AR_READY state per Application State Machine
    updateStatus('AR active - Tap Start to record');

    // Subscribe to tracking quality changes so the HUD reflects alignment
    // health. Goes through `storeRef` so the subscription follows every
    // store swap (Start Recording / replay) — see F1 in
    // `docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md`.
    //
    // Dispose any prior subscription first: `handleEnterAR` can run multiple
    // times per page load (back to setup → Enter AR again), and each call
    // would otherwise append a fresh `storeRef` + `store` subscriber that is
    // never cleaned up, leaking memory and firing redundant HUD updates.
    unsubscribeTrackingQuality?.();
    unsubscribeTrackingQuality = subscribeHudToTrackingQuality({
      storeRef,
      updateHud: updateTrackingQuality,
    });

    // Issue 7 Phase 2: Push AR screen state for back-button navigation
    pushScreenState('ar');

    // Measurement UI is mounted only after Start Recording. The specification
    // defines measurement marking as a recording-time workflow; disposing it
    // here also prevents AR_READY taps from creating rays.
  } catch (err) {
    log.error('AR init failed:', err);
    // Field Test Readiness Issue #4: Provide specific error messages
    const userMessage = getXrErrorMessage(err);
    showError(userMessage);
    // Issue #10: If initAR succeeded but a later step threw, the XR session
    // is left running with incomplete wiring. Tear it down to free GPU
    // resources and avoid a broken half-initialized state.
    try {
      await endARSession();
    } catch (cleanupErr) {
      log.error(
        'Failed to clean up AR session after init failure:',
        cleanupErr
      );
    }
  }
}

/**
 * Get current device screen rotation in degrees (0, 90, 180, 270).
 * Used for image capture metadata.
 */
function getScreenRotation(): number {
  // Use Screen Orientation API if available
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  // Fallback to deprecated window.orientation
  if (typeof window.orientation === 'number') {
    // window.orientation is deprecated but provides a fallback. It may return
    // negative values (e.g., -90), so we normalize it to the 0-360 range.
    const angle = (window.orientation + 360) % 360;
    return angle;
  }
  return 0;
}

/**
 * Handle a captured image - dispatch action and write to disk.
 *
 * DESIGN NOTE: We intentionally dispatch the action BEFORE awaiting the file write.
 * This ensures actions are logged in chronological capture order. If we awaited
 * writeFrame first, slower writes could complete after faster ones, causing
 * out-of-order actions (e.g., frame-11 dispatched before frame-10).
 *
 * The tradeoff is that a failed write leaves a dangling file reference in the
 * action log. This is acceptable because:
 * 1. Write failures are rare (permissions validated at session start)
 * 2. Failures are logged for debugging
 * 3. Replay can gracefully skip missing files with a warning
 */
function handleImageCaptured(image: CapturedImage): void {
  // Issue #11: Record successful capture (resets consecutive failure counter)
  recordingSessionHandlers.recordCaptureSuccess();

  // Update live frame counter in HUD so user can see captures are happening
  updateFrameCount(image.frameIndex);

  const filename = `frame-${String(image.frameIndex).padStart(6, '0')}.jpg`;

  // F3.5d — cache the blob BEFORE dispatch so the frame-tile listener
  // (F3.2) and visualizer (F3.5d wire-up) can resolve it synchronously
  // when they react to the add2dImage action.
  liveFrameBlobs.set(`${SESSION_IMAGES_DIR}/${filename}`, image.blob);

  // Dispatch first to preserve chronological action order (see DESIGN NOTE above)
  // Raw WebXR position — the reducer applies WebXR→NUE conversion
  store.dispatch(
    add2dImage({
      imageFile: `${SESSION_IMAGES_DIR}/${filename}`,
      position: [image.position.x, image.position.y, image.position.z],
      rotation: [
        image.rotation.x,
        image.rotation.y,
        image.rotation.z,
        image.rotation.w,
      ],
      screenRotation: image.screenRotation,
      capturedAt: image.timestamp,
      // Persist the encoded pixel dimensions so the frame-tile visualizer can
      // render each tile at its true aspect ratio (D1 of the 2026-06-13
      // frame-tile feedback). Field-by-field rebuild per the payload-rebuild
      // field-drop audit — undefined for captures that lack dimensions.
      width: image.width,
      height: image.height,
    })
  );

  // Write the image blob to disk asynchronously
  // Track failures to warn user if storage becomes unavailable
  // A1 fix: route through store.writeFrame() so NullStorageBackend works in replay
  store
    .writeFrame(image.blob, image.frameIndex)
    .then(() => recordingSessionHandlers.recordWriteSuccess())
    .catch((err) => {
      log.error('Failed to write frame:', err);
      recordingSessionHandlers.recordWriteFailure(err);
    });
}

/**
 * Handle a captured depth sample - dispatch action for replay.
 * Depth samples are stored directly in Redux actions (not separate files)
 * because at 1 Hz with ~9 points per sample, the data is lightweight (~1-2 KB).
 * This enables integration tests to process depth data during replay.
 */
function handleDepthSampleCaptured(sample: DepthSample): void {
  // Dispatch the sampler's payload AS-IS. Re-building it field-by-field
  // silently dropped the optional projectionMatrix when it was added (see
  // 2026-06-12-payload-rebuild-field-drop-audit.md F1) — without it the
  // occupancy grid cannot unproject the sample's points.
  store.dispatch(recordDepthSample(sample));
  log.info(`Recorded depth sample with ${sample.points.length} points`);
}

function handleToggleMap(): void {
  // Issue #14: Lazy map overlay creation - create on first toggle
  if (!mapOverlay) {
    const scene = getScene();
    const camera = getCamera();
    if (!scene || !camera) {
      log.warn('Map overlay not initialized - enter AR first');
      showError('Enter AR session before using the map');
      return;
    }

    mapOverlay = new LeafletMapOverlay(scene, camera, {
      mapParent: cameraFollower?.object3D,
      // Heading-up minimap rotation: live-only preference (default on), read
      // here at overlay creation. Replay keeps north-up. See the 2026-06-29 plan.
      headingUp: recordingOptions.visualization.headingUpMap,
    });
    log.info('Map overlay created lazily on first toggle');
  }

  // Ensure map has GPS position before showing
  const state = store.getState();
  const lastGpsPoint = state.gpsData?.gpsEvents?.gpsPositions?.at(-1) ?? null;

  if (lastGpsPoint && !mapOverlay.getGpsPosition()) {
    mapOverlay.setGpsPosition(lastGpsPoint.latitude, lastGpsPoint.longitude);
  }

  mapOverlay.toggle();
  if (mapOverlay.isVisible()) {
    // 2026-07-06 round-4 live-map fix: refresh AFTER toggle()
    refPointViews?.refreshMapMarkers();
    // Dispatch a resize event slightly after to fix Leaflet gray/white map tile bug
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }
  log.info(`Map overlay ${mapOverlay.isVisible() ? 'shown' : 'hidden'}`);
}

function handleMapZoomIn(): void {
  mapOverlay?.zoomIn();
}

function handleMapZoomOut(): void {
  mapOverlay?.zoomOut();
}

/**
 * Exported for testing purposes.
 * Wraps handleToggleMap for the map-toggle wiring tests.
 */
export function handleToggleMapForTesting(): void {
  handleToggleMap();
}

/**
 * Exported for testing purposes.
 * Delegates to folderManager.handleScenarioChange.
 */
export function handleScenarioChangeForTesting(
  scenarioName: string
): Promise<void> {
  return folderManager.handleScenarioChange(scenarioName);
}

/**
 * Exported for testing purposes.
 * Wraps handleStartRecording to allow testing without full UI wiring.
 */
export function handleStartRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleStartRecording();
}

/**
 * Exported for testing purposes.
 * Wraps handleStopRecording to allow testing without full UI wiring.
 */
export function handleStopRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleStopRecording();
}

/**
 * Exported for testing purposes.
 * Wraps handleEnterAR to allow testing without full UI wiring.
 */
export function handleEnterARForTesting(): Promise<void> {
  return handleEnterAR();
}

/**
 * Exported for testing purposes.
 * Overrides the module-level recording options (normally loaded once at
 * bootstrap / reloaded in `main()`), so a test can exercise an Enter-AR path
 * under a specific option set (e.g. `occupancy.liveOcclusion`) without
 * re-importing the module.
 */
export function setRecordingOptionsForTesting(options: RecordingOptions): void {
  recordingOptions = options;
}

/**
 * Exported for testing purposes.
 * Wraps handleRequestPermissions to allow testing GPS warm-up (Issue 4).
 */
export function handleRequestPermissionsForTesting(): Promise<void> {
  return handleRequestPermissions();
}

/**
 * Exported for testing purposes.
 * Delegates to refPointHandlers.handleMarkRefPoint.
 */
export function handleMarkRefPointForTesting(): Promise<void> {
  return refPointHandlers.handleMarkRefPoint();
}

/**
 * Exported for testing purposes.
 * Wraps handleOpenFolder to allow testing folder scanning (Issue 1, 2026-02-27).
 */
export function handleOpenFolderForTesting(): Promise<void> {
  return folderManager.handleOpenFolder();
}

/**
 * Exported for testing purposes.
 * Wraps handleReplayScenarioChange to allow testing replay scenario selection.
 */
export function handleReplayScenarioChangeForTesting(
  scenarioName: string
): Promise<void> {
  return replayHandlers.handleReplayScenarioChange(scenarioName);
}

/**
 * Set replay mode flag (for testing purposes).
 * Allows tests to simulate desktop/replay-mode behavior.
 */
export function setReplayModeForTesting(value: boolean): void {
  replayHandlers.setIsReplayMode(value);
}

/**
 * Exported for testing purposes.
 * Wraps handleBackDuringRecording to test the back-button confirmation flow.
 * Issue 5 (2026-02-27 user feedback).
 */
export function handleBackDuringRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleBackDuringRecording();
}

// Expose test hooks on window for e2e testing (dev mode only, not in unit tests)
// This allows Playwright tests to call real functions instead of simulating DOM changes
// Guard against unit test environment where window.testHooks setup can cause issues
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  !import.meta.env.VITEST
) {
  window.testHooks = {
    populateScenarios,
    validateEnterButton,
    showRecordingControls,
    hideRecordingControls,
    showSessionSummary,
    updateGpsInfo,
    updateArInfo,
    updatePermissionStatus,
    setPermissionsReady,
    // Log panel hooks (Issue #5)
    showLogPanel,
    hideLogPanel,
    toggleLogPanel,
    logInfo: (tag: string, message: string) => createLogger(tag).info(message),
    logWarn: (tag: string, message: string) => createLogger(tag).warn(message),
    logError: (tag: string, message: string) =>
      createLogger(tag).error(message),
    // GPS event visualization hooks
    getGpsEventVisualizerCounts: () => gpsEventVisualizer.getCounts(),
    setGpsEventVisualizerZeroRef: (lat: number, lon: number) =>
      gpsEventVisualizer.setZeroRef({ lat, lon }),
    clearGpsEventVisualizer: () => gpsEventVisualizer.clearAll(),
    /**
     * §3c — Add a GPS event with optional accuracy directly to the
     * visualizer. Ensures an offline `THREE.Scene` + `arWorldGroup` exist
     * (Playwright tests don't have an active WebXR session). Idempotent —
     * subsequent calls reuse the same offline scene.
     */
    addGpsEventForTest: (
      gpsCoords: [number, number, number],
      odomPosition: [number, number, number],
      accuracy?: { horizontal?: number; vertical?: number }
    ) => {
      if (!getScene()) {
        setScene(new THREE.Scene());
      }
      if (!getArWorldGroup()) {
        const grp = new THREE.Group();
        getScene()?.add(grp);
        setArWorldGroup(grp);
      }
      gpsEventVisualizer.addGpsEvent(gpsCoords, odomPosition, accuracy);
    },
    getRawGpsMarkerWorldSizes: () =>
      gpsEventVisualizer.getRawMarkerWorldSizes(),
    // Tracking quality indicator hook
    updateTrackingQuality,
    // Mandatory storage selection hooks (Task 1a-fix)
    setFolderSelected,
    setSaveLocationSelected,
    setFolderImportExpanded,
    // Folder-import indexing progress bar (D2, 2026-07-05)
    setFolderImportProgress,
    /**
     * Map-centric recording browser (Step 4B). Mounts the full-bleed browser
     * with fixture tours (GPS paths → H3 coverage), so Playwright can exercise
     * the layout, tiles, name search, and single-tour playback without a real
     * recordings folder. `onPlayTour` records the picked filename to
     * `window.__mapBrowserPlayed`; the instance is exposed for tile-selection
     * assertions on `window.__mapBrowserInstance`.
     */
    mountMapBrowser: (
      fixture: Array<{
        filename: string;
        scenario: string;
        path: Array<{ lat: number; lng: number }>;
      }>
    ) => {
      const container = ensureMapBrowserRoot();
      const recordings: RecordingCoverage[] = fixture.map((f, i) =>
        fixtureToRecordingCoverage(f, i)
      );
      window.__mapBrowserPlayed = [];
      const instance = createMapBrowser(container, {
        recordings,
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
      });
      window.__mapBrowserInstance = instance ?? undefined;
      return instance !== null;
    },
    /**
     * Slice A — mount the browser EMPTY and prime the progress pill to
     * `0 / total`, so the e2e test can then stream recordings in via
     * {@link streamMapBrowserRecording} and assert progressive behaviour
     * (map interactive before indexing, pill counts up then hides).
     */
    mountMapBrowserEmpty: (total: number) => {
      const container = ensureMapBrowserRoot();
      window.__mapBrowserPlayed = [];
      const instance = createMapBrowser(container, {
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
      });
      instance?.setIndexingProgress(0, total);
      window.__mapBrowserInstance = instance ?? undefined;
      return instance !== null;
    },
    /**
     * Slice A — stream one fixture recording into the already-mounted browser
     * and advance the progress pill to `done / total`. Mirrors what the real
     * `streamRecordingIndex` → `addRecording`/`setIndexingProgress` wiring does.
     */
    streamMapBrowserRecording: (
      item: {
        filename: string;
        scenario: string;
        path: Array<{ lat: number; lng: number }>;
      },
      done: number,
      total: number
    ) => {
      const instance = window.__mapBrowserInstance;
      if (!instance) {
        return false;
      }
      instance.addRecording(fixtureToRecordingCoverage(item, done));
      instance.setIndexingProgress(done, total);
      return true;
    },
    /**
     * Slice B (B1) — mount the browser with backfillable (legacy) recordings and
     * a **deferred** `onBackfill` so Playwright can observe the transitional
     * "Embedding…" state, then release the promise with `outcome` to assert the
     * final state. Marks indexing complete so the CTA appears immediately.
     * `window.__mapBrowserBackfillCalls` counts invocations;
     * `window.__releaseBackfill()` resolves the in-flight backfill.
     */
    mountMapBrowserBackfill: (
      fixture: Array<{
        filename: string;
        scenario: string;
        path: Array<{ lat: number; lng: number }>;
      }>,
      outcome: {
        embedded: number;
        skipped: number;
        failed: number;
        permissionDenied: boolean;
      }
    ) => {
      const container = ensureMapBrowserRoot();
      window.__mapBrowserPlayed = [];
      window.__mapBrowserBackfillCalls = 0;
      let release: (() => void) | undefined;
      window.__releaseBackfill = () => release?.();
      const instance = createMapBrowser(container, {
        onPlayTour: (r) => window.__mapBrowserPlayed?.push(r.entry.filename),
        onClose: () => {
          instance?.destroy();
          container.remove();
          window.__mapBrowserInstance = undefined;
        },
        onBackfill: () => {
          window.__mapBrowserBackfillCalls =
            (window.__mapBrowserBackfillCalls ?? 0) + 1;
          return new Promise((resolve) => {
            release = () => resolve(outcome);
          });
        },
      });
      window.__mapBrowserInstance = instance ?? undefined;
      if (instance) {
        fixture.forEach((f, i) => {
          // Mark as legacy/backfilled so it counts toward the CTA.
          instance.addRecording({
            ...fixtureToRecordingCoverage(f, i),
            backfilled: true,
          });
        });
        // Mark indexing complete so the CTA appears.
        instance.setIndexingProgress(fixture.length, fixture.length);
      }
      return instance !== null;
    },
  };
}

// Bootstrap
main().catch((err) => {
  log.error('Fatal error:', err);
  showError('Fatal error during initialization.');
});
