// @vitest-environment jsdom
/**
 * Integration tests for the replay mode wiring in main.ts.
 *
 * Why these tests matter:
 * These tests verify the glue layer — the replay handler functions that connect
 * the replay UI, session browser, and replay orchestrator. Without these tests,
 * the wiring correctness would only be verifiable via manual E2E testing.
 *
 * Key acceptance criteria tested:
 * - R6: Replay store assigned to module-level store variable
 * - R8: Session browser → zip bytes → startReplayMode data flow
 * - Replay scenario/session selection populates UI correctly
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock all the heavy dependencies to isolate the wiring logic
vi.mock('./replay/replay-mode', () => ({
  startReplayMode: vi.fn(),
}));
vi.mock('./ui/session-browser', () => ({
  DEFAULT_SCENARIO: 'Default Scenario',
  listScenariosFromFolder: vi.fn(),
  extractScenarioNamesFromZips: vi.fn(),
  discoverScenariosFromZipMetadata: vi.fn(),
  listSessionZipsInScenario: vi.fn(),
}));
vi.mock('./ui/replay-ui', () => ({
  initReplayUI: vi.fn(),
  switchToReplayMode: vi.fn(),
  populateReplayScenarios: vi.fn(),
  populateReplaySessions: vi.fn(),
  updateReplayProgress: vi.fn(),
  showReplayControls: vi.fn(),
  hideReplayControls: vi.fn(),
  updatePlayPauseButton: vi.fn(),
  updateCameraModeButton: vi.fn(),
  enableStartReplay: vi.fn(),
  disableStartReplay: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/replay-scene', () => ({
  initReplayScene: vi.fn(),
  disposeReplayScene: vi.fn(),
  toggleCameraMode: vi.fn(),
  getCameraMode: vi.fn().mockReturnValue('orbit'),
}));

// Mock infrastructure modules to avoid side effects
vi.mock('./utils/sentry', () => ({ initSentry: vi.fn() }));
vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('./ui/ref-point-view-wiring', () => ({
  wireRefPointViews: vi.fn(() => ({
    refreshMapMarkers: vi.fn(),
    unsubscribe: vi.fn(),
  })),
}));

vi.mock('./ui/hud', () => ({
  initUI: vi.fn(),
  showError: vi.fn(),
  updateStatus: vi.fn(),
  updateArInfo: vi.fn(),
  updateGpsInfo: vi.fn(),
  populateScenarios: vi.fn(),
  showRecordingControls: vi.fn(),
  hideRecordingControls: vi.fn(),
  validateEnterButton: vi.fn(),
  updatePermissionStatus: vi.fn(),
  setPermissionsReady: vi.fn(),
  setSaveLocationSelected: vi.fn(),
  setFolderImportExpanded: vi.fn(),
  setFolderImportProgress: vi.fn(),
  updateFolderStatus: vi.fn(),
  updateSaveStatus: vi.fn(),
  updateSyncStatus: vi.fn(),
  resetUIForNewRecording: vi.fn(),
  showSetupModal: vi.fn(),
  updateRefPointButtonLabel: vi.fn(),
  setNewRefPointButtonVisible: vi.fn(),
  updateTrackingQuality: vi.fn(),
  hideTrackingQuality: vi.fn(),
  showUnsupportedPlatformNotice: vi.fn(),
}));
vi.mock('./ui/toast', () => ({
  initToast: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('./ui/session-summary', () => ({
  initSessionSummary: vi.fn(),
  showSessionSummary: vi.fn(),
  hideSessionSummary: vi.fn(),
}));
vi.mock('./ui/log-panel', () => ({
  initLogPanel: vi.fn(),
  showLogPanel: vi.fn(),
  hideLogPanel: vi.fn(),
  toggleLogPanel: vi.fn(),
}));
vi.mock('./ui/ref-point-picker', () => ({
  showRefPointPicker: vi.fn(),
  createRefPointPickerHtml: vi.fn().mockReturnValue(''),
  isRefPointPickerVisible: vi.fn(),
  cancelRefPointPicker: vi.fn(),
}));
vi.mock('./ui/navigation', () => ({
  initNavigation: vi.fn(),
  getCurrentScreen: vi.fn(() => 'setup'),
  enableBeforeUnloadWarning: vi.fn(),
  disableBeforeUnloadWarning: vi.fn(),
  pushScreenState: vi.fn(),
  replaceScreenState: vi.fn(),
}));
vi.mock('./ui/settings-modal', () => ({
  initSettingsModal: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  initAR: vi.fn(),
  getCurrentArPose: vi.fn(),
  applyAlignmentMatrix: vi.fn(),
  startImageCapture: vi.fn(),
  stopImageCapture: vi.fn(),
  startDepthCapture: vi.fn(),
  stopDepthCapture: vi.fn(),
  rebindTrackingStore: vi.fn(),
  getScene: vi.fn(),
  getCamera: vi.fn(),
  getArWorldGroup: vi.fn(),
  getImageCaptureFrameCount: vi.fn(),
  getDepthSampleCount: vi.fn(),
}));
vi.mock('gps-plus-slam-js', () => ({
  odometryTrackingRestarted: vi.fn((payload: unknown) => ({
    type: 'gpsData/odometryTrackingRestarted',
    payload,
  })),
}));
vi.mock('gps-plus-slam-app-framework/ar/xr-error-handler', () => ({
  getXrErrorMessage: vi.fn(),
}));
vi.mock('./storage/scenario-storage', () => ({
  initStorage: vi.fn().mockResolvedValue([]),
  getCurrentScenarioHandle: vi.fn(),
  setCurrentScenario: vi.fn(),
  startSession: vi.fn(),
  resetForNewSession: vi.fn(),
}));
vi.mock('./storage/external-file-storage', () => ({
  isExternalStorageSupported: vi.fn().mockReturnValue(true),
  selectReadFolder: vi.fn(),
  selectSaveFile: vi.fn(),
  getSaveFileHandle: vi.fn(),
  getReadFolderHandle: vi.fn(),
  resetForNewRecording: vi.fn(),
  hasReadFolderPermission: vi.fn(),
}));
vi.mock('./storage/sync-manager', () => ({
  createSyncManager: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/storage/zip-export', () => ({
  syncToExternalZip: vi.fn(),
}));
vi.mock('./storage/ref-point-loader', () => ({
  loadAllRefPoints: vi.fn(),
  saveRefPointObservation: vi.fn(),
  flattenRefPointsToMarks: vi.fn(),
  listRefPointIds: vi.fn(),
}));
vi.mock('./storage/ref-point-importer', () => ({
  importRefPointsFromFolder: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/storage/file-system-utils', () => ({
  formatTimestamp: vi.fn(),
  SESSION_IMAGES_DIR: 'images',
}));
vi.mock('gps-plus-slam-app-framework/utils/fused-path', () => ({
  computeFusedPath: vi.fn(),
}));
vi.mock('./state/recorder-store', () => ({
  createRecorderStore: vi.fn().mockReturnValue({
    dispatch: vi.fn(),
    getState: vi.fn().mockReturnValue({}),
    subscribe: vi.fn().mockReturnValue(() => {}),
  }),
  startSession: vi.fn(),
  endSession: vi.fn(),
  add2dImage: vi.fn(),
  recordDepthSample: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/storage/null-storage-backend', () => ({
  NullStorageBackend: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/sensors/gps', () => ({
  startGpsWatch: vi.fn(),
  stopGpsWatch: vi.fn(),
  startOrientationWatch: vi.fn(),
  stopOrientationWatch: vi.fn(),
  requestOrientationPermission: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/sensors/permission-checker', () => ({
  checkAllPermissions: vi.fn(),
  requestAllPermissions: vi.fn(),
  subscribePermissionChanges: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
}));
vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  createGpsPositionHandler: vi.fn(),
  updateDeviceOrientation: vi.fn(),
  resetCoordinatorState: vi.fn(),
  extractOdomPosition: vi.fn(),
  extractOdomRotation: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/visualization/reference-points', () => ({
  refPointVisualizer: {},
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: {},
}));
vi.mock('gps-plus-slam-app-framework/visualization/camera-follower', () => ({
  createCameraFollower: vi.fn().mockReturnValue({
    object3D: { name: 'camera-follower' }, // matches SCENE_NODE.CAMERA_FOLLOWER
    update: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-compass-cubes', () => ({
  createGpsCompassCubes: vi.fn(),
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/leaflet-map-overlay',
  () => ({
    LeafletMapOverlay: vi.fn(),
  })
);
vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: vi.fn().mockReturnValue(() => {}),
}));
vi.mock('./state/recording-options', () => ({
  // main.ts also consumes the pure compassStoreOptions mapping — stubbed
  // inert here; its real logic is unit-tested in recording-options.test.ts.
  compassStoreOptions: () => ({}),
  loadRecordingOptions: vi.fn().mockReturnValue({
    qr: { enabled: false, intervalMs: 125, captureSize: 1024 },
    images: {
      enabled: true,
      intervalMs: 2000,
      quality: 0.7,
      resolutionDivisor: 1,
    },
    depth: { enabled: true, intervalMs: 1000, gridSize: 3 },
    arCrashIsolation: {
      enableDomOverlay: true,
      enableCameraAccess: true,
      enableDepthSensingFeature: true,
      enableCss3dRenderer: true,
      enableCameraTextureAcquisition: true,
      applyChromiumProjectionLayerWorkaround: false,
    },
  }),
}));
vi.mock('./storage/write-failure-tracker', () => ({
  createWriteFailureTracker: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/capture-failure-tracker', () => ({
  createCaptureFailureTracker: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/utils/list-formatter', () => ({
  listFormatter: { format: vi.fn() },
}));
vi.mock('gps-plus-slam-app-framework', () => ({
  selectTrackingQuality: vi.fn().mockReturnValue(null),
}));

// Import after all mocks are set up
import { checkAllPermissions } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import { stopGpsWatch } from 'gps-plus-slam-app-framework/sensors/gps';
import { initReplayUI, switchToReplayMode } from './ui/replay-ui';
import { updateStatus, showUnsupportedPlatformNotice } from './ui/hud';

describe('main.ts replay mode wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up minimal DOM
    document.body.innerHTML = `
      <div id="app"></div>
      <div id="setup-modal">
        <h1 id="setup-title">Recorder</h1>
      </div>
      <div id="controls"></div>
      <div id="replay-controls" class="hidden"></div>
      <div id="ref-point-picker-modal"></div>
    `;
  });

  // 30 s test budget to match the generous waitFor below (load-dependent).
  it(
    'switches to replay mode when WebXR is not supported',
    { timeout: 30_000 },
    async () => {
      // Simulate WebXR not available
      (checkAllPermissions as Mock).mockResolvedValue({
        webxr: { supported: false },
        geolocation: { granted: false },
        camera: { granted: false },
        deviceOrientation: { granted: false },
        allMandatoryReady: false,
      });

      // Dynamically import main to trigger the main() call
      await import('./main');

      // Wait for the async main() to reach its replay branch. Poll for the signal
      // instead of a fixed `setTimeout(100)` — that fixed wait was flaky under
      // full-suite scheduling load (it passed in isolation but intermittently
      // failed when the whole unit suite ran). Once switchToReplayMode is called,
      // the rest of the replay-branch calls below have already run synchronously.
      // 15 s: the dynamic main.ts import above transitively pulls in three.js and
      // the framework, which under full-suite parallel load alone can take
      // several seconds — 3 s still timed out spuriously (2026-07-02).
      await vi.waitFor(() => expect(switchToReplayMode).toHaveBeenCalled(), {
        timeout: 15_000,
      });

      // Verify initReplayUI was called with callbacks
      expect(initReplayUI).toHaveBeenCalledWith(
        expect.objectContaining({
          onScenarioChange: expect.any(Function),
          onSessionSelect: expect.any(Function),
          onStartReplay: expect.any(Function),
          onPlayPause: expect.any(Function),
          onSpeedChange: expect.any(Function),
          onCameraToggle: expect.any(Function),
        })
      );

      // Verify status updated for replay mode
      expect(updateStatus).toHaveBeenCalledWith(
        expect.stringContaining('Replay Mode')
      );

      // D1 (2026-06-16 user feedback, Finding 1): the prominent unsupported-platform
      // notice must be revealed so the user understands *why* recording is off
      // (typically iOS) instead of a silent drop into replay mode.
      expect(showUnsupportedPlatformNotice).toHaveBeenCalled();

      // Bug 5 (SPA audit): GPS warm-up watch must be stopped when entering
      // replay mode to avoid draining battery on mobile devices.
      expect(stopGpsWatch).toHaveBeenCalled();
    }
  );
});
