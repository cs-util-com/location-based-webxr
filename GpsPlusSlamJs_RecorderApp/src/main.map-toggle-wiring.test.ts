// @vitest-environment jsdom
/**
 * Integration tests for the map-toggle → ref-point-marker refresh wiring in
 * `handleToggleMap` (main.ts).
 *
 * Why these tests matter:
 * The 2026-07-06 round-4 live-map feedback found the AR minimap stayed empty
 * for a whole recording while the summary map showed the same store state.
 * Root cause: `handleToggleMap` refreshed the ref-point map markers BEFORE
 * `mapOverlay.toggle()` — but the overlay creates its inner Leaflet map only
 * inside `show()`, so the refresh always ran against a null map. These tests
 * pin the corrected ordering (refresh AFTER toggle, whenever the map ends up
 * visible) including the re-show path, which matters in store-event-free
 * phases (AR_READY has no GPS watch, so the wirer's subscriber never fires).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- hoisted mocks (need to be available before vi.mock factories) ----------

const { mockGetScene, mockGetCamera, mockLeafletOverlayInstances } = vi.hoisted(
  () => {
    const mockScene = { name: 'scene' };
    const mockCamera = { name: 'camera' };
    return {
      mockGetScene: vi.fn().mockReturnValue(mockScene),
      mockGetCamera: vi.fn().mockReturnValue(mockCamera),
      // Every LeafletMapOverlay the module under test constructs, so tests
      // can assert against the exact instance handleToggleMap used.
      mockLeafletOverlayInstances: [] as Array<{
        isVisible: ReturnType<typeof vi.fn>;
        toggle: ReturnType<typeof vi.fn>;
        setGpsPosition: ReturnType<typeof vi.fn>;
        getGpsPosition: ReturnType<typeof vi.fn>;
        getLeafletMap: ReturnType<typeof vi.fn>;
        updatePosition: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
      }>,
    };
  }
);

// ---------- mocks for all main.ts dependencies ----------

vi.mock('gps-plus-slam-app-framework/visualization/camera-follower', () => ({
  createCameraFollower: vi.fn().mockReturnValue({
    object3D: { name: 'camera-follower' },
    update: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-compass-cubes', () => ({
  createGpsCompassCubes: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  isWebXRSupported: vi.fn().mockResolvedValue(true),
  getCurrentArPose: vi.fn().mockReturnValue(null),
  applyAlignmentMatrix: vi.fn(),
  startImageCapture: vi.fn(),
  stopImageCapture: vi.fn(),
  startDepthCapture: vi.fn(),
  stopDepthCapture: vi.fn(),
  rebindTrackingStore: vi.fn(),
  getScene: mockGetScene,
  getCamera: mockGetCamera,
  getArWorldGroup: vi.fn().mockReturnValue({ name: 'ar-world' }),
  getImageCaptureFrameCount: vi.fn().mockReturnValue(0),
  getDepthSampleCount: vi.fn().mockReturnValue(0),
}));

// ---------- lightweight stubs for the rest of main.ts imports ----------

vi.mock('./utils/sentry', () => ({ initSentry: vi.fn() }));
vi.mock('gps-plus-slam-js', () => ({
  odometryTrackingRestarted: vi.fn((payload: unknown) => ({
    type: 'gpsData/odometryTrackingRestarted',
    payload,
  })),
}));
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

import { wireRefPointViews } from './ui/ref-point-view-wiring';

vi.mock('./ui/hud', () => ({
  initUI: vi.fn(),
  showError: vi.fn(),
  updateStatus: vi.fn(),
  updateArInfo: vi.fn(),
  updateGpsInfo: vi.fn(),
  updateFrameCount: vi.fn(),
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
}));

import { showError } from './ui/hud';

vi.mock('./ui/toast', () => ({
  initToast: vi.fn(),
  showToast: vi.fn(),
  TOAST_DURATION_ERROR: 5000,
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
vi.mock('./ui/confirm-dialog', () => ({
  destroyConfirmDialog: vi.fn(),
  showConfirmDialog: vi.fn(),
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
vi.mock('./storage/recording-discovery', () => ({
  listScenariosFromFolder: vi.fn(),
  extractScenarioNamesFromZips: vi.fn(),
  discoverScenariosFromZipMetadata: vi.fn(),
  listSessionZipsInScenario: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/xr-error-handler', () => ({
  getXrErrorMessage: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/replay-scene', () => ({
  initReplayScene: vi.fn(),
  disposeReplayScene: vi.fn(),
  toggleCameraMode: vi.fn(),
  getCameraMode: vi.fn().mockReturnValue('orbit'),
  getCameraFollower: vi.fn(),
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
vi.mock('gps-plus-slam-app-framework/storage/file-system-utils', () => ({
  formatTimestamp: vi.fn(),
  SESSION_IMAGES_DIR: 'images',
}));
vi.mock('gps-plus-slam-app-framework/utils/fused-path', () => ({
  computeFusedPath: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/utils/list-formatter', () => ({
  listFormatter: { format: vi.fn() },
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
vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: vi.fn().mockReturnValue(() => {}),
}));
vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  createGpsPositionHandler: vi.fn().mockReturnValue(() => {}),
  updateDeviceOrientation: vi.fn(),
  resetCoordinatorState: vi.fn(),
  extractOdomPosition: vi.fn().mockReturnValue([0, 0, 0]),
  extractOdomRotation: vi.fn().mockReturnValue([0, 0, 0, 1]),
}));
vi.mock('./state/recording-options', () => ({
  // main.ts also consumes the pure compassStoreOptions mapping — stubbed
  // inert here; its real logic is unit-tested in recording-options.test.ts.
  compassStoreOptions: () => ({}),
  loadRecordingOptions: vi.fn().mockReturnValue({
    qr: { enabled: false, intervalMs: 125, captureSize: 1024 },
    images: { enabled: false, intervalMs: 1000, quality: 0.8 },
    depth: { enabled: false, intervalMs: 1000 },
    occupancy: { cellSizeM: 0.15 },
    frameTileDisplay: { divisor: 2 },
    visualization: {
      frameTiles: true,
      occupancyCubes: true,
      gpsAlignmentMarkers: true,
      compassCubes: true,
    },
    loopClosureDebug: { detectorEnabled: false },
  }),
}));
vi.mock('gps-plus-slam-app-framework/sensors/gps', () => ({
  startGpsWatch: vi.fn(),
  stopGpsWatch: vi.fn(),
  startOrientationWatch: vi.fn(),
  stopOrientationWatch: vi.fn(),
  requestOrientationPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock('gps-plus-slam-app-framework/sensors/gps-error-handler', () => ({
  createGpsErrorHandler: vi.fn().mockReturnValue(() => {}),
}));
vi.mock('gps-plus-slam-app-framework/sensors/permission-checker', () => ({
  checkAllPermissions: vi.fn().mockResolvedValue({
    allMandatoryReady: false,
    geolocation: { granted: null, supported: true },
    camera: { granted: null, supported: true },
    webxr: { granted: null, supported: true },
    orientation: { granted: null, supported: true },
    fileSystem: { granted: null, supported: true },
  }),
  requestAllPermissions: vi.fn().mockResolvedValue({
    allMandatoryReady: false,
    geolocation: { granted: false, supported: true },
    camera: { granted: false, supported: true },
    webxr: { granted: false, supported: true },
    orientation: { granted: false, supported: true },
    fileSystem: { granted: false, supported: true },
  }),
  subscribePermissionChanges: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: { setVisible: vi.fn(), clearAll: vi.fn() },
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/leaflet-map-overlay',
  () => ({
    // Stateful visibility so toggle → show → hide → show sequences behave
    // like the real overlay (which persists its Leaflet map across hides).
    // A regular function (not an arrow) so `new LeafletMapOverlay(...)` works.
    LeafletMapOverlay: vi.fn().mockImplementation(function () {
      let visible = false;
      const instance = {
        isVisible: vi.fn(() => visible),
        toggle: vi.fn(() => {
          visible = !visible;
        }),
        setGpsPosition: vi.fn(),
        getGpsPosition: vi.fn().mockReturnValue(null),
        getLeafletMap: vi.fn().mockReturnValue(null),
        updatePosition: vi.fn(),
        dispose: vi.fn(),
      };
      mockLeafletOverlayInstances.push(instance);
      return instance;
    }),
  })
);
vi.mock('gps-plus-slam-app-framework/storage/null-storage-backend', () => ({
  NullStorageBackend: vi.fn(),
}));
vi.mock('./storage/write-failure-tracker', () => ({
  createWriteFailureTracker: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/ar/capture-failure-tracker', () => ({
  createCaptureFailureTracker: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework', () => ({
  selectTrackingQuality: vi.fn().mockReturnValue(null),
}));
vi.mock('./ui/hud-tracking-quality-subscriber', () => ({
  subscribeHudToTrackingQuality: vi.fn(() => vi.fn()),
}));
vi.mock('./replay/replay-handlers', () => ({
  createReplayHandlers: vi.fn().mockReturnValue({
    handleStartReplay: vi.fn(),
    handleStopReplay: vi.fn(),
    handleTogglePlayPause: vi.fn(),
    handleReplaySpeedChange: vi.fn(),
    handleToggleCameraMode: vi.fn(),
    handleReplayScenarioChange: vi.fn(),
    handleReplaySessionChange: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('./ref-points/ref-point-handlers', () => ({
  createRefPointHandlers: vi.fn().mockReturnValue({
    handleMarkRefPoint: vi.fn(),
    handleImportKml: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('./recording/recording-session-handlers', () => ({
  createRecordingSessionHandlers: vi.fn().mockReturnValue({
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    recordCaptureFailure: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('./storage/folder-manager', () => ({
  createFolderManager: vi.fn().mockReturnValue({
    handleOpenFolder: vi.fn(),
    handleScenarioChange: vi.fn(),
    reset: vi.fn(),
    setCurrentScenarioName: vi.fn(),
    setCachedOpfsScenarios: vi.fn(),
    loadAndDisplayRefPoints: vi.fn(),
    getCurrentScenarioName: vi.fn().mockReturnValue(''),
  }),
}));

// Import after all mocks are set up
import {
  handleEnterARForTesting,
  handleToggleMapForTesting,
  resetMainState,
} from './main';

/** The ref-point view wiring instance created by the last Enter AR. */
function lastRefPointViews(): { refreshMapMarkers: ReturnType<typeof vi.fn> } {
  const results = vi.mocked(wireRefPointViews).mock.results;
  const last = results[results.length - 1];
  if (!last || last.type !== 'return') {
    throw new Error('wireRefPointViews was not called');
  }
  return last.value as unknown as {
    refreshMapMarkers: ReturnType<typeof vi.fn>;
  };
}

describe('map-toggle → ref-point marker refresh wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeafletOverlayInstances.length = 0;
    resetMainState();

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

  /**
   * Why this test matters:
   * The overlay creates its inner Leaflet map only inside show() (called by
   * toggle()), so a refresh that runs before toggle() always sees a null map
   * and draws nothing — the exact 2026-07-06 round-4 bug where the live
   * minimap stayed empty despite the imported ref points sitting in the
   * store. The refresh must run AFTER toggle() made the map visible.
   */
  it('first toggle refreshes ref-point markers AFTER the overlay was toggled visible', async () => {
    await handleEnterARForTesting();
    const refPointViews = lastRefPointViews();

    handleToggleMapForTesting();

    const overlay = mockLeafletOverlayInstances[0];
    expect(overlay).toBeDefined();
    expect(overlay!.toggle).toHaveBeenCalledTimes(1);
    expect(refPointViews.refreshMapMarkers).toHaveBeenCalledTimes(1);
    const toggleOrder = overlay!.toggle.mock.invocationCallOrder[0]!;
    const refreshOrder =
      refPointViews.refreshMapMarkers.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeGreaterThan(toggleOrder);
  });

  /**
   * Why this test matters:
   * Phases without store events (AR_READY has no GPS watch → no dispatches)
   * cannot rely on the wirer's store subscriber to draw after a re-show, so
   * every toggle that ends visible must refresh — while a toggle that hides
   * the map must not.
   */
  it('re-show refreshes again; hiding does not refresh', async () => {
    await handleEnterARForTesting();
    const refPointViews = lastRefPointViews();

    handleToggleMapForTesting(); // show
    expect(refPointViews.refreshMapMarkers).toHaveBeenCalledTimes(1);

    handleToggleMapForTesting(); // hide
    expect(refPointViews.refreshMapMarkers).toHaveBeenCalledTimes(1);

    handleToggleMapForTesting(); // re-show
    expect(refPointViews.refreshMapMarkers).toHaveBeenCalledTimes(2);
    // Still the same overlay instance — the map persists across hide/show.
    expect(mockLeafletOverlayInstances).toHaveLength(1);
  });

  /**
   * Why this test matters:
   * Before AR the scene/camera are unavailable; the toggle must surface the
   * "enter AR first" error and must not attempt a marker refresh.
   */
  it('toggle before AR shows an error and refreshes nothing', () => {
    mockGetScene.mockReturnValueOnce(null);

    handleToggleMapForTesting();

    expect(showError).toHaveBeenCalledWith(
      'Enter AR session before using the map'
    );
    expect(mockLeafletOverlayInstances).toHaveLength(0);
  });
});
