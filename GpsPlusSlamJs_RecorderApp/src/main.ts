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
  updateFrameCount,
  populateScenarios,
  validateEnterButton,
  updatePermissionStatus,
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
import { initSessionSummary, hideSessionSummary } from './ui/session-summary';
import { initLogPanel, showLogPanel } from './ui/log-panel';
import { initToast, showToast, TOAST_DURATION_ERROR } from './ui/toast';
import { destroyConfirmDialog } from './ui/confirm-dialog';
import {
  initAR,
  endARSession,
  rebindTrackingStore,
  getCurrentArPose,
  getScene,
  getCamera,
  getArWorldGroup,
  getDepthInfoFromFrame,
  type ArSessionCallbacks,
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
import { createRecorderStore } from './state/recorder-store';
import { add2dImage } from 'gps-plus-slam-app-framework/state';
import { recordDepthSample } from 'gps-plus-slam-app-framework/state/recording-slice';
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
import { createArSessionScope } from './utils/ar-session-scope';
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
import { OccupancyCubesVisualizer } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';
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
import {
  launchMapBrowser,
  ensureMapBrowserRoot,
} from './ui/map-browser-launcher';
import { createReplayHandlers } from './replay/replay-handlers';
import { createRefPointHandlers } from './ref-points/ref-point-handlers';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  loadRecordingOptions,
  type RecordingOptions,
} from './state/recording-options';
import { initSettingsModal } from './ui/settings-modal';
import {
  createPerfStatsOverlay,
  type PerfStatsOverlayHandle,
} from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';
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
    enableCompassExperiment: compass?.experiment,
    enableRobustSolverComparison: compass?.robustSolverComparison,
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

// Every AR-session-scoped resource registers its teardown here at its
// creation site (see utils/ar-session-scope.ts and the 2026-07-11
// lifecycle-scope plan doc). Entering AR again and `resetMainState` both
// simply dispose the scope — the module `let`s below remain because the
// frame callback and various handlers read them, but their teardown
// bookkeeping lives in the scope, written once per resource.
const arSessionScope = createArSessionScope();

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

// Perf stats overlay (visualization.statsOverlay, OFF by default) — Step 0 of
// the 2026-07-03 long-session fps plan. Mounted into the #app dom-overlay root
// at Enter-AR, advanced from the initAR `callbacks.onFrame` tick; teardown
// registered in arSessionScope (same lifecycle as the frame-tile visualizer).
let statsOverlay: PerfStatsOverlayHandle | null = null;

// Live loop-closure capture (opt-in, recording-options `loopClosureDebug`).
// The handler is (re)bound lazily to the CURRENT store inside the per-frame
// callback — stores swap per recording session, and a rebind also resets the
// handler's last-pose memory, which is exactly right for a fresh session.
// Teardown registered in arSessionScope, mirroring the live occluder. The
// handler stays module-level because the tracking callbacks (onRestarted /
// onLost / onRecovered) also drive it; the wiring-internal state lives as
// closure-locals in `wireLoopClosureCapture`.
let loopClosureHandler: LoopClosureHandler | null = null;

// Live QR recording (opt-in, recording-options `qr`). The thin RAW producer
// (created in handleEnterAR when enabled) receives camera frames via the
// `cameraFrame` group passed to initAR; `wireQrRecording` owns the
// producer + the WS-5 debug-viz subscriber and returns a dispose handle.
let qrProducer: QrDetectionController | null = null;

// Off-thread image-quality analyzer for the CURRENT recording (null between
// recordings / when the gate is off). Recordings start and stop WITHIN one AR
// session, so the per-recording Worker cannot be passed to initAR directly —
// instead initAR gets a STABLE delegating wrapper (see handleEnterAR's
// `imageCapture.qualityAnalyzer`) and recording-session-handlers swaps this
// ref via its injected `setImageQualityAnalyzer` dep. Fail-open: while the
// ref is null the wrapper accepts every frame, matching the framework's
// no-analyzer path.
type ImageQualityAnalyzerFn = NonNullable<
  NonNullable<ArSessionCallbacks['imageCapture']>['qualityAnalyzer']
>;
let activeImageQualityAnalyzer: ImageQualityAnalyzerFn | null = null;

// Ref-point view wiring (3D spheres + live-map markers) — AR-scoped and
// store-swap-following via storeRef (round-3 feedback 2026-07-05). Wired at
// Enter AR so the views react in AR_READY too (e.g. a folder import finishing
// before the first recording); teardown registered in arSessionScope.
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
  rebindTrackingStore,
  // The per-recording quality-gate Worker analyzer: stored in main's
  // `activeImageQualityAnalyzer` ref, which the stable wrapper passed to
  // initAR (`imageCapture.qualityAnalyzer`) delegates to.
  setImageQualityAnalyzer: (analyzer) => {
    activeImageQualityAnalyzer = analyzer;
  },
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

// Folder manager — encapsulates folder selection, save location, scenario management
// (Finding #7 decomposition Step 4: extracted from main.ts to storage/folder-manager.ts)
const folderManager = createFolderManager({
  getStore: () => store,
  getIsReplayMode: () => replayHandlers.getIsReplayMode(),
  setReplayZipScenariosCache: (cache) =>
    replayHandlers.setReplayZipScenariosCache(cache),
  // Map-centric recording browser (Step 4C) — app-lifetime state lives in
  // ui/map-browser-launcher.ts; only the single-tour replay entry point is
  // injected because it belongs to main's replay handlers.
  onReplayFolderScanned: (folderHandle) =>
    launchMapBrowser(folderHandle, {
      startReplayForEntry: (entry) => replayHandlers.startReplayForEntry(entry),
    }),
  showError,
  updateStatus,
  populateScenarios,
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
 * Wire the live loop-closure capture (recording-options `loopClosureDebug`,
 * default OFF). Feeds each frame's RAW WebXR pose (the reducer converts
 * frames itself) into the library handler, so an AR relocalization jump
 * (>1 m between consecutive frames) dispatches `arLoopClosureDetected` into
 * the session store — and therefore into the recording. This is the corpus
 * producer the pair-refresh T5 verdict is blocked on; see
 * GpsPlusSlamJs_Docs/docs/2026-07-06-2228-recorder-loop-closure-detector-wiring-plan.md.
 *
 * Returns the teardown (unregister the frame feed + drop the handler), for
 * registration in `arSessionScope`.
 */
function wireLoopClosureCapture(): () => void {
  // Scratch tuples reused per frame (quality-review F-11): `processPose`
  // snapshots the VALUES and never retains the arrays (guaranteed + pinned
  // by test since quality-review H-3), so feeding reused scratch is safe and
  // avoids two allocations per XR frame while the detector is enabled.
  const scratchPos: [number, number, number] = [0, 0, 0];
  const scratchRot: [number, number, number, number] = [0, 0, 0, 1];
  let boundStore: unknown = null;
  const unregisterFrame = registerXrFrameUpdate(() => {
    // Lazy (re)bind to the CURRENT store: `store` swaps per recording
    // session, and dispatching into a stale store would silently drop the
    // closures from the recording. A rebind starts with empty last-pose
    // memory — correct for a fresh session/frame.
    if (boundStore !== store) {
      loopClosureHandler = createLoopClosureHandler(store);
      boundStore = store;
    }
    // `getCurrentArPose()` is nulled by the framework on tracking loss and
    // only repopulated AFTER this callback ran on the recovery frame, so the
    // first pose the handler sees after a reset is genuinely fresh — a
    // recovery jump can never be misread as a loop closure.
    const pose = getCurrentArPose();
    if (!pose) {
      return;
    }
    scratchPos[0] = pose.position.x;
    scratchPos[1] = pose.position.y;
    scratchPos[2] = pose.position.z;
    scratchRot[0] = pose.orientation.x;
    scratchRot[1] = pose.orientation.y;
    scratchRot[2] = pose.orientation.z;
    scratchRot[3] = pose.orientation.w;
    loopClosureHandler!.processPose(scratchPos, scratchRot);
  });
  return () => {
    unregisterFrame();
    loopClosureHandler = null;
  };
}

/**
 * Reset main module state.
 * Exported for testing purposes to ensure test isolation.
 *
 * Every AR-session-scoped resource (visualizers, subscriptions, frame-loop
 * handles) is torn down via `arSessionScope` — each resource registered its
 * disposer at its creation site, and the scope unwinds them in reverse
 * creation order. Only app-lifetime state is reset explicitly below.
 */
export function resetMainState(): void {
  arSessionScope.dispose();
  liveFrameBlobs.clear();
  recordingSessionHandlers.reset();
  refPointHandlers.reset();
  destroyConfirmDialog();
  folderManager.reset();
  replayHandlers.reset();
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
 *   GpsPlusSlamJs_Docs docs/2026-07-04-2319-soft-reset-end-ar-session-plan.md)
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
    onStartRecording: () => recordingSessionHandlers.handleStartRecording(),
    onStopRecording: () => recordingSessionHandlers.handleStopRecording(),
    onMarkRefPoint: () => refPointHandlers.handleMarkRefPoint(),
    onMarkNewRefPoint: () =>
      refPointHandlers.handleMarkRefPoint({ forceNew: true }),
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

    // Re-enter guard: tear down every resource the previous AR session
    // registered (handleEnterAR runs again on back-to-setup → Enter AR).
    // Replaces the per-block dispose-first guards this function used to
    // repeat — see utils/ar-session-scope.ts.
    arSessionScope.dispose();

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

    // Live loop-closure capture (experimental, default OFF): the per-frame
    // feed is registered only when the operator opted in — OFF keeps the
    // frame loop untouched (zero cost).
    arSessionScope.wire(
      'Loop-closure capture',
      recordingOptions.loopClosureDebug.detectorEnabled,
      () => wireLoopClosureCapture()
    );

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

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      throw new Error('Missing #app container element');
    }

    // Per-frame tick state for `callbacks.onFrame` below (map overlay /
    // follower / lerper updates at render cadence, ~60+ Hz, not GPS cadence).
    let lastFrameTime = performance.now();

    // ONE callbacks struct for the whole session (surface-reduction step 1 —
    // replaces the former pre/post-init setter calls; initAR unpacks it once
    // and resetWebXRState clears every slot at session end). The closures
    // read module-level `let`s (store, qrProducer, loopClosureHandler,
    // statsOverlay, …) at FIRE time, so resources created after initAR — and
    // per-recording swaps — are picked up without re-registration.
    const sessionCallbacks: ArSessionCallbacks = {
      // Field Test Readiness Issue #8: warn the user when depth is unavailable
      depth: {
        onCaptured: handleDepthSampleCaptured,
        onUnavailable: () => {
          log.warn('Depth sensing unavailable - device may not support it');
          showError(
            'Depth sensing unavailable. Your device may not support this feature.'
          );
        },
      },
      // Live QR (opt-in): only when QR is enabled, so a disabled session never
      // builds the camera-frame source. The producer is created after initAR
      // (handleEnterAR's arWorldGroup block) and forwarded frames here.
      ...(recordingOptions.qr.enabled
        ? {
            cameraFrame: {
              onFrame: (image) => qrProducer?.offerFrame(image),
            },
          }
        : {}),
      // Tracking pipeline: store + callbacks together. Enables the tracking
      // slice and the XRReferenceSpace reset event listener. When tracking
      // resumes after an origin reset (Case 2), the store's
      // odometryTrackingRestarted reducer clears stale data and accumulates
      // offsets so alignment continues correctly across resets. Recordings
      // swap the store mid-session via rebindTrackingStore (see
      // recording-session-handlers).
      tracking: {
        store,
        onRestarted: (payload) => {
          store.dispatch(odometryTrackingRestarted(payload));
          // Origin reset: clear the loop-closure handler's last-pose memory
          // (deactivate ⇒ reset) before re-arming — the reference-space jump
          // is an origin correction, not a relocalization loop closure.
          loopClosureHandler?.setTrackingActive(false);
          loopClosureHandler?.setTrackingActive(true);
          updateArInfo('');
          log.info('AR tracking restarted — alignment correction dispatched');
        },
        onLost: () => {
          updateArInfo('⚠️ LOST');
          // Stop feeding poses + forget the last pose: the pose jump across a
          // loss must never be recorded as a loop closure.
          loopClosureHandler?.setTrackingActive(false);
          showError(
            'AR tracking lost. Try moving to a well-lit area with more visual features.'
          );
        },
        // Seamless recovery (Case 1: same coordinate frame) — clears the
        // "LOST" UI warning without dispatching an alignment correction.
        onRecovered: () => {
          loopClosureHandler?.setTrackingActive(true);
          updateArInfo('');
          log.info('AR tracking recovered (same coordinate frame)');
        },
      },
      // Image capture (Issue #11: onFailed tracks capture failures; user
      // feedback: onSuspicious logs black/empty frames).
      imageCapture: {
        onCaptured: handleImageCaptured,
        getScreenRotation,
        onFailed: () => recordingSessionHandlers.recordCaptureFailure(),
        onSuspicious: (blobSize: number, frameIndex: number) => {
          // Log suspicious images so they appear in the expandable log panel
          log.error(
            `Suspicious image detected at frame ${frameIndex}: ` +
              `size ${blobSize} bytes - image may be black/empty. ` +
              `This can occur when WebGL hasn't composited the frame yet.`
          );
        },
        // Stable wrapper over the PER-RECORDING quality-gate Worker analyzer
        // (recordings start/stop within one AR session, so the Worker itself
        // cannot be an init-time constant). While no recording-owned analyzer
        // is active the wrapper accepts every frame — same fail-open outcome
        // as the framework's no-analyzer path; the manager only calls it when
        // qualityFilter.enabled anyway.
        qualityAnalyzer: (frame) =>
          activeImageQualityAnalyzer
            ? activeImageQualityAnalyzer(frame)
            : Promise.resolve({ accept: true }),
      },
      // Issue #14: Map overlay is created lazily on first toggle. Per-frame
      // callback for smooth map position updates and follower tracking —
      // called every XR frame (~60+ Hz) rather than on GPS events (~1 Hz).
      onFrame: () => {
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
          // relative to where the user is actually looking (the same camera
          // the CSS3D overlay is composited through). See the 2026-06-29 plan.
          mapOverlay.updatePosition(dt, camera ?? undefined);
        }
      },
      // F3 (2026-07-04): react to a SYSTEM-initiated session end (Android back
      // gesture ends the XRSession directly — uncancelable). Mid-recording
      // this auto-stops + saves and lands on the summary with a toast; in
      // AR_READY it returns to setup. The framework clears this callback on
      // every session end, so it rides along on each Enter AR.
      // Fire-and-forget: the handler resolves its own errors (showError); the
      // framework callback contract is synchronous.
      onSessionEnd: (info) => {
        void systemSessionEndHandler(info);
      },
    };

    // Live depth occluder (opt-in, off by default): request the
    // `cpu-optimized` depth-sensing feature for the live occluder even when
    // depth *recording* is off, so the session negotiates the depth stream the
    // occluder consumes. The render-side integration (the full-screen
    // DepthOccluder fed per frame) is wired below once arWorldGroup exists; its
    // on-device occlusion quality is still being tuned.
    await initAR(
      appContainer,
      recordingOptions.arCrashIsolation,
      {
        requestDepthOcclusion:
          recordingOptions.occupancy.liveOcclusion === true,
      },
      sessionCallbacks
    );

    // Issue 8: Create CameraFollower at scene root (not arWorldGroup)
    // The follower tracks the camera position but stays GPS-aligned (identity rotation),
    // so the map and compass cubes don't rotate with the camera or alignment matrix.
    const arWorldGroup = getArWorldGroup();
    const arScene = getScene();
    if (arWorldGroup && arScene) {
      // Issue 4: Create alignment lerper for smooth alignment transitions
      alignmentLerper = createAlignmentLerper(arWorldGroup);
      arSessionScope.add('Alignment lerper', () => {
        alignmentLerper?.dispose();
        alignmentLerper = null;
      });

      cameraFollower = createCameraFollower(arScene);
      arSessionScope.add('Camera follower', () => {
        cameraFollower?.dispose();
        cameraFollower = null;
      });

      // Live debug-overlay visibility (recording-options `visualization`, read
      // ONCE here at Enter-AR — toggling mid-session applies on the next
      // Enter-AR, not retroactively; replay is never gated). Finding B / DB-2 of
      // GpsPlusSlamJs_Docs/docs/2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md.
      const viz = recordingOptions.visualization;

      // Perf stats overlay (Step 0 of the 2026-07-03 long-session fps plan).
      // Mounted into the #app dom-overlay root so it composites over the AR
      // view; advanced once per XR frame in the `callbacks.onFrame` tick.
      arSessionScope.wire('Stats overlay', viz.statsOverlay, () => {
        statsOverlay = createPerfStatsOverlay(appContainer);
        return () => {
          statsOverlay?.dispose();
          statsOverlay = null;
        };
      });

      // Compass cubes — recorder-side skip. Nothing non-visual depends on
      // them. The follower must exist first (the cubes parent into its
      // object3D); registering their disposal closes the old reset-gap where
      // the cubes were only freed transitively via the follower.
      const follower = cameraFollower;
      arSessionScope.wire('Compass cubes', viz.compassCubes, () => {
        const cubes = createGpsCompassCubes(follower.object3D);
        return () => cubes.dispose();
      });

      // GPS+VIO alignment spheres — NOT skipped (their snapshot positions feed
      // the session-summary map at stop), only hidden via the framework
      // visibility API. Live only; replay keeps them visible because clearAll
      // resets the shared singleton's visibility on each store swap.
      gpsEventVisualizer.setVisible(viz.gpsAlignmentMarkers);

      // Ref-point views (3D spheres + live-map markers) — AR-scoped and
      // store-swap-following via storeRef (round-3 feedback 2026-07-05:
      // previously session-scoped, so imports finishing before the first
      // recording filled the store with no view subscribed).
      refPointViews = wireRefPointViews(storeRef, {
        visualizer: refPointVisualizer,
        getMap: () => mapOverlay?.getLeafletMap() ?? null,
      });
      arSessionScope.add('Ref-point views', () => {
        refPointViews?.unsubscribe();
        refPointViews = null;
      });

      // F3.5d — wire the frame-tile visualizer into the live AR scene so
      // captured frames appear as textured planes during recording, using
      // the same listener+visualizer stack as replay. The live frame-blob
      // cache is populated in handleImageCaptured, independent of this
      // wiring, so skipping it never affects capture.
      arSessionScope.wire('Frame tile visualizer', viz.frameTiles, () => {
        // Parent under arWorldGroup (NOT the scene root): the selector
        // emits raw-WebXR poses, so tiles must ride the camera's
        // alignment × WEBXR_TO_NUE chain. See the followup frame-check doc.
        // maxTiles: LIVE-ONLY FIFO cap (Step 4, 2026-07-03 fps plan) — the
        // replay wiring deliberately omits it so coverage auditing sees the
        // full recorded path.
        const frameTileVisualizer = new FrameTileVisualizer(arWorldGroup, {
          maxTiles: recordingOptions.frameTileDisplay.maxTiles,
        });
        // D7-resolution: downscale the live display texture by the
        // configured frameTileDisplay divisor (default ÷2) to cut per-tile
        // GPU memory. Read once here at Enter-AR alongside the other viz
        // settings; capture quality (images.resolutionDivisor) is untouched.
        const frameTileDivisor = recordingOptions.frameTileDisplay.divisor;
        const unsubscribeFrameTiles = wireFrameTileSubscribers({
          storeRef,
          visualizer: frameTileVisualizer,
          blobSource: (imageFile) =>
            Promise.resolve(liveFrameBlobs.get(imageFile) ?? null),
          decodeTexture: (blob) => decodeFrameTexture(blob, frameTileDivisor),
          onError: (err, imageFile) => {
            log.warn(`Frame tile decode failed for "${imageFile}"`, err);
          },
        });
        return () => {
          unsubscribeFrameTiles();
          frameTileVisualizer.dispose();
        };
      });

      // Occupancy-grid cubes — voxelized depth geometry in the live AR
      // scene (port plan Iter 5). The cells are raw-WebXR coordinates, so
      // the visualizer hangs off arWorldGroup (NOT the scene root) and
      // rides the alignment like the camera does (Iter 7 reparenting fix).
      // Always wired (enabled: true): the occupancyCubes toggle gates only
      // the rendered debug cubes — the grid itself is always built and fed,
      // because COLMAP export and other non-visualizer consumers read it via
      // getOccupancyGrid().
      arSessionScope.wire('Occupancy grid', true, () => {
        // Voxel size is a user setting (recording-options `occupancy.cellSizeM`,
        // clamped 1–20 cm); read it at construction so a changed value applies
        // on the next Enter-AR. Same source main.ts uses for arCrashIsolation.
        // Confidence-guarded carving is tied to the SAME noise floor the
        // renderers use (occupancy.minConfidence, clamped 1–10): any voxel
        // solid enough to be shown can no longer be erased by one deeper
        // reading (2026-07-16 synthetic-scene investigation — eliminates
        // silhouette churn and occluded-background destruction).
        const occupancyGrid = new OccupancyGrid({
          cellSizeM: recordingOptions.occupancy.cellSizeM,
          carveConfidenceThreshold: recordingOptions.occupancy.minConfidence,
        });
        // Publish the single live grid so non-visualizer consumers (the COLMAP
        // ZIP contributor, future floor/nav-mesh builders) can read it without a
        // one-off reference — the provider is the ONLY cross-module handle to
        // the grid; the teardown below clears it back to null (COLMAP export
        // plan Q2).
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
        let occupancyCubesVisualizer: OccupancyCubesVisualizer | null = null;
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
        let occluderSinkHandle: OccluderSinkHandle | null = null;
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
        const unsubscribeOccupancyGrid = wireOccupancyGridSubscribers({
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
        return () => {
          // Stop feeding the grid before releasing the visualizer/occluder it
          // feeds; clear the published grid reference last (COLMAP plan Q2).
          unsubscribeOccupancyGrid();
          occupancyCubesVisualizer?.dispose();
          occluderSinkHandle?.dispose();
          setOccupancyGrid(null);
        };
      });

      // Live CPU-depth occluder (opt-in — occupancy.liveOcclusion). The
      // full-screen depth-write path (v1): each frame we read the full depth and
      // feed it to the occluder, whose clip-space mesh writes gl_FragDepth so the
      // real surface hides ALL virtual content behind it — like the persistent
      // mesh, but for the surface the camera sees *this* frame. A per-frame
      // throw is tolerated too (the frame registry is try/catch-safe per
      // callback). The on-device occlusion render is still being brought up,
      // so the checkbox stays experimental.
      arSessionScope.wire(
        'Live depth occluder',
        recordingOptions.occupancy.liveOcclusion,
        () => {
          const occluder = new DepthOccluder();
          // The mesh's vertex shader ignores transforms, but parenting under
          // arWorldGroup keeps it in the AR render pass alongside the content.
          arWorldGroup.add(occluder.getOcclusionMesh());
          const unregisterFrame = registerXrFrameUpdate(
            ({ frame, referenceSpace }) => {
              const pose = frame.getViewerPose(referenceSpace);
              const depthInfo = getDepthInfoFromFrame(frame, pose);
              if (depthInfo) occluder.update(depthInfo);
            }
          );
          return () => {
            unregisterFrame();
            occluder.dispose();
          };
        }
      );

      // Live QR RAW recording + WS-5 debug viz (opt-in). Gated on the operator
      // setting; the camera-frame callback was registered before initAR above.
      arSessionScope.wire('QR recording', recordingOptions.qr.enabled, () => {
        const unsubscribeQrRecording = wireQrRecording({
          storeRef,
          getArWorldGroup,
          qr: recordingOptions.qr,
          setProducer: (producer) => {
            qrProducer = producer;
          },
        });
        return () => {
          unsubscribeQrRecording();
          qrProducer = null;
        };
      });
    }

    // Issue #2 fix: Update status to match AR_READY state per Application State Machine
    updateStatus('AR active - Tap Start to record');

    // Subscribe to tracking quality changes so the HUD reflects alignment
    // health. Goes through `storeRef` so the subscription follows every
    // store swap (Start Recording / replay) — see F1 in
    // `docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md`.
    const unsubscribeTrackingQuality = subscribeHudToTrackingQuality({
      storeRef,
      updateHud: updateTrackingQuality,
    });
    arSessionScope.add(
      'Tracking-quality subscription',
      unsubscribeTrackingQuality
    );

    // Issue 7 Phase 2: Push AR screen state for back-button navigation
    pushScreenState('ar');
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
  // 2026-06-12-1130-payload-rebuild-field-drop-audit.md F1) — without it the
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
    // AR-scoped like everything else, but created HERE (first toggle), so the
    // disposer registers here. `resetForNewRecording` also disposes it
    // directly (mid-session soft reset); the null check makes that safe.
    arSessionScope.add('Map overlay', () => {
      mapOverlay?.dispose();
      mapOverlay = null;
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
    // 2026-07-06 round-4 live-map fix: refresh AFTER toggle() — the overlay
    // creates its inner Leaflet map only inside show(), so a refresh before
    // toggle() always ran against a null map and drew nothing (green prior /
    // red captured, same renderer as the summary map). Re-run on every
    // re-show too: phases without store events (e.g. AR_READY has no GPS
    // watch) would otherwise never trigger the wirer's subscriber.
    refPointViews?.refreshMapMarkers();
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

// Expose test hooks on window for e2e testing (dev mode only, never in unit
// tests or production bundles). The hooks live in test-utils/e2e-hooks.ts;
// the dynamic import keeps them out of the production chunk graph, and
// Playwright's waitForTestHooks polls until the object appears, so the async
// install is invisible to the specs.
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  !import.meta.env.VITEST
) {
  void import('./test-utils/e2e-hooks').then(({ installE2eTestHooks }) =>
    installE2eTestHooks({ ensureMapBrowserRoot })
  );
}

// Bootstrap
main().catch((err) => {
  log.error('Fatal error:', err);
  showError('Fatal error during initialization.');
});
