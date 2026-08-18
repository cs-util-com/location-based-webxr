/**
 * Recording Session Handlers Tests
 *
 * Why these tests matter:
 * The recording-session-handlers module encapsulates all recording lifecycle
 * state and event handlers extracted from main.ts (Finding #7 — main.ts
 * decomposition, Step 3). These tests verify each handler's behavior in
 * isolation, ensuring the extraction preserves the exact same behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RecorderStore } from '../state/recorder-store';
import {
  DEFAULT_RECORDING_OPTIONS,
  type RecordingOptions,
} from '../state/recording-options';
import type { StoreSubscriberDeps } from 'gps-plus-slam-app-framework/state/store-subscribers';
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';
import {
  gpsPathToCoverageCells,
  H3_RESOLUTION,
} from 'gps-plus-slam-app-framework/geo';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockResetCoordinatorState,
  mockCreateGpsPositionHandler,
  mockUpdateDeviceOrientation,
  mockStartGpsWatch,
  mockStopGpsWatch,
  mockStartOrientationWatch,
  mockStopOrientationWatch,
  mockStartAbsoluteOrientationWatch,
  mockStopAbsoluteOrientationWatch,
  mockFormatTimestamp,
  mockStartStorageSession,
  mockGetCurrentScenarioHandle,
  mockWireStoreSubscribers,
  mockCreateWriteFailureTracker,
  mockCreateCaptureFailureTracker,
  mockStartSession,
  mockEndSession,
  mockStartImageCapture,
  mockStopImageCapture,
  mockSetImageQualityAnalyzer,
  mockCreateImageQualityAnalyzer,
  mockImageQualityClientInstance,
  mockStartDepthCapture,
  mockStopDepthCapture,
  mockGetImageCaptureFrameCount,
  mockGetDepthSampleCount,
  mockGetSaveFileHandle,
  mockGetSaveFileName,
  mockGenerateSessionFilename,
  mockCreateSyncManager,
  mockSyncToExternalZip,
  mockExportSessionAsZip,
  mockEnableBeforeUnloadWarning,
  mockDisableBeforeUnloadWarning,
  mockPushScreenState,
  mockReplaceScreenState,
  mockShowRecordingControls,
  mockHideRecordingControls,
  mockSetStopButtonBusy,
  mockShowError,
  mockUpdateStatus,
  mockHideFrameCount,
  mockShowSessionSummary,
  mockShowConfirmDialog,
  mockGpsEventVisualizer,
  mockRefPointVisualizer,
  mockComputeFusedPath,
  mockCreateGpsErrorHandler,
  mockGetCurrentArPose,
  mockCalcGpsCoords,
  mockGetBuildInfo,
  mockSyncManagerInstance,
  mockWriteFailureTrackerInstance,
  mockCaptureFailureTrackerInstance,
  mockUnsubscribe,
} = vi.hoisted(() => {
  const mockSyncManagerInstance = {
    start: vi.fn(),
    stop: vi.fn(),
    syncNow: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ state: 'idle' }),
  };

  const mockWriteFailureTrackerInstance = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getFailureCount: vi.fn().mockReturnValue(0),
    hasWarned: vi.fn().mockReturnValue(false),
    reset: vi.fn(),
  };

  const mockCaptureFailureTrackerInstance = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getFailureCount: vi.fn().mockReturnValue(0),
    hasWarned: vi.fn().mockReturnValue(false),
    reset: vi.fn(),
  };

  const mockUnsubscribe = vi.fn();

  const mockImageQualityClientInstance = {
    analyze: vi.fn().mockResolvedValue({ accept: true, reason: null }),
    dispose: vi.fn(),
  };

  return {
    mockSetImageQualityAnalyzer: vi.fn(),
    mockCreateImageQualityAnalyzer: vi
      .fn()
      .mockReturnValue(mockImageQualityClientInstance),
    mockImageQualityClientInstance,
    mockResetCoordinatorState: vi.fn(),
    mockCreateGpsPositionHandler: vi.fn().mockReturnValue(() => {}),
    mockUpdateDeviceOrientation: vi.fn(),
    mockStartGpsWatch: vi.fn(),
    mockStopGpsWatch: vi.fn(),
    mockStartOrientationWatch: vi.fn(),
    mockStopOrientationWatch: vi.fn(),
    mockStartAbsoluteOrientationWatch: vi.fn().mockResolvedValue(undefined),
    mockStopAbsoluteOrientationWatch: vi.fn(),
    mockFormatTimestamp: vi.fn().mockReturnValue('2026-01-01_12-00-00'),
    mockStartStorageSession: vi.fn().mockResolvedValue(undefined),
    mockGetCurrentScenarioHandle: vi
      .fn()
      .mockReturnValue(null as FileSystemDirectoryHandle | null),
    mockWireStoreSubscribers: vi.fn().mockReturnValue(mockUnsubscribe),
    mockCreateWriteFailureTracker: vi
      .fn()
      .mockReturnValue(mockWriteFailureTrackerInstance),
    mockCreateCaptureFailureTracker: vi
      .fn()
      .mockReturnValue(mockCaptureFailureTrackerInstance),
    mockStartSession: vi.fn((payload: unknown) => ({
      type: 'recording/startSession',
      payload,
    })),
    mockEndSession: vi.fn(() => ({ type: 'recording/endSession' })),
    mockStartImageCapture: vi.fn(),
    mockStopImageCapture: vi.fn(),
    mockStartDepthCapture: vi.fn(),
    mockStopDepthCapture: vi.fn(),
    mockGetImageCaptureFrameCount: vi.fn().mockReturnValue(0),
    mockGetDepthSampleCount: vi.fn().mockReturnValue(0),
    mockGetSaveFileHandle: vi.fn().mockReturnValue(null),
    mockGetSaveFileName: vi.fn().mockReturnValue(null),
    mockGenerateSessionFilename: vi
      .fn()
      .mockReturnValue('2026-01-01_12-00-00utc.zip'),
    mockCreateSyncManager: vi.fn().mockReturnValue(mockSyncManagerInstance),
    mockSyncToExternalZip: vi.fn().mockResolvedValue(undefined),
    mockExportSessionAsZip: vi
      .fn()
      .mockResolvedValue({ blob: new Blob(['test']), fileCount: 1 }),
    mockEnableBeforeUnloadWarning: vi.fn(),
    mockDisableBeforeUnloadWarning: vi.fn(),
    mockPushScreenState: vi.fn(),
    mockReplaceScreenState: vi.fn(),
    mockShowRecordingControls: vi.fn(),
    mockHideRecordingControls: vi.fn(),
    mockSetStopButtonBusy: vi.fn(),
    mockShowError: vi.fn(),
    mockUpdateStatus: vi.fn(),
    mockHideFrameCount: vi.fn(),
    mockShowSessionSummary: vi.fn(),
    mockShowConfirmDialog: vi.fn().mockResolvedValue(false),
    mockGpsEventVisualizer: {
      clearAll: vi.fn(),
      setVisible: vi.fn(),
      getCounts: vi.fn().mockReturnValue({ raw: 0, fused: 0, snapshots: 0 }),
      getAlignmentSnapshotPositions: vi.fn().mockReturnValue([]),
    },
    mockRefPointVisualizer: {
      setZeroRef: vi.fn(),
    },
    mockComputeFusedPath: vi.fn().mockReturnValue([]),
    mockCreateGpsErrorHandler: vi.fn().mockReturnValue(() => {}),
    mockGetCurrentArPose: vi.fn().mockReturnValue(null),
    mockCalcGpsCoords: vi
      .fn()
      .mockImplementation(
        (_origin: { lat: number; lon: number }, pos: number[]) => ({
          lat: 50 + pos[0] * 0.00001,
          lon: 8 + pos[2] * 0.00001,
        })
      ),
    mockGetBuildInfo: vi.fn().mockReturnValue({
      commitHash: 'abc1234',
      appVersion: '0.1.0',
      libraryVersion: '1.0.0',
      frameworkVersion: '0.1.0',
      buildTime: '2026-04-20T10:00:00.000Z',
    }),
    mockSyncManagerInstance,
    mockWriteFailureTrackerInstance,
    mockCaptureFailureTrackerInstance,
    mockUnsubscribe,
  };
});

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  resetCoordinatorState: mockResetCoordinatorState,
  createGpsPositionHandler: mockCreateGpsPositionHandler,
  updateDeviceOrientation: mockUpdateDeviceOrientation,
}));

vi.mock('gps-plus-slam-app-framework/sensors/gps', () => ({
  startGpsWatch: mockStartGpsWatch,
  stopGpsWatch: mockStopGpsWatch,
  startOrientationWatch: mockStartOrientationWatch,
  stopOrientationWatch: mockStopOrientationWatch,
}));

vi.mock('gps-plus-slam-app-framework/sensors/absolute-orientation', () => ({
  startAbsoluteOrientationWatch: mockStartAbsoluteOrientationWatch,
  stopAbsoluteOrientationWatch: mockStopAbsoluteOrientationWatch,
  // null → the live-HUD poll is a no-op in tests (no leaked HUD writes).
  getLatestAbsoluteOrientation: vi.fn().mockReturnValue(null),
}));

vi.mock('gps-plus-slam-app-framework/storage/file-system-utils', () => ({
  formatTimestamp: mockFormatTimestamp,
}));

vi.mock('../storage/scenario-storage', () => ({
  startSession: mockStartStorageSession,
  getCurrentScenarioHandle: mockGetCurrentScenarioHandle,
}));

vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: mockWireStoreSubscribers,
}));

// NOTE: '../ui/ref-point-map-markers' is intentionally NOT mocked — the
// handlers only use the pure refPointEntriesToMarkerData mapping. The view
// wirers moved to the AR-scoped ui/ref-point-view-wiring.ts (round-3
// feedback 2026-07-05), covered by its own tests.

// Spy on the recording actions at their true source (post-barrel-removal
// import path). Spread the actual module so every other symbol stays real.
vi.mock(
  'gps-plus-slam-app-framework/state/recording-slice',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    startSession: mockStartSession,
    endSession: mockEndSession,
  })
);

vi.mock('../storage/write-failure-tracker', () => ({
  createWriteFailureTracker: mockCreateWriteFailureTracker,
}));

vi.mock('gps-plus-slam-app-framework/ar/capture-failure-tracker', () => ({
  createCaptureFailureTracker: mockCreateCaptureFailureTracker,
}));

// NOTE: setImageQualityAnalyzer is no longer a framework export (setter fold,
// surface-reduction step 1) — it is an injected dep from main.ts now, so
// `mockSetImageQualityAnalyzer` is wired through createMockDeps below instead.
vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  startImageCapture: mockStartImageCapture,
  stopImageCapture: mockStopImageCapture,
  startDepthCapture: mockStartDepthCapture,
  stopDepthCapture: mockStopDepthCapture,
  getImageCaptureFrameCount: mockGetImageCaptureFrameCount,
  getDepthSampleCount: mockGetDepthSampleCount,
  getCurrentArPose: mockGetCurrentArPose,
}));

vi.mock('./image-quality-client', () => ({
  createImageQualityAnalyzer: mockCreateImageQualityAnalyzer,
}));

vi.mock('../storage/external-file-storage', () => ({
  getSaveFileHandle: mockGetSaveFileHandle,
  getSaveFileName: mockGetSaveFileName,
  generateSessionFilename: mockGenerateSessionFilename,
}));

vi.mock('../storage/sync-manager', () => ({
  createSyncManager: mockCreateSyncManager,
}));

vi.mock('../storage/scenario-zip-export', () => ({
  syncScenarioSessionToExternalZip: mockSyncToExternalZip,
  exportScenarioSessionAsZip: mockExportSessionAsZip,
}));

vi.mock('../ui/navigation', () => ({
  enableBeforeUnloadWarning: mockEnableBeforeUnloadWarning,
  disableBeforeUnloadWarning: mockDisableBeforeUnloadWarning,
  pushScreenState: mockPushScreenState,
  replaceScreenState: mockReplaceScreenState,
}));

vi.mock('../ui/hud', () => ({
  showRecordingControls: mockShowRecordingControls,
  hideRecordingControls: mockHideRecordingControls,
  setStopButtonBusy: mockSetStopButtonBusy,
  showError: mockShowError,
  updateStatus: mockUpdateStatus,
  hideFrameCount: mockHideFrameCount,
  hideTrackingQuality: vi.fn(),
  updateRefPointButtonLabel: vi.fn(),
  setNewRefPointButtonVisible: vi.fn(),
  setAbsCompassStatus: vi.fn(),
  hideAbsCompass: vi.fn(),
}));

vi.mock('../ui/session-summary', () => ({
  showSessionSummary: mockShowSessionSummary,
}));

vi.mock('../ui/confirm-dialog', () => ({
  showConfirmDialog: mockShowConfirmDialog,
}));

vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: mockGpsEventVisualizer,
}));

// NOTE: the handlers import the visualizer singleton from the LOCAL module
// (../visualization/ref-point-visualizer) — an earlier mock of the framework
// path 'gps-plus-slam-app-framework/visualization/reference-points' was stale
// and never intercepted, which went unnoticed while no test exercised the
// zeroRef path (getCurrentScenarioHandle defaulted to null).
vi.mock('../visualization/ref-point-visualizer', () => ({
  refPointVisualizer: mockRefPointVisualizer,
}));

vi.mock('gps-plus-slam-app-framework/utils/fused-path', () => ({
  computeFusedPath: mockComputeFusedPath,
}));

vi.mock('gps-plus-slam-app-framework/sensors/gps-error-handler', () => ({
  createGpsErrorHandler: mockCreateGpsErrorHandler,
}));

vi.mock('gps-plus-slam-app-framework/core', () => ({
  calcGpsCoords: mockCalcGpsCoords,
  magneticHeadingFromEnuQuat: vi.fn().mockReturnValue(0),
}));

vi.mock('../utils/build-info', () => ({
  getBuildInfo: mockGetBuildInfo,
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import {
  createRecordingSessionHandlers,
  type RecordingSessionHandlers,
  type RecordingSessionDeps,
} from './recording-session-handlers';

// ── Helpers ────────────────────────────────────────────────────────────

function createMockStore(): RecorderStore {
  return {
    getState: vi.fn().mockReturnValue({
      gpsData: {
        gpsEvents: {
          gpsPositions: [],
          odometryPositions: [],
        },
        referencePoints: [],
      },
      recording: {
        sessionMetadata: {
          contextTag: 'TestScenario',
          sessionName: 'test-session',
          startTime: 1000000,
        },
        failedWriteCount: 0,
      },
      scenario: {
        currentScenarioName: 'TestScenario',
      },
      refPoints: { entries: [] },
    }),
    subscribe: vi.fn().mockReturnValue(() => {}),
    dispatch: vi.fn(),
    replaceReducer: vi.fn(),
    writeFrame: vi.fn().mockResolvedValue(undefined),
    writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
    flushPendingActionWrites: vi.fn().mockResolvedValue(undefined),
  } as unknown as RecorderStore;
}

const defaultOptions: RecordingOptions = {
  images: {
    enabled: false,
    intervalMs: 1000,
    quality: 0.8,
    resolutionDivisor: 1,
    motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
    qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
  },
  depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
  arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
  occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
  frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
  visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
  qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
  compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
  loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
};

function createMockDeps(
  overrides?: Partial<RecordingSessionDeps>
): RecordingSessionDeps {
  const mockStore = createMockStore();
  return {
    getStore: () => mockStore,
    setStore: vi.fn(),
    createNewStore: vi.fn().mockReturnValue(createMockStore()),
    getRecordingOptions: () => defaultOptions,
    getMapOverlay: () => null,
    getSessionNotes: () => '',
    waitForZeroReference: vi.fn().mockResolvedValue(null),
    loadAndDisplayRefPoints: vi
      .fn()
      .mockResolvedValue({ refPointCount: 0, observationCount: 0 }),
    collectTrackerErrors: vi.fn(),
    applyAlignmentMatrix: vi.fn(),
    rebindTrackingStore: vi.fn(),
    setImageQualityAnalyzer: mockSetImageQualityAnalyzer,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('createRecordingSessionHandlers', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = createRecordingSessionHandlers(deps);
  });

  // --- Factory creation ---

  it('should return an object with all expected methods', () => {
    // Why: Verify the factory produces the correct public interface
    expect(handlers).toBeDefined();
    expect(typeof handlers.handleStartRecording).toBe('function');
    expect(typeof handlers.handleStopRecording).toBe('function');
    expect(typeof handlers.handleBackDuringRecording).toBe('function');
    expect(typeof handlers.getCurrentSessionName).toBe('function');
    expect(typeof handlers.setCurrentSessionName).toBe('function');
    expect(typeof handlers.recordWriteSuccess).toBe('function');
    expect(typeof handlers.recordWriteFailure).toBe('function');
    expect(typeof handlers.recordCaptureSuccess).toBe('function');
    expect(typeof handlers.recordCaptureFailure).toBe('function');
    expect(typeof handlers.cleanupForNewRecording).toBe('function');
    expect(typeof handlers.reset).toBe('function');
  });

  // --- State accessors ---

  it('should return empty session name initially', () => {
    // Why: Session name is only set when recording starts
    expect(handlers.getCurrentSessionName()).toBe('');
  });

  it('should allow setting session name', () => {
    // Why: main.ts needs to set session name in some scenarios
    handlers.setCurrentSessionName('my-session');
    expect(handlers.getCurrentSessionName()).toBe('my-session');
  });
});

describe('handleStartRecording', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = createRecordingSessionHandlers(deps);
  });

  it('should reset coordinator state', async () => {
    // Why: Each recording starts with fresh coordinator state
    await handlers.handleStartRecording();
    expect(mockResetCoordinatorState).toHaveBeenCalled();
  });

  it('should clear GPS event visualizer', async () => {
    // Why: Previous recording markers must be cleared
    await handlers.handleStartRecording();
    expect(mockGpsEventVisualizer.clearAll).toHaveBeenCalled();
  });

  it('re-applies the gpsAlignmentMarkers opt-out AFTER clearAll (regression)', async () => {
    // Bug (2026-06-18): Enter-AR applies the operator's `gpsAlignmentMarkers`
    // opt-out via gpsEventVisualizer.setVisible(false), but handleStartRecording
    // then calls clearAll(), which resets the shared visualizer to its pristine
    // VISIBLE state (a replay-safety reset). Markers spawned by the live
    // store-subscriber during recording therefore reappeared despite the toggle
    // being OFF. The handler must re-assert the opt-out AFTER clearAll, or the
    // reset wins.
    const localDeps = createMockDeps({
      getRecordingOptions: () => ({
        ...defaultOptions,
        visualization: {
          ...defaultOptions.visualization,
          gpsAlignmentMarkers: false,
        },
      }),
    });
    const localHandlers = createRecordingSessionHandlers(localDeps);

    await localHandlers.handleStartRecording();

    expect(mockGpsEventVisualizer.setVisible).toHaveBeenCalledWith(false);
    // Crucially AFTER clearAll — otherwise clearAll's reset-to-visible wins and
    // the markers reappear (the exact reported symptom).
    const clearOrder =
      mockGpsEventVisualizer.clearAll.mock.invocationCallOrder[0];
    const setVisibleOrder =
      mockGpsEventVisualizer.setVisible.mock.invocationCallOrder[0];
    expect(setVisibleOrder).toBeGreaterThan(clearOrder);
  });

  it('re-applies the current gpsAlignmentMarkers value (visible) after clearAll', async () => {
    // Symmetry: with the toggle ON the re-assert is harmless (clearAll already
    // left markers visible) but keeps the visibility explicit and order-safe.
    await handlers.handleStartRecording();
    expect(mockGpsEventVisualizer.setVisible).toHaveBeenCalledWith(
      defaultOptions.visualization.gpsAlignmentMarkers
    );
  });

  it('should create a new store via deps', async () => {
    // Why: Each recording gets a fresh Redux store
    await handlers.handleStartRecording();
    expect(deps.createNewStore).toHaveBeenCalled();
  });

  it('should call setStore with the new store', async () => {
    // Why: main.ts module-level store must be replaced
    await handlers.handleStartRecording();
    expect(deps.setStore).toHaveBeenCalled();
  });

  it('should re-point the AR session at the new store via rebindTrackingStore', async () => {
    // Why (Finding #1, 2026-05-23 user feedback): when a recording starts a
    // fresh Redux store, the WebXR session must be re-pointed at the new
    // store. Otherwise `poseReceived` keeps flowing into the orphaned old
    // store, the new store's `tracking.phase` stays 'initializing', and the
    // tracking-quality phase gate keeps the HUD on "AR LOST" forever — the
    // exact symptom reported in the field test. Since the setter fold this
    // goes through the framework's narrow `rebindTrackingStore` (the one
    // runtime mutation that survived the move to initAR callbacks).
    const newStore = createMockStore();
    const rebindTrackingStoreMock = vi.fn();
    const localDeps = createMockDeps({
      createNewStore: vi.fn().mockReturnValue(newStore),
      rebindTrackingStore: rebindTrackingStoreMock,
    });
    const localHandlers = createRecordingSessionHandlers(localDeps);
    await localHandlers.handleStartRecording();
    expect(rebindTrackingStoreMock).toHaveBeenCalledWith(newStore);
  });

  it('should generate a session name from timestamp', async () => {
    // Why: Session names follow the recording-YYYY-MM-DD_HH-MM-SS format
    await handlers.handleStartRecording();
    expect(handlers.getCurrentSessionName()).toBe(
      'recording-2026-01-01_12-00-00'
    );
  });

  it('should call startStorageSession before dispatching actions', async () => {
    // Why: Storage must be initialized before any store actions are dispatched
    await handlers.handleStartRecording();
    expect(mockStartStorageSession).toHaveBeenCalledWith('TestScenario');
  });

  it('should wire store subscribers', async () => {
    // Why: Store subscribers drive UI updates and visualization
    await handlers.handleStartRecording();
    expect(mockWireStoreSubscribers).toHaveBeenCalled();
  });

  it('should pass a late-binding map overlay proxy to wireStoreSubscribers', async () => {
    // Why: The map overlay is created lazily (on button click) AFTER recording
    // starts. If the subscriber captures the initial null value, the overlay
    // never receives GPS updates in live mode. A proxy that calls
    // getMapOverlay() on each invocation ensures late-created overlays work.
    const mockOverlay = {
      setGpsPosition: vi.fn(),
      render: vi.fn<(data: MapData) => void>(),
    };
    // getMapOverlay returns null initially
    const getMapOverlay = vi.fn().mockReturnValue(null);
    deps = createMockDeps({ getMapOverlay });
    handlers = createRecordingSessionHandlers(deps);

    await handlers.handleStartRecording();

    // Extract the mapOverlay proxy passed to wireStoreSubscribers
    const wireCall = mockWireStoreSubscribers.mock.calls[0];
    const subscriberDeps = wireCall[1] as StoreSubscriberDeps;
    const mapProxy = subscriberDeps.mapOverlay as Required<
      NonNullable<StoreSubscriberDeps['mapOverlay']>
    >;

    // Proxy must be a non-null object (not the captured null)
    expect(mapProxy).not.toBeNull();
    expect(mapProxy).toBeDefined();

    const sampleMapData: MapData = {
      userPosition: { lat: 50, lng: 8 },
      rawGpsPath: [{ lat: 50, lng: 8 }],
      fusedPath: [],
      alignmentSnapshots: [],
    };

    // Calling proxy methods when overlay is null should be safe (no-op)
    expect(() => mapProxy.setGpsPosition(50, 8)).not.toThrow();
    expect(() => mapProxy.render(sampleMapData)).not.toThrow();

    // Now simulate the overlay being created (user tapped map button)
    getMapOverlay.mockReturnValue(mockOverlay);

    // Proxy should now forward calls to the real overlay
    mapProxy.setGpsPosition(51, 9);
    expect(mockOverlay.setGpsPosition).toHaveBeenCalledWith(51, 9);

    mapProxy.render(sampleMapData);
    expect(mockOverlay.render).toHaveBeenCalledWith(sampleMapData);
  });

  it('should create write and capture failure trackers', async () => {
    // Why: Trackers monitor for write/capture failures during recording
    await handlers.handleStartRecording();
    expect(mockCreateWriteFailureTracker).toHaveBeenCalled();
    expect(mockCreateCaptureFailureTracker).toHaveBeenCalled();
  });

  it('should dispatch startSession action', async () => {
    // Why: Store must record session metadata
    // Note: handleStartRecording creates a NEW store via createNewStore(),
    // so we check the mock that createNewStore returns.
    const newStore = createMockStore();
    deps = createMockDeps({
      createNewStore: vi.fn().mockReturnValue(newStore),
    });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    expect(newStore.dispatch).toHaveBeenCalled();
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({
        contextTag: 'TestScenario',
        sessionName: 'recording-2026-01-01_12-00-00',
      })
    );
  });

  it('should start GPS watch with position handler', async () => {
    // Why: GPS tracking is the core recording capability
    await handlers.handleStartRecording();
    expect(mockStartGpsWatch).toHaveBeenCalled();
  });

  it('should start orientation watch', async () => {
    // Why: Device orientation data is recorded alongside GPS
    await handlers.handleStartRecording();
    expect(mockStartOrientationWatch).toHaveBeenCalled();
  });

  it('should start the AbsoluteOrientationSensor capture (independent north, Phase 1)', async () => {
    // Why: the GPS-independent magnetometer heading must be captured during the
    // recording so it pairs with each GPS event (plan §5). Passive/no-op off
    // Chrome Android; the HUD status callback is wired so a field tester can
    // confirm capture is live.
    await handlers.handleStartRecording();
    expect(mockStartAbsoluteOrientationWatch).toHaveBeenCalled();
  });

  it('should enable beforeunload warning', async () => {
    // Why: Prevents accidental data loss during recording
    await handlers.handleStartRecording();
    expect(mockEnableBeforeUnloadWarning).toHaveBeenCalled();
  });

  it('should push recording screen state', async () => {
    // Why: Navigation state machine tracks current screen
    await handlers.handleStartRecording();
    expect(mockPushScreenState).toHaveBeenCalledWith('recording');
  });

  it('should show recording controls', async () => {
    // Why: UI must switch to recording mode
    await handlers.handleStartRecording();
    expect(mockShowRecordingControls).toHaveBeenCalled();
  });

  it('should update status with session name', async () => {
    // Why: HUD shows current recording name
    await handlers.handleStartRecording();
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.stringContaining('Recording:')
    );
  });

  it('should start image capture with the whole options section (no dropped knobs)', async () => {
    // Why: Image capture is controlled by user settings, and every tunable —
    // including resolutionDivisor, which used to be a bolted-on separate
    // parameter (field-drop audit F3) — must reach the framework as one config
    // object. The recorder-only `enabled` gate is stripped before forwarding.
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 500,
        quality: 0.9,
        resolutionDivisor: 2,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    expect(mockStartImageCapture).toHaveBeenCalledWith({
      intervalMs: 500,
      quality: 0.9,
      resolutionDivisor: 2,
      // motionFilter AND qualityFilter must forward through the seam too (the
      // same "no dropped knobs" guarantee that resolutionDivisor pins) so the
      // gates the user toggled actually reach ImageCaptureManager.
      motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
      qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
    });
  });

  it('spawns + injects the off-thread quality analyzer only when qualityFilter is enabled', async () => {
    // Why: the blur/blackness gate is opt-in and worker-backed. When enabled the
    // recorder must create the analyzer and inject it via setImageQualityAnalyzer
    // BEFORE startImageCapture (the manager reads it on construction); when
    // disabled it must spawn no worker and clear the analyzer (so a previous
    // recording's worker can't leak in).
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: {
          ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
          enabled: true,
        },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();

    expect(mockCreateImageQualityAnalyzer).toHaveBeenCalledWith(
      opts.images.qualityFilter
    );
    expect(mockSetImageQualityAnalyzer).toHaveBeenCalledWith(
      mockImageQualityClientInstance.analyze
    );
  });

  it('cleanupForNewRecording stops the live feeds too — captures, watches, analyzer worker (teardown parity with performStop)', async () => {
    // Why this test matters (recurring PR #115/#120/#123 review finding):
    // performStop was the only path that stopped captures/watches and disposed
    // the quality-gate worker; cleanupForNewRecording (the start-over path)
    // only cleared subscriptions and trackers, so a session
    // torn down through it left the camera/GPS feeds running and the worker
    // alive. Both paths now share stopLiveFeeds().
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: {
          ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
          enabled: true,
        },
      },
      depth: { enabled: true, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    mockSetImageQualityAnalyzer.mockClear();

    handlers.cleanupForNewRecording();

    expect(mockStopImageCapture).toHaveBeenCalled();
    expect(mockStopDepthCapture).toHaveBeenCalled();
    expect(mockStopGpsWatch).toHaveBeenCalled();
    expect(mockImageQualityClientInstance.dispose).toHaveBeenCalledTimes(1);
    expect(mockSetImageQualityAnalyzer).toHaveBeenCalledWith(null);
  });

  it('disposes a still-live analyzer before spawning a new one (start-over-start must not leak the worker)', async () => {
    // Why this test matters (PR #115/#120 review): the start path claims "a
    // previous recording's worker can't leak into this one" but only re-set the
    // analyzer FUNCTION — the previous client OBJECT (owning a real Worker) was
    // overwritten undisposed. performStop() disposes it on the normal flow, but
    // a start that skips/races the stop must not orphan a live worker.
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: {
          ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
          enabled: true,
        },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);

    await handlers.handleStartRecording();
    expect(mockImageQualityClientInstance.dispose).not.toHaveBeenCalled();
    await handlers.handleStartRecording(); // second start, no stop in between
    expect(mockImageQualityClientInstance.dispose).toHaveBeenCalledTimes(1);
    expect(mockCreateImageQualityAnalyzer).toHaveBeenCalledTimes(2);
  });

  it('continues recording (fails open) when the quality-gate worker cannot be created', async () => {
    // The analyzer's worker is constructed synchronously (`new Worker`). On a
    // locked-down deployment (e.g. CSP `worker-src 'none'`) that constructor can
    // throw. Previously the throw propagated out of handleStartRecording AFTER
    // the GPS/orientation/compass watches had already started, leaving a
    // half-initialized session (image capture never started, controls never
    // shown). The gate is optional and fail-open everywhere, so a worker-create
    // failure must disable the gate and let recording proceed.
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: {
          ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
          enabled: true,
        },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    mockCreateImageQualityAnalyzer.mockImplementationOnce(() => {
      throw new Error('Worker blocked by CSP');
    });

    await expect(handlers.handleStartRecording()).resolves.toBeUndefined();

    // Gate disabled (cleared), but recording still proceeded to image capture.
    expect(mockSetImageQualityAnalyzer).toHaveBeenCalledWith(null);
    expect(mockStartImageCapture).toHaveBeenCalled();
  });

  it('disposes the quality analyzer and clears the callback on stop', async () => {
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: {
          ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
          enabled: true,
        },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    await handlers.handleStopRecording();

    expect(mockImageQualityClientInstance.dispose).toHaveBeenCalledTimes(1);
    // Cleared on stop (null), in addition to being set on start.
    expect(mockSetImageQualityAnalyzer).toHaveBeenCalledWith(null);
  });

  it('does NOT spawn the analyzer when qualityFilter is disabled, but still clears it', async () => {
    // Image capture ON but the quality gate OFF (the default): no worker is
    // spawned, and the analyzer is explicitly cleared so a previous recording's
    // worker can't leak into this one.
    const opts: RecordingOptions = {
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
      },
      depth: { enabled: false, intervalMs: 1000, gridSize: 3, rgb: true },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();

    expect(mockCreateImageQualityAnalyzer).not.toHaveBeenCalled();
    expect(mockSetImageQualityAnalyzer).toHaveBeenCalledWith(null);
  });

  it('should NOT start image capture when disabled in options', async () => {
    // Why: Respects user preference to disable image capture
    await handlers.handleStartRecording();
    expect(mockStartImageCapture).not.toHaveBeenCalled();
  });

  it('should start depth capture when enabled in options', async () => {
    // Why: Depth capture is controlled by user settings — and the user's
    // interval/grid/rgb values must actually reach the sampler. They were
    // dead knobs before startDepthCapture accepted a config (occupancy-grid
    // port plan Iter 6; see 2026-06-12-1130-payload-rebuild-field-drop-audit.md
    // F3), so this asserts the exact values, not just the call. The rgb
    // flag (Iter 8 voxel coloring) rides the same forward-the-whole-section
    // seam, so it reaches the sampler with no seam edit.
    const opts: RecordingOptions = {
      images: {
        enabled: false,
        intervalMs: 1000,
        quality: 0.8,
        resolutionDivisor: 1,
        motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
        qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
      },
      depth: { enabled: true, intervalMs: 500, gridSize: 3, rgb: false },
      arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
      occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
      frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
      visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
      qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
      compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
      loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
    };
    deps = createMockDeps({ getRecordingOptions: () => opts });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    expect(mockStartDepthCapture).toHaveBeenCalledWith({
      intervalMs: 500,
      gridSize: 3,
      rgb: false,
    });
  });

  it('should NOT start depth capture when disabled in options', async () => {
    // Why: Respects user preference to disable depth capture
    await handlers.handleStartRecording();
    expect(mockStartDepthCapture).not.toHaveBeenCalled();
  });

  it('should start SyncManager when save file handle is available', async () => {
    // Why: External ZIP backup runs during recording if user selected save location
    const fakeHandle = {} as FileSystemFileHandle;
    mockGetSaveFileHandle.mockReturnValue(fakeHandle);
    await handlers.handleStartRecording();
    expect(mockCreateSyncManager).toHaveBeenCalled();
    expect(mockSyncManagerInstance.start).toHaveBeenCalled();
  });

  it('should NOT start SyncManager when no save file handle', async () => {
    // Why: OPFS-only storage mode doesn't need sync
    mockGetSaveFileHandle.mockReturnValue(null);
    await handlers.handleStartRecording();
    expect(mockCreateSyncManager).not.toHaveBeenCalled();
  });

  it('should unsubscribe previous store subscription before creating new one', async () => {
    // Why: Prevents orphan subscriptions from leaking
    // Start recording twice to create two subscriptions
    await handlers.handleStartRecording();
    const firstUnsubscribe = mockUnsubscribe;
    await handlers.handleStartRecording();
    expect(firstUnsubscribe).toHaveBeenCalled();
  });

  it('should abort and show error when storage session fails', async () => {
    // Why: If storage init fails, recording cannot proceed
    mockStartStorageSession.mockRejectedValueOnce(new Error('OPFS error'));
    await handlers.handleStartRecording();
    expect(mockShowError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create session folder')
    );
    // Should NOT proceed to start GPS etc.
    expect(mockStartGpsWatch).not.toHaveBeenCalled();
  });

  it('should include session notes in startSession dispatch', async () => {
    // Why: User notes must be persisted in session metadata
    deps = createMockDeps({ getSessionNotes: () => 'My test notes' });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'My test notes' })
    );
  });

  it('should use Default Scenario when scenario name is empty', async () => {
    // Why: Fallback for unset scenario name — store has empty currentScenarioName
    const emptyScenarioStore = createMockStore();
    vi.mocked(emptyScenarioStore.getState).mockReturnValue({
      ...emptyScenarioStore.getState(),
      scenario: {
        ...emptyScenarioStore.getState().scenario,
        currentScenarioName: '',
      },
    });
    deps = createMockDeps({ getStore: () => emptyScenarioStore });
    handlers = createRecordingSessionHandlers(deps);
    await handlers.handleStartRecording();
    expect(mockStartStorageSession).toHaveBeenCalledWith('Default Scenario');
  });

  it('should preserve scenario name from old store when creating new store (Issue #12)', async () => {
    // Why: The dropdown dispatches setCurrentScenarioName on the CURRENT store.
    // handleStartRecording creates a NEW store (which has no scenario name).
    // The scenario name must be read from the OLD store BEFORE replacement,
    // otherwise every recording is filed under 'Default Scenario' regardless
    // of the user's dropdown selection.
    const oldStore = createMockStore();
    vi.mocked(oldStore.getState).mockReturnValue({
      ...oldStore.getState(),
      scenario: {
        ...oldStore.getState().scenario,
        currentScenarioName: 'Paris',
      },
    });

    // New store has no scenario name (fresh state)
    const newStore = createMockStore();
    vi.mocked(newStore.getState).mockReturnValue({
      ...newStore.getState(),
      scenario: {
        ...newStore.getState().scenario,
        currentScenarioName: '',
      },
    });

    let currentStore = oldStore;
    deps = createMockDeps({
      getStore: () => currentStore,
      setStore: (s: RecorderStore) => {
        currentStore = s;
      },
      createNewStore: vi.fn().mockReturnValue(newStore),
    });
    handlers = createRecordingSessionHandlers(deps);

    await handlers.handleStartRecording();

    // Storage session and startSession action should both use 'Paris'
    expect(mockStartStorageSession).toHaveBeenCalledWith('Paris');
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({ contextTag: 'Paris' })
    );
  });
});

describe('handleStopRecording', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;
  let mockStore: RecorderStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore = createMockStore();
    deps = createMockDeps({
      getStore: () => mockStore,
      setStore: vi.fn(),
      createNewStore: vi.fn().mockReturnValue(mockStore),
    });
    handlers = createRecordingSessionHandlers(deps);
    // Start a recording first so there's state to clean up
    await handlers.handleStartRecording();
    vi.clearAllMocks();
  });

  it('should disable beforeunload warning', async () => {
    // Why: Warning only needed during active recording
    await handlers.handleStopRecording();
    expect(mockDisableBeforeUnloadWarning).toHaveBeenCalled();
  });

  it('should stop image and depth capture', async () => {
    // Why: Sensors must be stopped when recording ends
    await handlers.handleStopRecording();
    expect(mockStopImageCapture).toHaveBeenCalled();
    expect(mockStopDepthCapture).toHaveBeenCalled();
  });

  it('should stop GPS and orientation watches', async () => {
    // Why: All sensor watches must be cleaned up
    await handlers.handleStopRecording();
    expect(mockStopGpsWatch).toHaveBeenCalled();
    expect(mockStopOrientationWatch).toHaveBeenCalled();
    // The AbsoluteOrientationSensor watch must also be torn down (no leak).
    expect(mockStopAbsoluteOrientationWatch).toHaveBeenCalled();
  });

  it('should write session metadata', async () => {
    // Why: session.json must be persisted before ending, and new recordings
    // must keep the current era marker so replay migration stays correct.
    await handlers.handleStopRecording();
    expect(mockStore.writeSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        odomCoordVersion: 5,
        contextTag: 'TestScenario',
      })
    );
  });

  it('should dispatch endSession', async () => {
    // Why: Store must know recording has ended
    await handlers.handleStopRecording();
    expect(mockEndSession).toHaveBeenCalled();
    expect(mockStore.dispatch).toHaveBeenCalled();
  });

  it('should persist the H3 coverage index from the GPS path', async () => {
    // Why: the map-centric recording browser (Step 2 / D1) reads h3Cells from
    // session.json to show roughly where each tour was recorded WITHOUT
    // unzipping GPS data. The stored cells are the deduped res-11 coverage of
    // the walked path; h3Resolution records the capture resolution so older
    // readers stay self-describing if it ever changes.
    (mockStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      gpsData: {
        gpsEvents: {
          gpsPositions: [
            { latitude: 50.7495, longitude: 6.4793, timestamp: 1 },
            { latitude: 50.7475, longitude: 6.4812, timestamp: 2 },
            { latitude: 50.7475, longitude: 6.4812, timestamp: 3 }, // dwell → dedup
            { latitude: 50.7451, longitude: 6.4804, timestamp: 4 },
          ],
          odometryPositions: [],
        },
        referencePoints: [],
      },
      recording: {
        sessionMetadata: {
          contextTag: 'TestScenario',
          sessionName: 'test-session',
          startTime: 1000000,
        },
        failedWriteCount: 0,
      },
      scenario: { currentScenarioName: 'TestScenario' },
      refPoints: { entries: [] },
    });

    await handlers.handleStopRecording();

    const expectedCells = gpsPathToCoverageCells([
      { lat: 50.7495, lng: 6.4793 },
      { lat: 50.7475, lng: 6.4812 },
      { lat: 50.7475, lng: 6.4812 },
      { lat: 50.7451, lng: 6.4804 },
    ]);
    expect(expectedCells).toHaveLength(3); // dwell deduped away
    expect(mockStore.writeSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        h3Cells: expectedCells,
        h3Resolution: H3_RESOLUTION,
      })
    );
  });

  it('should call collectTrackerErrors for both trackers', async () => {
    // Why: Failure counts must be collected before showing summary
    await handlers.handleStopRecording();
    expect(deps.collectTrackerErrors).toHaveBeenCalledTimes(2);
  });

  it('should replace screen state with summary', async () => {
    // Why: Recording → Summary is a terminal state transition
    await handlers.handleStopRecording();
    expect(mockReplaceScreenState).toHaveBeenCalledWith('summary');
  });

  it('should show session summary with data', async () => {
    // Why: User sees recording results after stopping
    await handlers.handleStopRecording();
    expect(mockShowSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        gpsEventCount: expect.any(Number),
        imageCount: expect.any(Number),
      })
    );
  });

  it('should stop and null out sync manager', async () => {
    // Why: Sync manager must be cleaned up
    // Restart with sync manager active
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    await handlers.handleStopRecording();
    expect(mockSyncManagerInstance.syncNow).toHaveBeenCalled();
    expect(mockSyncManagerInstance.stop).toHaveBeenCalled();
  });

  it('should generate ZIP from OPFS when no external save location', async () => {
    // Why: Issue 3 — summary always needs ZIP data for share button
    mockGetSaveFileHandle.mockReturnValue(null);
    await handlers.handleStopRecording();
    expect(mockExportSessionAsZip).toHaveBeenCalled();
  });

  // ── WriteQueue drain before actions/ readers (indoor-loop enablement
  // follow-up §3.6b, 2026-07-12): the persistence middleware's WriteQueue is
  // async, so an action dispatched moments before Stop can still be queued
  // when the stop flow reads `actions/`. performStop must await the store's
  // drain hook BEFORE the final sync and BEFORE the OPFS zip export, or a
  // trailing mark silently misses the zip. ────────────────────────────────

  it('flushes pending action writes BEFORE the OPFS zip export', async () => {
    mockGetSaveFileHandle.mockReturnValue(null);

    await handlers.handleStopRecording();

    const flushMock = mockStore.flushPendingActionWrites as ReturnType<
      typeof vi.fn
    >;
    expect(flushMock).toHaveBeenCalled();
    expect(mockExportSessionAsZip).toHaveBeenCalled();
    expect(flushMock.mock.invocationCallOrder[0]!).toBeLessThan(
      mockExportSessionAsZip.mock.invocationCallOrder[0]!
    );
  });

  it('flushes pending action writes BEFORE the final external sync', async () => {
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    await handlers.handleStopRecording();

    const flushMock = mockStore.flushPendingActionWrites as ReturnType<
      typeof vi.fn
    >;
    expect(flushMock).toHaveBeenCalled();
    expect(mockSyncManagerInstance.syncNow).toHaveBeenCalled();
    expect(flushMock.mock.invocationCallOrder[0]!).toBeLessThan(
      (mockSyncManagerInstance.syncNow as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!
    );
  });

  // ── Re-entrancy & concurrent teardown (Sentry issue 7319627943) ──────────
  //
  // The final sync awaited in handleStopRecording can take 20+ seconds for a
  // large session. The Stop button stayed live, so users tapped it again. The
  // second invocation ran the whole teardown concurrently and stopped + nulled
  // the shared `syncManager` while the first call was still suspended at
  // `await syncManager.syncNow()`. When the first resumed it executed
  // `syncManager.stop()` on the now-null reference →
  // "TypeError: Cannot read properties of null (reading 'stop')".

  /** Resolve after both pending microtask + the next, so a started async fn reaches its first await. */
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('does not throw and stops the sync manager once when Stop is tapped twice mid-sync', async () => {
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    // First final sync stays pending (models the slow ZIP export); a second sync
    // would resolve immediately (SyncManager's "already in progress, skipping").
    let releaseFirstSync!: () => void;
    const firstSync = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    mockSyncManagerInstance.syncNow
      .mockReturnValueOnce(firstSync)
      .mockResolvedValue(undefined);

    // First Stop tap — suspends at `await syncManager.syncNow()`.
    const firstStop = handlers.handleStopRecording();
    await flushMicrotasks();

    // Second Stop tap while the first is still in flight: the re-entrancy guard
    // must make this a no-op rather than a concurrent teardown.
    await handlers.handleStopRecording();

    // Release the first sync; the first call resumes past its await.
    releaseFirstSync();

    // The crash manifested as an unhandled rejection of this first stop.
    await expect(firstStop).resolves.toBeUndefined();

    // The single live sync manager is stopped exactly once, and the terminal
    // summary transition happens once — the second tap did nothing.
    expect(mockSyncManagerInstance.stop).toHaveBeenCalledTimes(1);
    expect(mockShowSessionSummary).toHaveBeenCalledTimes(1);
  });

  it('marks the Stop button busy when stopping begins, even if the final sync fails', async () => {
    // UI feedback for async actions (CLAUDE.md): the multi-second final sync
    // must move the Stop button to a distinguishable in-progress state — both as
    // feedback and to remove the double-tap that triggered the crash. This must
    // hold even when the sync rejects.
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();
    mockSyncManagerInstance.syncNow.mockRejectedValueOnce(
      new Error('network down')
    );

    await handlers.handleStopRecording();

    expect(mockSetStopButtonBusy).toHaveBeenCalledWith(true);
  });

  it('restores the Stop button to idle when performStop throws, so the UI is not bricked', async () => {
    // UI feedback for async actions (CLAUDE.md): if teardown throws *after* the
    // button is marked busy but *before* hideRecordingControls() runs (e.g. the
    // summary screen fails to render, or an end-session subscriber throws), the
    // recording controls stay on screen with the Stop button stuck disabled +
    // "Stopping…" forever — a bricked UI. The busy state set on entry must be
    // symmetrically restored on the error path, and the error must still
    // propagate so it is reported (Sentry) rather than swallowed.
    mockGetSaveFileHandle.mockReturnValue(null);
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    // Inject the throw in the unguarded tail *before* hideRecordingControls()
    // runs (computeFusedPath builds the summary at performStop line ~709, the
    // controls are hidden at ~734), so the recording controls genuinely stay on
    // screen and the stuck button is the only thing keeping the UI usable.
    const tailError = new Error('summary build failed');
    mockComputeFusedPath.mockImplementationOnce(() => {
      throw tailError;
    });

    await expect(handlers.handleStopRecording()).rejects.toThrow(tailError);

    // Busy on entry, then restored to idle on the failure path.
    expect(mockSetStopButtonBusy).toHaveBeenCalledWith(true);
    expect(mockSetStopButtonBusy).toHaveBeenCalledWith(false);
    // We threw before the terminal transition, so the recording controls are
    // still visible (and the summary never rendered) — the idle restoration of
    // the Stop button is what un-bricks the UI.
    expect(mockHideRecordingControls).not.toHaveBeenCalled();
    expect(mockShowSessionSummary).not.toHaveBeenCalled();
  });

  it('is unaffected by cleanupForNewRecording racing the in-flight final sync', async () => {
    // Defense in depth (capture-local): the other concurrent path is an XR
    // session-end firing cleanupForNewRecording() while the final sync is still
    // awaiting. Because performStop captures the manager and nulls the shared
    // field before the await, cleanup sees null and must not double-stop it.
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    let releaseSync!: () => void;
    const sync = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    mockSyncManagerInstance.syncNow.mockReturnValueOnce(sync);

    const stop = handlers.handleStopRecording();
    await flushMicrotasks();

    // XR session-end teardown fires mid-sync.
    handlers.cleanupForNewRecording();

    releaseSync();
    await expect(stop).resolves.toBeUndefined();
    expect(mockSyncManagerInstance.stop).toHaveBeenCalledTimes(1);
  });

  it('should call exportSessionAsZip on main thread (Bug 12 — known limitation)', async () => {
    // Why: Bug 12 documents that ZIP export runs on the main thread, blocking
    // the UI during stop-recording. This test verifies the current behavior so
    // any future Worker-offload refactor has a baseline to replace.
    // When offloaded, this test should be updated to verify Worker usage.
    mockGetSaveFileHandle.mockReturnValue(null);
    await handlers.handleStopRecording();

    // exportSessionAsZip is called directly (not via a Worker)
    expect(mockExportSessionAsZip).toHaveBeenCalledWith(
      expect.any(String), // scenarioName
      expect.any(String), // sessionName
      expect.any(Object) // options { contributors }
    );
  });

  it('should clean up store subscription', async () => {
    // Why: Prevents memory leaks from dangling subscriptions
    await handlers.handleStopRecording();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should hide frame count HUD element', async () => {
    // Why: Frame counter is only visible during recording
    await handlers.handleStopRecording();
    expect(mockHideFrameCount).toHaveBeenCalled();
  });

  it('should hide recording controls before showing summary (Bug 8)', async () => {
    // Why: Recording controls (Stop, Ref Point, pulsing indicator) must be
    // hidden when transitioning to the summary screen. Leaving them visible
    // causes CSS animation waste, accessibility issues, and potential touch
    // bleed-through under the 90% opacity summary overlay.
    await handlers.handleStopRecording();
    expect(mockHideRecordingControls).toHaveBeenCalled();
  });

  it('should capture endTime at stop and use consistently in metadata and summary (Issue #4)', async () => {
    // Why: Both session metadata (endedAt) and the summary panel (endTime)
    // must use the same timestamp — the moment recording stopped, not a
    // later time after async operations (sync, ZIP export) have completed.
    // If Date.now() is called independently for each, the endTime drifts.
    const stopTime = 1700000000000;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // Each call returns a progressively later time to expose independent calls
      return stopTime + (callCount - 1) * 10000;
    });

    await handlers.handleStopRecording();

    // Summary endTime must be the captured stop time (first Date.now call)
    const summaryCall = mockShowSessionSummary.mock.calls[0]?.[0] as {
      duration: { startTime: number; endTime: number };
    };
    expect(summaryCall.duration.endTime).toBe(stopTime);

    // Metadata endedAt must match the same captured stop time
    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { endedAt: string };
    expect(new Date(metadataCall.endedAt).getTime()).toBe(stopTime);

    vi.restoreAllMocks();
  });

  it('should include build info in session metadata', async () => {
    // Why: session.json must carry build metadata (commit hash, versions,
    // build time) so that exported ZIPs are self-describing for debugging.
    await handlers.handleStopRecording();

    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { build?: unknown };
    expect(metadataCall.build).toEqual({
      commitHash: 'abc1234',
      appVersion: '0.1.0',
      libraryVersion: '1.0.0',
      frameworkVersion: '0.1.0',
      buildTime: '2026-04-20T10:00:00.000Z',
    });
  });

  it('should store pageUrl without query or hash in session metadata', async () => {
    // Why: session.json is exported and shared, so debug URL metadata must not
    // persist query-string tokens or hash fragments that may contain secrets.
    vi.stubGlobal('location', {
      href: 'https://example.com/recorder/session?scenario=test&token=secret#debug-panel',
    });

    await handlers.handleStopRecording();

    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { pageUrl?: string };
    expect(metadataCall.pageUrl).toBe('https://example.com/recorder/session');
  });

  it('should preserve scheme for file:// URLs in session metadata', async () => {
    // Why: file:// URLs have an opaque origin (url.origin === "null"), so
    // naively concatenating origin + pathname would produce a broken value
    // like "null/C:/foo/index.html". The sanitizer must preserve the scheme.
    vi.stubGlobal('location', {
      href: 'file:///C:/foo/index.html?token=secret#frag',
    });

    await handlers.handleStopRecording();

    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { pageUrl?: string };
    expect(metadataCall.pageUrl).toBe('file:///C:/foo/index.html');
  });

  it('should omit pageUrl when location href is unavailable', async () => {
    // Why: stop-recording must degrade gracefully in tests or non-browser
    // environments where location metadata is missing.
    vi.stubGlobal('location', {});

    await handlers.handleStopRecording();

    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { pageUrl?: string };
    expect(metadataCall.pageUrl).toBeUndefined();
  });

  it('should still write session metadata when build info lookup fails', async () => {
    // Why: Build metadata is optional debug information. A lookup failure must
    // not skip session.json or break stop-recording cleanup.
    mockGetBuildInfo.mockImplementation(() => {
      throw new Error('Missing or invalid build metadata: __BUILD_COMMIT__');
    });

    await handlers.handleStopRecording();

    expect(mockStore.writeSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        contextTag: 'TestScenario',
      })
    );

    const metadataCall = (
      mockStore.writeSessionMetadata as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { build?: unknown };
    expect(metadataCall.build).toBeUndefined();
  });

  it('should include alignment snapshot GPS path in summary data (Issue #1)', async () => {
    // Why: alignment snapshots must be converted to GPS coords and included in
    // the summary so the summary map can render red dots at alignment positions.
    //
    // The visualizer returns NUE positions; the handler converts them to GPS coords
    // using calcGpsCoords and the zeroRef, then adds them to SessionSummaryData.
    mockGpsEventVisualizer.getAlignmentSnapshotPositions.mockReturnValue([
      [10, 0, 5],
      [20, 1, 10],
    ]);

    // Provide GPS data so there's a zeroRef available
    (mockStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      gpsData: {
        gpsEvents: {
          gpsPositions: [
            {
              latitude: 50.0,
              longitude: 8.0,
              zeroRef: { lat: 50.0, lon: 8.0 },
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: Date.now(),
            },
          ],
          odometryPositions: [[0, 0, 0]],
          alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
        referencePoints: [],
      },
      recording: {
        sessionMetadata: {
          contextTag: 'Test',
          sessionName: 'test-session',
          startTime: Date.now() - 60000,
        },
        failedWriteCount: 0,
      },
      scenario: {
        currentScenarioName: 'Test',
      },
      refPoints: { entries: [] },
    });

    await handlers.handleStopRecording();

    expect(
      mockGpsEventVisualizer.getAlignmentSnapshotPositions
    ).toHaveBeenCalled();

    const summaryCall = mockShowSessionSummary.mock.calls[0]?.[0] as {
      alignmentSnapshotPath?: Array<{ lat: number; lng: number }>;
    };
    expect(summaryCall).toBeDefined();
    expect(summaryCall.alignmentSnapshotPath).toBeDefined();
    expect(summaryCall.alignmentSnapshotPath).toHaveLength(2);
    // Each entry should be a GpsCoord with lat/lng
    for (const coord of summaryCall.alignmentSnapshotPath!) {
      expect(typeof coord.lat).toBe('number');
      expect(typeof coord.lng).toBe('number');
    }
  });
});

describe('handleBackDuringRecording', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = createRecordingSessionHandlers(deps);
  });

  it('should show confirm dialog', async () => {
    // Why: User must confirm they want to stop recording
    await handlers.handleBackDuringRecording();
    expect(mockShowConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Stop recording and go back?',
      })
    );
  });

  it('should re-push recording state when user cancels', async () => {
    // Why: Navigation state must be restored after cancelled back
    mockShowConfirmDialog.mockResolvedValueOnce(false);
    await handlers.handleBackDuringRecording();
    expect(mockPushScreenState).toHaveBeenCalledWith('recording');
  });

  it('should stop recording when user confirms', async () => {
    // Why: Confirmed back = stop recording flow
    mockShowConfirmDialog.mockResolvedValueOnce(true);
    // Need a started recording for stop to work
    await handlers.handleStartRecording();
    vi.clearAllMocks();
    mockShowConfirmDialog.mockResolvedValueOnce(true);
    await handlers.handleBackDuringRecording();
    expect(mockDisableBeforeUnloadWarning).toHaveBeenCalled();
  });

  it('should block concurrent calls via synchronous lock', async () => {
    // Why: Rapid back presses must not spawn multiple dialogs
    // Make dialog hang until we resolve it
    let resolveDialog!: (v: boolean) => void;
    mockShowConfirmDialog.mockReturnValueOnce(
      new Promise((r) => {
        resolveDialog = r;
      })
    );

    const first = handlers.handleBackDuringRecording();
    // Second call while first is pending
    await handlers.handleBackDuringRecording();
    // Second call should re-push state without showing dialog
    expect(mockPushScreenState).toHaveBeenCalledWith('recording');
    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);

    // Resolve first dialog
    resolveDialog(false);
    await first;
  });

  it('should re-push recording state on error', async () => {
    // Why: Navigation must not break if dialog throws
    mockShowConfirmDialog.mockRejectedValueOnce(new Error('dialog error'));
    await handlers.handleBackDuringRecording();
    expect(mockPushScreenState).toHaveBeenCalledWith('recording');
  });

  it('should reset lock after completion', async () => {
    // Why: Lock must be released so subsequent back presses work
    mockShowConfirmDialog.mockResolvedValueOnce(false);
    await handlers.handleBackDuringRecording();

    vi.clearAllMocks();
    // Second call should work normally (lock was released)
    mockShowConfirmDialog.mockResolvedValueOnce(false);
    await handlers.handleBackDuringRecording();
    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
  });
});

describe('cleanupForNewRecording', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = createRecordingSessionHandlers(deps);
    // Start a recording to create state that needs cleanup
    await handlers.handleStartRecording();
    vi.clearAllMocks();
  });

  it('should unsubscribe from store', () => {
    // Why: Old subscription must be removed before creating new store
    handlers.cleanupForNewRecording();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should reset failure trackers', () => {
    // Why: Trackers must be cleaned up and nulled for next session
    handlers.cleanupForNewRecording();
    expect(mockWriteFailureTrackerInstance.reset).toHaveBeenCalled();
    expect(mockCaptureFailureTrackerInstance.reset).toHaveBeenCalled();
  });

  it('should stop sync manager if active', async () => {
    // Why: Sync must be stopped between recordings
    // Start with sync manager
    mockGetSaveFileHandle.mockReturnValue({});
    await handlers.handleStartRecording();
    vi.clearAllMocks();

    handlers.cleanupForNewRecording();
    expect(mockSyncManagerInstance.stop).toHaveBeenCalled();
  });

  it('should clear session name', () => {
    // Why: Session name resets between recordings
    handlers.setCurrentSessionName('test-session');
    handlers.cleanupForNewRecording();
    expect(handlers.getCurrentSessionName()).toBe('');
  });
});

describe('reset', () => {
  let handlers: RecordingSessionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRecordingSessionHandlers(createMockDeps());
  });

  it('should clear session name', () => {
    // Why: Full reset clears all state
    handlers.setCurrentSessionName('my-session');
    handlers.reset();
    expect(handlers.getCurrentSessionName()).toBe('');
  });
});

describe('tracker proxy methods', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    handlers = createRecordingSessionHandlers(deps);
  });

  it('should be no-ops before recording starts (no trackers)', () => {
    // Why: Proxies must be null-safe before trackers are created
    expect(() => handlers.recordWriteSuccess()).not.toThrow();
    expect(() => handlers.recordWriteFailure(new Error('test'))).not.toThrow();
    expect(() => handlers.recordCaptureSuccess()).not.toThrow();
    expect(() => handlers.recordCaptureFailure()).not.toThrow();
  });

  it('should delegate to trackers after recording starts', async () => {
    // Why: During recording, proxy methods reach the real trackers
    await handlers.handleStartRecording();

    handlers.recordWriteSuccess();
    expect(mockWriteFailureTrackerInstance.recordSuccess).toHaveBeenCalled();

    handlers.recordWriteFailure(new Error('disk full'));
    expect(mockWriteFailureTrackerInstance.recordFailure).toHaveBeenCalledWith(
      expect.any(Error)
    );

    handlers.recordCaptureSuccess();
    expect(mockCaptureFailureTrackerInstance.recordSuccess).toHaveBeenCalled();

    handlers.recordCaptureFailure();
    expect(mockCaptureFailureTrackerInstance.recordFailure).toHaveBeenCalled();
  });
});

describe('AbsCompass HUD timer — factory-pattern isolation (PR #126)', () => {
  // The sidecar documents the factory invariant: "Each call to
  // createRecordingSessionHandlers returns independent state. No module-level
  // mutable state." The live AbsCompass HUD refresh timer must therefore be
  // per-instance. When the timer handle lives in a module-level variable shared
  // across instances, a SECOND handlers instance starting recording runs
  // startAbsCompassHudUpdates() → stopAbsCompassHudUpdates(), which — reading the
  // shared module variable — clears the FIRST instance's still-live HUD interval.
  // Two concurrent sessions then collapse onto a single timer (cross-session
  // interference / timer leak). This test pins the isolation.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a second instance starting recording must not clear the first instance HUD timer', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const handlersA = createRecordingSessionHandlers(createMockDeps());
    await handlersA.handleStartRecording();

    // createSyncManager and every sensor watch are mocked, so the only timer the
    // start flow arms is the AbsCompass HUD refresh interval. Capture its id.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const aHudIntervalId = setIntervalSpy.mock.results[0]?.value;

    clearIntervalSpy.mockClear();

    const handlersB = createRecordingSessionHandlers(createMockDeps());
    await handlersB.handleStartRecording();

    // With shared module state, B's start cleared A's interval. With per-instance
    // state, B's own (null) timer means nothing of A's is touched.
    const clearedAsTimer = clearIntervalSpy.mock.calls.some(
      ([id]) => id === aHudIntervalId
    );
    expect(clearedAsTimer).toBe(false);
  });
});

// ── A3 (2026-07-06 round-4): prior ref-point load decoupled from GPS ──────

describe('loadPriorReferencePoints (via handleStartRecording) — A3 GPS decoupling', () => {
  let handlers: RecordingSessionHandlers;
  let deps: RecordingSessionDeps;
  const scenarioHandle = {} as FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.clearAllMocks();
    // The file-wide default is a null handle (skips the load entirely);
    // these tests need a scenario so the load path actually runs.
    mockGetCurrentScenarioHandle.mockReturnValue(scenarioHandle);
    deps = createMockDeps({
      loadAndDisplayRefPoints: vi
        .fn()
        .mockResolvedValue({ refPointCount: 2, observationCount: 5 }),
    });
    handlers = createRecordingSessionHandlers(deps);
  });

  afterEach(() => {
    // clearAllMocks does NOT reset mockReturnValue — restore the file-wide
    // default explicitly so the handle override cannot leak into other tests.
    mockGetCurrentScenarioHandle.mockReturnValue(null);
  });

  it('dispatches imported entries into the store even when the zeroRef wait times out', async () => {
    // Why this test matters: round-4 A3 — the 2D map needs only lat/lon from
    // the store, so a GPS-starved start must not lose the locally-stored ref
    // points. The default waitForZeroReference mock resolves null (timeout).
    await handlers.handleStartRecording();

    await vi.waitFor(() =>
      expect(deps.loadAndDisplayRefPoints).toHaveBeenCalledWith(scenarioHandle)
    );
    // The error channel still fires — 3D/AR placement genuinely needs GPS…
    await vi.waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        'No GPS signal received. Move outdoors for better reception.'
      )
    );
    // …but the status reflects BOTH facts: GPS missing AND the load succeeded
    // (round-4 interview decision 6).
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.stringContaining(
        'GPS unavailable | 2 ref points (5 observations) loaded'
      )
    );
  });

  it('loads + dispatches BEFORE waiting for the zeroRef (map view must not wait for GPS)', async () => {
    // Why this test matters: with the load ordered after the wait, the live
    // map loses its data source for up to 30 s even though OPFS is local.
    await handlers.handleStartRecording();

    await vi.waitFor(() =>
      expect(deps.loadAndDisplayRefPoints).toHaveBeenCalled()
    );
    const loadOrder = vi.mocked(deps.loadAndDisplayRefPoints).mock
      .invocationCallOrder[0]!;
    const waitOrder = vi.mocked(deps.waitForZeroReference).mock
      .invocationCallOrder[0]!;
    expect(loadOrder).toBeLessThan(waitOrder);
  });

  it('sets the zeroRef on the 3D visualizer and reports the loaded counts when GPS arrives', async () => {
    // Why this test matters: pins the success path across the A3 reorder —
    // the sphere placement still receives the zeroRef, and the status shows
    // the same counts as before.
    deps = createMockDeps({
      loadAndDisplayRefPoints: vi
        .fn()
        .mockResolvedValue({ refPointCount: 2, observationCount: 5 }),
      waitForZeroReference: vi.fn().mockResolvedValue({ lat: 50, lon: 8 }),
    });
    handlers = createRecordingSessionHandlers(deps);

    await handlers.handleStartRecording();

    await vi.waitFor(() =>
      expect(mockRefPointVisualizer.setZeroRef).toHaveBeenCalledWith({
        lat: 50,
        lon: 8,
      })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.stringContaining('2 ref points (5 observations) loaded')
    );
    expect(mockShowError).not.toHaveBeenCalled();
  });
});
