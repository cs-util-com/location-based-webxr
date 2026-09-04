// @vitest-environment jsdom
/**
 * Integration tests for the live loop-closure capture wiring in main.ts
 * (2026-07-06 recorder wiring plan, W3).
 *
 * Why these tests matter:
 * The recorder is the ONLY producer of `arLoopClosureDetected` actions in
 * field recordings — the whole corpus is loop-closure-free because nothing
 * ever wired the library detector in. These tests pin:
 *  - the wiring is strictly opt-in (`loopClosureDebug.detectorEnabled`,
 *    default OFF ⇒ no handler, no per-frame callback, zero cost),
 *  - when ON, each XR frame's RAW WebXR pose is converted to tuples and fed
 *    into the handler bound to the CURRENT store,
 *  - tracking loss / origin resets clear the handler's last-pose memory so a
 *    recovery jump is never recorded as a loop closure,
 *  - the per-frame registration is disposed on re-enter and on resetMainState
 *    (no leaked callbacks across enter-AR cycles).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './test-utils/main-module-stubs';

// ---------- hoisted mocks (need to be available before vi.mock factories) ----------

const {
  mockCreateLoopClosureHandler,
  mockLoopClosureHandler,
  mockRegisterXrFrameUpdate,
  xrFrameUnregisterSpies,
  registeredXrFrameCallbacks,
} = vi.hoisted(() => {
  const mockLoopClosureHandler = {
    processPose: vi.fn(),
    setTrackingActive: vi.fn(),
  };
  const xrFrameUnregisterSpies: Array<() => void> = [];
  const registeredXrFrameCallbacks: Array<(ctx: unknown) => void> = [];
  return {
    mockLoopClosureHandler,
    mockCreateLoopClosureHandler: vi.fn(() => mockLoopClosureHandler),
    xrFrameUnregisterSpies,
    registeredXrFrameCallbacks,
    mockRegisterXrFrameUpdate: vi.fn((cb: (ctx: unknown) => void) => {
      registeredXrFrameCallbacks.push(cb);
      const unregister = vi.fn();
      xrFrameUnregisterSpies.push(unregister);
      return unregister;
    }),
  };
});

const { mockGetCurrentArPose, mockRecordingOptions } = vi.hoisted(() => ({
  mockGetCurrentArPose: vi.fn().mockReturnValue(null),
  // Shared mutable options object — main.ts keeps the returned reference, so
  // tests flip `loopClosureDebug.detectorEnabled` between enter-AR calls.
  mockRecordingOptions: {
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
  },
}));

// The store instance handed to createRecorderStore consumers — the handler
// must be bound to exactly this object.
const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    dispatch: vi.fn(),
    getState: vi.fn().mockReturnValue({}),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

// ---------- mocks for all main.ts dependencies ----------

vi.mock('gps-plus-slam-app-framework/ar/xr-frame-loop', () => ({
  registerXrFrameUpdate: mockRegisterXrFrameUpdate,
}));

vi.mock('gps-plus-slam-app-framework/core', () => ({
  odometryTrackingRestarted: vi.fn((payload: unknown) => ({
    type: 'gpsData/odometryTrackingRestarted',
    payload,
  })),
  createLoopClosureHandler: mockCreateLoopClosureHandler,
}));

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  isWebXRSupported: vi.fn().mockResolvedValue(true),
  getCurrentArPose: mockGetCurrentArPose,
  applyAlignmentMatrix: vi.fn(),
  startImageCapture: vi.fn(),
  stopImageCapture: vi.fn(),
  startDepthCapture: vi.fn(),
  stopDepthCapture: vi.fn(),
  rebindTrackingStore: vi.fn(),
  endARSession: vi.fn(),
  getScene: vi.fn().mockReturnValue({ name: 'scene' }),
  getCamera: vi.fn().mockReturnValue({ name: 'camera' }),
  getArWorldGroup: vi.fn().mockReturnValue({ name: 'ar-world' }),
  getDepthInfoFromFrame: vi.fn(),
  getImageCaptureFrameCount: vi.fn().mockReturnValue(0),
  getDepthSampleCount: vi.fn().mockReturnValue(0),
}));

// ---------- lightweight stubs for the rest of main.ts imports ----------

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
}));
vi.mock('./storage/sync-manager', () => ({
  createSyncManager: vi.fn(),
}));
vi.mock('./state/recorder-store', () => ({
  createRecorderStore: vi.fn(() => mockStore),
  startSession: vi.fn(),
  endSession: vi.fn(),
  add2dImage: vi.fn(),
  recordDepthSample: vi.fn(),
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
  loadRecordingOptions: vi.fn(() => mockRecordingOptions),
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
import { initAR } from 'gps-plus-slam-app-framework/ar/webxr-session';

/** The tracking group main.ts passed to the mocked initAR (setter fold). */
function getTrackingCallbacks() {
  const callbacks = vi.mocked(initAR).mock.calls[0]?.[3];
  expect(callbacks?.tracking).toBeDefined();
  return callbacks!.tracking!;
}

const setupDom = () => {
  document.body.innerHTML = `
    <div id="app"></div>
    <div id="setup-modal">
      <h1 id="setup-title">Recorder</h1>
    </div>
    <div id="controls"></div>
    <div id="replay-controls" class="hidden"></div>
    <div id="ref-point-picker-modal"></div>
  `;
};

const lastFrameCallback = () =>
  registeredXrFrameCallbacks[registeredXrFrameCallbacks.length - 1]!;

describe('loop-closure capture wiring (opt-in)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredXrFrameCallbacks.length = 0;
    xrFrameUnregisterSpies.length = 0;
    mockRecordingOptions.loopClosureDebug.detectorEnabled = false;
    mockGetCurrentArPose.mockReturnValue(null);
    resetMainState();
    setupDom();
  });

  it('OFF (default): no handler is created and no per-frame callback registered', async () => {
    await handleEnterARForTesting();

    expect(mockCreateLoopClosureHandler).not.toHaveBeenCalled();
    expect(mockRegisterXrFrameUpdate).not.toHaveBeenCalled();
  });

  it('ON: feeds the current raw WebXR pose into a handler bound to the session store', async () => {
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    await handleEnterARForTesting();

    expect(mockRegisterXrFrameUpdate).toHaveBeenCalledTimes(1);

    // First frame: handler is created lazily against the CURRENT store and
    // fed the pose converted to tuples (raw WebXR — the reducer converts).
    mockGetCurrentArPose.mockReturnValue({
      position: { x: 1, y: 2, z: 3 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
    lastFrameCallback()({});

    expect(mockCreateLoopClosureHandler).toHaveBeenCalledTimes(1);
    // The handler is given a store that FORWARDS to the session store rather
    // than the store object itself: it dispatches `arLoopClosureDetected`
    // internally, and that action moves the odometry frame — the QR sighting
    // fold has to be told, and there is no callback for it. Asserting the
    // forwarding is the property that matters; asserting object identity
    // would forbid the interception without protecting anything.
    const handed = (
      mockCreateLoopClosureHandler.mock.calls as unknown as {
        dispatch: (a: unknown) => unknown;
        getState: unknown;
      }[][]
    )[0]?.[0];
    expect(handed).toBeDefined();
    if (handed === undefined) return;
    expect(handed.getState).toBe(mockStore.getState);
    handed.dispatch({ type: 'gpsData/arLoopClosureDetected' });
    expect(mockStore.dispatch).toHaveBeenCalledWith({
      type: 'gpsData/arLoopClosureDetected',
    });
    expect(mockLoopClosureHandler.processPose).toHaveBeenCalledWith(
      [1, 2, 3],
      [0, 0, 0, 1]
    );

    // Second frame: the handler is reused (not re-created per frame).
    lastFrameCallback()({});
    expect(mockCreateLoopClosureHandler).toHaveBeenCalledTimes(1);
    expect(mockLoopClosureHandler.processPose).toHaveBeenCalledTimes(2);
  });

  it('ON: skips frames without a pose (tracking lost ⇒ getCurrentArPose null)', async () => {
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    await handleEnterARForTesting();

    mockGetCurrentArPose.mockReturnValue(null);
    lastFrameCallback()({});

    expect(mockLoopClosureHandler.processPose).not.toHaveBeenCalled();
  });

  it('ON: tracking loss deactivates, recovery reactivates the handler', async () => {
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    await handleEnterARForTesting();

    // Materialize the handler with one posed frame.
    mockGetCurrentArPose.mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
    lastFrameCallback()({});

    // Simulate the framework firing the tracking callbacks.
    const tracking = getTrackingCallbacks();
    tracking.onLost!();
    expect(mockLoopClosureHandler.setTrackingActive).toHaveBeenCalledWith(
      false
    );

    tracking.onRecovered!();
    expect(mockLoopClosureHandler.setTrackingActive).toHaveBeenLastCalledWith(
      true
    );
  });

  it('ON: an origin-reset restart clears the last-pose memory before reactivating', async () => {
    // Why this matters: a reference-space reset jumps the pose by design — the
    // handler must forget its pre-reset pose (deactivate ⇒ reset) and only
    // then re-arm, or the recovery jump would be recorded as a loop closure.
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    await handleEnterARForTesting();

    mockGetCurrentArPose.mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
    lastFrameCallback()({});
    mockLoopClosureHandler.setTrackingActive.mockClear();

    const restartCb = getTrackingCallbacks().onRestarted! as (
      payload: unknown
    ) => void;
    restartCb({});

    const calls = mockLoopClosureHandler.setTrackingActive.mock.calls.map(
      (c) => c[0] as boolean
    );
    expect(calls).toEqual([false, true]);
  });

  it('disposes the per-frame registration on re-enter and on resetMainState', async () => {
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    await handleEnterARForTesting();
    expect(xrFrameUnregisterSpies).toHaveLength(1);
    expect(xrFrameUnregisterSpies[0]).not.toHaveBeenCalled();

    await handleEnterARForTesting();
    expect(xrFrameUnregisterSpies).toHaveLength(2);
    // First registration torn down before the second is wired.
    expect(xrFrameUnregisterSpies[0]).toHaveBeenCalledTimes(1);
    expect(xrFrameUnregisterSpies[1]).not.toHaveBeenCalled();

    resetMainState();
    expect(xrFrameUnregisterSpies[1]).toHaveBeenCalledTimes(1);
  });

  it('tears down the per-frame registration when a later Enter-AR step throws', async () => {
    // Why this test matters: the catch in handleEnterAR ends the XR session,
    // but the resources registered BEFORE the throw (here the loop-closure
    // frame feed) live in arSessionScope, which endARSession knows nothing
    // about. Left registered, the feed keeps running against a dead session
    // until the NEXT Enter AR disposes it - the "broken half-initialized
    // state" the catch's own comment says it prevents.
    mockRecordingOptions.loopClosureDebug.detectorEnabled = true;
    const { subscribeHudToTrackingQuality } =
      await import('./ui/hud-tracking-quality-subscriber');
    vi.mocked(subscribeHudToTrackingQuality).mockImplementationOnce(() => {
      throw new Error('post-init failure');
    });

    await handleEnterARForTesting();

    expect(xrFrameUnregisterSpies).toHaveLength(1);
    expect(xrFrameUnregisterSpies[0]).toHaveBeenCalledTimes(1);
  });
});
