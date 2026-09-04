// @vitest-environment jsdom
/**
 * Integration tests for the live-QR wiring in live AR mode (main.ts) — recorder
 * live-QR WS-2/WS-5.
 *
 * Why these tests matter: QR capture is OPT-IN (recording-options `qr.enabled`).
 * When enabled, handleEnterAR MUST register the camera-frame callback BEFORE
 * initAR and wire the producer + debug viz (`wireQrRecording`) after AR init; and
 * resetMainState / re-entry MUST dispose that wiring (subscription/GPU-leak
 * regression). The `qr.enabled === false` (NOT wired) side is covered by the other
 * main.*-wiring tests, whose options have qr disabled and which never call
 * `wireQrRecording`. Mock harness follows the occupancy-cubes precedent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './test-utils/main-module-stubs';

// ---------- hoisted mocks ----------

const { mockWireQrRecording, qrRecordingDisposers } = vi.hoisted(() => {
  const qrRecordingDisposers: Array<() => void> = [];
  return {
    qrRecordingDisposers,
    mockWireQrRecording: vi.fn((_options: unknown) => {
      const dispose = vi.fn();
      qrRecordingDisposers.push(dispose);
      return dispose;
    }),
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

// ---------- module under test seam ----------

vi.mock('./qr/wire-qr-recording', () => ({
  wireQrRecording: mockWireQrRecording,
}));

// ---------- framework + app mocks (occupancy-cubes precedent) ----------

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
  startCameraFrameCapture: vi.fn(),
  stopCameraFrameCapture: vi.fn(),
  rebindTrackingStore: vi.fn(),
  getScene: mockGetScene,
  getCamera: mockGetCamera,
  getArWorldGroup: mockGetArWorldGroup,
  getImageCaptureFrameCount: vi.fn().mockReturnValue(0),
  getDepthSampleCount: vi.fn().mockReturnValue(0),
}));
vi.mock('gps-plus-slam-js', () => ({
  odometryTrackingRestarted: vi.fn((payload: unknown) => ({
    type: 'gpsData/odometryTrackingRestarted',
    payload,
  })),
}));

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
vi.mock('./ui/confirm-dialog', () => ({
  destroyConfirmDialog: vi.fn(),
  showConfirmDialog: vi.fn(),
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
  clearRefPointsCacheForAllScenarios: vi.fn(),
}));
vi.mock('./storage/sync-manager', () => ({ createSyncManager: vi.fn() }));
vi.mock('./state/recorder-store', () => ({
  createRecorderStore: vi.fn().mockReturnValue({
    dispatch: vi.fn(),
    getState: vi.fn().mockReturnValue({}),
    subscribe: vi.fn().mockReturnValue(() => {}),
    writeFrame: vi.fn().mockResolvedValue(undefined),
  }),
  startSession: vi.fn(),
  endSession: vi.fn(),
  add2dImage: vi.fn(),
  recordDepthSample: vi.fn(),
  recordQrDetection: vi.fn(),
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
    // QR ENABLED — this file exercises the wired path.
    qr: { enabled: true, intervalMs: 125, captureSize: 1024 },
    images: { enabled: false, intervalMs: 1000, quality: 0.8 },
    depth: { enabled: false, intervalMs: 1000 },
    occupancy: { cellSizeM: 0.15 },
    visualization: {
      frameTiles: false,
      occupancyCubes: false,
      gpsAlignmentMarkers: true,
      compassCubes: false,
    },
    loopClosureDebug: { detectorEnabled: false },
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
    checkNearbyRefPoint: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('./recording/recording-session-handlers', () => ({
  createRecordingSessionHandlers: vi.fn().mockReturnValue({
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    recordCaptureFailure: vi.fn(),
    recordCaptureSuccess: vi.fn(),
    recordWriteSuccess: vi.fn(),
    recordWriteFailure: vi.fn(),
    getCurrentSessionName: vi.fn().mockReturnValue(''),
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

// Import after all mocks are set up.
import { handleEnterARForTesting, resetMainState } from './main';
import { initAR } from 'gps-plus-slam-app-framework/ar/webxr-session';

describe('Live-QR wiring in live AR (qr.enabled)', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
    qrRecordingDisposers.length = 0;
    document.body.innerHTML = `
      <div id="app"></div>
      <div id="setup-modal"><h1 id="setup-title">Recorder</h1></div>
      <div id="controls"></div>
      <div id="replay-controls" class="hidden"></div>
      <div id="ref-point-picker-modal"></div>
    `;
  });

  it('passes the camera-frame callback to initAR and wires QR recording when enabled', async () => {
    await handleEnterARForTesting();

    // Camera-frame callback rides into initAR's callbacks struct (the
    // producer's frame feed) — since the setter fold this replaces the old
    // "setCameraFrameCallback called before initAR" ordering assertion.
    const callbacks = vi.mocked(initAR).mock.calls[0]?.[3];
    expect(typeof callbacks?.cameraFrame?.onFrame).toBe('function');

    // QR recording wired once, after AR init, with the expected options.
    expect(mockWireQrRecording).toHaveBeenCalledTimes(1);
    const opts = mockWireQrRecording.mock.calls[0]?.[0] as {
      storeRef: unknown;
      getArWorldGroup: unknown;
      qr: { enabled: boolean; intervalMs: number; captureSize: number };
      setProducer: unknown;
    };
    expect(opts.storeRef).toBeDefined();
    expect(opts.getArWorldGroup).toBe(mockGetArWorldGroup);
    expect(opts.qr).toEqual({
      enabled: true,
      intervalMs: 125,
      captureSize: 1024,
    });
    expect(typeof opts.setProducer).toBe('function');
  });

  it('resetMainState disposes the QR recording wiring', async () => {
    await handleEnterARForTesting();
    expect(qrRecordingDisposers).toHaveLength(1);

    resetMainState();
    expect(qrRecordingDisposers[0]).toHaveBeenCalledTimes(1);
  });

  it('disposes the prior QR wiring when handleEnterAR re-enters', async () => {
    await handleEnterARForTesting();
    expect(qrRecordingDisposers[0]).not.toHaveBeenCalled();

    await handleEnterARForTesting();
    expect(qrRecordingDisposers[0]).toHaveBeenCalledTimes(1);
    expect(mockWireQrRecording).toHaveBeenCalledTimes(2);
  });

  it('does not wire QR recording when the AR world group is unavailable', async () => {
    mockGetArWorldGroup.mockReturnValueOnce(null);
    await handleEnterARForTesting();
    expect(mockWireQrRecording).not.toHaveBeenCalled();
  });
});
