// @vitest-environment jsdom
/**
 * Integration tests for Issue 8: CameraFollower wiring in live AR mode (main.ts).
 *
 * Why these tests matter:
 * These tests verify that handleEnterAR creates a CameraFollower and compass cubes,
 * wires the follower update into the per-frame callback, and passes the follower
 * as mapParent when creating the MapOverlay. Without these, a regression could
 * silently break the GPS-aligned map / compass cubes in live AR.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- hoisted mocks (need to be available before vi.mock factories) ----------

const { mockCreateCameraFollower, mockFollower, mockCreateGpsCompassCubes } =
  vi.hoisted(() => {
    const mockFollower = {
      object3D: { name: 'camera-follower' }, // matches SCENE_NODE.CAMERA_FOLLOWER
      update: vi.fn(),
      dispose: vi.fn(),
    };
    return {
      mockCreateCameraFollower: vi.fn().mockReturnValue(mockFollower),
      mockFollower,
      mockCreateGpsCompassCubes: vi.fn(),
    };
  });

const { mockGetArWorldGroup, mockGetScene, mockGetCamera } = vi.hoisted(() => {
  const mockArWorldGroup = { name: 'ar-world' };
  const mockScene = { name: 'scene' };
  const mockCamera = { name: 'camera' };
  return {
    mockGetArWorldGroup: vi.fn().mockReturnValue(mockArWorldGroup),
    mockGetScene: vi.fn().mockReturnValue(mockScene),
    mockGetCamera: vi.fn().mockReturnValue(mockCamera),
  };
});

// Tracking-quality subscriber spy. Each call returns a distinct dispose spy so
// tests can assert prior subscriptions are disposed before a new one is wired.
const { mockSubscribeHudToTrackingQuality, trackingQualityDisposers } =
  vi.hoisted(() => {
    const trackingQualityDisposers: Array<() => void> = [];
    return {
      trackingQualityDisposers,
      mockSubscribeHudToTrackingQuality: vi.fn(() => {
        const dispose = vi.fn();
        trackingQualityDisposers.push(dispose);
        return dispose;
      }),
    };
  });

// ---------- mocks for all main.ts dependencies ----------

vi.mock('gps-plus-slam-app-framework/visualization/camera-follower', () => ({
  createCameraFollower: mockCreateCameraFollower,
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-compass-cubes', () => ({
  createGpsCompassCubes: mockCreateGpsCompassCubes,
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
  getArWorldGroup: mockGetArWorldGroup,
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
vi.mock('./ui/session-browser', () => ({
  DEFAULT_SCENARIO: 'Default Scenario',
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
vi.mock('gps-plus-slam-app-framework/visualization/reference-points', () => ({
  refPointVisualizer: {},
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: { setVisible: vi.fn(), clearAll: vi.fn() },
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/leaflet-map-overlay',
  () => ({
    LeafletMapOverlay: vi.fn().mockImplementation(() => ({
      isVisible: vi.fn().mockReturnValue(false),
      toggle: vi.fn(),
      updatePosition: vi.fn(),
      setGpsPosition: vi.fn(),
      getGpsPosition: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    })),
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
// Spy on the HUD tracking-quality subscriber so we can assert the dispose
// handle returned by `subscribeHudToTrackingQuality` is honored across
// enter-AR cycles and on resetMainState (subscription-leak regression).
vi.mock('./ui/hud-tracking-quality-subscriber', () => ({
  subscribeHudToTrackingQuality: mockSubscribeHudToTrackingQuality,
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
import { handleEnterARForTesting, resetMainState } from './main';

describe('Issue 8: CameraFollower wiring in live AR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackingQualityDisposers.length = 0;
    resetMainState();

    // Set up minimal DOM expected by main.ts module init
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
   * Issue 8 requires a CameraFollower at the scene root (not arWorldGroup)
   * so compass cubes stay GPS-aligned regardless of alignment matrix changes.
   * If the follower is not created during AR init, compass directions will
   * rotate with the alignment matrix (the discovered bug).
   */
  it('creates CameraFollower with scene root after AR init', async () => {
    await handleEnterARForTesting();

    expect(mockCreateCameraFollower).toHaveBeenCalledTimes(1);
    expect(mockCreateCameraFollower).toHaveBeenCalledWith(mockGetScene());
  });

  /**
   * Why this test matters:
   * Compass cubes provide cardinal direction indicators. They must be children
   * of the follower so they track the camera's position but stay GPS-aligned.
   */
  it('creates GpsCompassCubes on the follower after AR init', async () => {
    await handleEnterARForTesting();

    expect(mockCreateGpsCompassCubes).toHaveBeenCalledTimes(1);
    expect(mockCreateGpsCompassCubes).toHaveBeenCalledWith(
      mockFollower.object3D
    );
  });

  /**
   * Why this test matters:
   * The follower must be updated every XR frame so the map tracks the camera
   * smoothly. If the frame callback doesn't call follower.update(), the map
   * will remain at origin instead of following the user.
   */
  it('frame callback updates the CameraFollower', async () => {
    await handleEnterARForTesting();

    // Since the setter fold, the per-frame tick rides into initAR's
    // callbacks struct as `onFrame`.
    const { initAR } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const frameCallback = vi.mocked(initAR).mock.calls[0]?.[3]?.onFrame;
    expect(typeof frameCallback).toBe('function');

    // Invoke the callback — it should call follower.update()
    frameCallback!();

    expect(mockFollower.update).toHaveBeenCalledTimes(1);
    // Should pass camera and a positive dt (no arWorldGroup needed)
    const [camera, dt] = mockFollower.update.mock.calls[0];
    expect(camera).toBe(mockGetCamera());
    expect(dt).toBeGreaterThanOrEqual(0);
  });

  /**
   * Why this test matters:
   * If arWorldGroup or scene is null (unexpected state), the follower should
   * not be created and the frame callback should still function (no crash).
   */
  it('skips follower creation when arWorldGroup is null', async () => {
    mockGetArWorldGroup.mockReturnValueOnce(null);

    await handleEnterARForTesting();

    expect(mockCreateCameraFollower).not.toHaveBeenCalled();
    expect(mockCreateGpsCompassCubes).not.toHaveBeenCalled();
  });

  it('skips follower creation when scene is null', async () => {
    mockGetScene.mockReturnValueOnce(null);

    await handleEnterARForTesting();

    expect(mockCreateCameraFollower).not.toHaveBeenCalled();
    expect(mockCreateGpsCompassCubes).not.toHaveBeenCalled();
  });
});

/**
 * Tracking-quality HUD subscription lifecycle.
 *
 * Why these tests matter:
 * `subscribeHudToTrackingQuality` returns a dispose function that detaches both
 * the per-store subscription and the store-swap listener. `handleEnterAR` can
 * run multiple times per page load (back to setup → Enter AR again). If the
 * dispose handle is ignored, every cycle appends another `storeRef` + `store`
 * subscriber that is never cleaned up — leaking memory and firing redundant HUD
 * updates. These tests pin the dispose-before-resubscribe and reset behavior.
 */
describe('Tracking-quality HUD subscription cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackingQualityDisposers.length = 0;
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

  it('subscribes the HUD to tracking quality on AR entry', async () => {
    await handleEnterARForTesting();

    expect(mockSubscribeHudToTrackingQuality).toHaveBeenCalledTimes(1);
    expect(trackingQualityDisposers).toHaveLength(1);
    // The single live subscription must still be active (not disposed).
    expect(trackingQualityDisposers[0]).not.toHaveBeenCalled();
  });

  it('disposes the previous subscription before re-subscribing on a second AR entry', async () => {
    await handleEnterARForTesting();
    await handleEnterARForTesting();

    expect(mockSubscribeHudToTrackingQuality).toHaveBeenCalledTimes(2);
    expect(trackingQualityDisposers).toHaveLength(2);
    // First subscription was torn down; only the latest stays active.
    expect(trackingQualityDisposers[0]).toHaveBeenCalledTimes(1);
    expect(trackingQualityDisposers[1]).not.toHaveBeenCalled();
  });

  it('disposes the live subscription on resetMainState', async () => {
    await handleEnterARForTesting();
    expect(trackingQualityDisposers[0]).not.toHaveBeenCalled();

    resetMainState();

    expect(trackingQualityDisposers[0]).toHaveBeenCalledTimes(1);
  });
});

/**
 * Why these tests matter:
 * Round-3 feedback (2026-07-05): the ref-point view wirers (3D spheres +
 * live-map markers) used to be session-scoped, so a folder import finishing
 * before the first recording filled the store with no view subscribed. They
 * are now AR-scoped and storeRef-following (ui/ref-point-view-wiring.ts) —
 * wired at Enter AR, disposed before re-wiring on a second entry and on
 * resetMainState, mirroring the tracking-quality subscription lifecycle.
 */
describe('Ref-point view wiring lifecycle (AR-scoped)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  function wiringResult(index: number): {
    unsubscribe: ReturnType<typeof vi.fn>;
  } {
    return vi.mocked(wireRefPointViews).mock.results[index]!.value as {
      unsubscribe: ReturnType<typeof vi.fn>;
    };
  }

  it('wires the ref-point views on AR entry (storeRef-following, AR_READY covered)', async () => {
    await handleEnterARForTesting();

    expect(wireRefPointViews).toHaveBeenCalledTimes(1);
    expect(wiringResult(0).unsubscribe).not.toHaveBeenCalled();
  });

  it('disposes the previous wiring before re-wiring on a second AR entry', async () => {
    await handleEnterARForTesting();
    await handleEnterARForTesting();

    expect(wireRefPointViews).toHaveBeenCalledTimes(2);
    expect(wiringResult(0).unsubscribe).toHaveBeenCalledTimes(1);
    expect(wiringResult(1).unsubscribe).not.toHaveBeenCalled();
  });

  it('disposes the live wiring on resetMainState', async () => {
    await handleEnterARForTesting();

    resetMainState();

    expect(wiringResult(0).unsubscribe).toHaveBeenCalledTimes(1);
  });
});
