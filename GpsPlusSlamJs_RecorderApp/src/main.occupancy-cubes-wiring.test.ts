// @vitest-environment jsdom
/**
 * Integration tests for the occupancy-grid cube wiring in live AR mode
 * (main.ts) — 2026-06-11 depth occupancy-grid port plan, Iter 5.
 *
 * Why these tests matter:
 * handleEnterAR must create the OccupancyGrid + OccupancyCubesVisualizer
 * and wire them to the storeRef via wireOccupancyGridSubscribers so depth
 * samples become visible cubes during recording, and resetMainState must
 * tear all of it down (subscription-leak / GPU-leak regression). Mock
 * harness follows the main.ar-follower-wiring.test.ts precedent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- hoisted mocks (need to be available before vi.mock factories) ----------

const {
  mockOccupancyGridCtor,
  mockOccupancyGridInstance,
  mockVisualizerCtor,
  mockVisualizerInstance,
  mockWireOccupancyGridSubscribers,
  occupancyGridDisposers,
} = vi.hoisted(() => {
  const mockOccupancyGridInstance = {
    addSample: vi.fn(),
    clear: vi.fn(),
  };
  const mockVisualizerInstance = {
    refresh: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const occupancyGridDisposers: Array<() => void> = [];
  // Constructor mocks need `function` implementations — arrow functions
  // are not constructable, so `new OccupancyGrid()` would throw (silently
  // swallowed by main.ts's best-effort try/catch).
  return {
    mockOccupancyGridCtor: vi.fn(function () {
      return mockOccupancyGridInstance;
    }),
    mockOccupancyGridInstance,
    mockVisualizerCtor: vi.fn(function () {
      return mockVisualizerInstance;
    }),
    mockVisualizerInstance,
    mockWireOccupancyGridSubscribers: vi.fn((_options: unknown) => {
      const dispose = vi.fn();
      occupancyGridDisposers.push(dispose);
      return dispose;
    }),
    occupancyGridDisposers,
  };
});

const { mockGetArWorldGroup, mockGetScene, mockGetCamera, mockArWorldGroup } =
  vi.hoisted(() => {
    const mockArWorldGroup = {
      name: 'ar-world',
      add: vi.fn(),
      remove: vi.fn(),
    };
    const mockScene = { name: 'scene' };
    const mockCamera = { name: 'camera' };
    return {
      mockGetArWorldGroup: vi.fn().mockReturnValue(mockArWorldGroup),
      mockGetScene: vi.fn().mockReturnValue(mockScene),
      mockGetCamera: vi.fn().mockReturnValue(mockCamera),
      mockArWorldGroup,
    };
  });

// Live CPU-depth occluder (occupancy.liveOcclusion) — full mock so the wiring
// (construct → add mesh → per-frame update → session-disposer) is observable.
const {
  mockDepthOccluderCtor,
  mockDepthOccluderInstance,
  mockOcclusionMeshObject,
  mockRegisterXrFrameUpdate,
  mockGetDepthInfoFromFrame,
  liveOccluderFrameCallbacks,
  liveOccluderUnregisterFrame,
} = vi.hoisted(() => {
  const mockOcclusionMeshObject = { name: 'live-depth-occluder' };
  const mockDepthOccluderInstance = {
    getOcclusionMesh: vi.fn(() => mockOcclusionMeshObject),
    update: vi.fn(),
    dispose: vi.fn(),
  };
  const liveOccluderFrameCallbacks: Array<(ctx: unknown) => void> = [];
  const liveOccluderUnregisterFrame = vi.fn();
  return {
    mockDepthOccluderCtor: vi.fn(function () {
      return mockDepthOccluderInstance;
    }),
    mockDepthOccluderInstance,
    mockOcclusionMeshObject,
    mockRegisterXrFrameUpdate: vi.fn((cb: (ctx: unknown) => void) => {
      liveOccluderFrameCallbacks.push(cb);
      return liveOccluderUnregisterFrame;
    }),
    mockGetDepthInfoFromFrame: vi.fn((): { depth: boolean } | null => ({
      depth: true,
    })),
    liveOccluderFrameCallbacks,
    liveOccluderUnregisterFrame,
  };
});

vi.mock('gps-plus-slam-app-framework/ar/depth-occluder', () => ({
  DepthOccluder: mockDepthOccluderCtor,
}));
vi.mock('gps-plus-slam-app-framework/ar/xr-frame-loop', () => ({
  registerXrFrameUpdate: mockRegisterXrFrameUpdate,
}));

// ---------- mocks for the modules under test ----------

vi.mock('gps-plus-slam-app-framework/ar/occupancy-grid', () => ({
  OccupancyGrid: mockOccupancyGridCtor,
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer',
  () => ({
    OccupancyCubesVisualizer: mockVisualizerCtor,
  })
);
vi.mock('./visualization/wire-occupancy-grid-subscribers', () => ({
  wireOccupancyGridSubscribers: mockWireOccupancyGridSubscribers,
}));

// ---------- mocks for all main.ts dependencies (ar-follower precedent) ----------

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
  getArWorldGroup: mockGetArWorldGroup,
  getDepthInfoFromFrame: mockGetDepthInfoFromFrame,
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
    // handleImageCaptured persists the frame blob through store.writeFrame
    writeFrame: vi.fn().mockResolvedValue(undefined),
  }),
}));
// Spy on the action creators main.ts dispatches for captured images / depth
// samples, at their true sources (post-barrel-removal import paths). Spread
// the actual modules so every other symbol stays real.
vi.mock('gps-plus-slam-app-framework/state', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  add2dImage: vi.fn(),
}));
vi.mock(
  'gps-plus-slam-app-framework/state/recording-slice',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    recordDepthSample: vi.fn(),
  })
);
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
    // Deliberately NOT the 1000 ms hardcoded default — proves the cube
    // refresh throttle is sourced from depth.intervalMs, not the fallback.
    depth: { enabled: false, intervalMs: 500 },
    occupancy: { cellSizeM: 0.15, minConfidence: 3 },
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
vi.mock('./ui/hud-tracking-quality-subscriber', () => ({
  subscribeHudToTrackingQuality: vi.fn(() => vi.fn()),
}));
// Persistent occluder (Step 2 windowed-occluder wiring test): OcclusionMesh +
// the worker client are mocked so enabling occupancy.persistentOcclusion
// exercises main.ts's occluder sink without THREE/WebGL.
const { mockOcclusionMeshCtor, mockDriverRequest } = vi.hoisted(() => ({
  mockOcclusionMeshCtor: vi.fn(function () {
    return {
      applyMeshData: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      setDebugStyle: vi.fn(),
    };
  }),
  mockDriverRequest: vi.fn(),
}));
vi.mock('gps-plus-slam-app-framework/visualization', () => ({
  OcclusionMesh: mockOcclusionMeshCtor,
}));
vi.mock('./visualization/occluder-mesh-worker-client', () => ({
  createOccluderMeshWorker: vi.fn(() => ({
    driver: { request: mockDriverRequest },
    dispose: vi.fn(),
  })),
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
    recordCaptureSuccess: vi.fn(),
    recordWriteSuccess: vi.fn(),
    recordWriteFailure: vi.fn(),
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

// Import after all mocks are set up. The occupancy-grid provider is imported
// REAL (not mocked) so we can assert main.ts publishes/clears the live grid
// through it — the shared accessor the COLMAP contributor reads (Iter 2.5).
import {
  handleEnterARForTesting,
  resetMainState,
  setRecordingOptionsForTesting,
} from './main';
import { loadRecordingOptions } from './state/recording-options';
import { getOccupancyGrid } from './state/occupancy-grid-provider';
import {
  initAR,
  type CapturedImage,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { add2dImage } from 'gps-plus-slam-app-framework/state';
import { recordDepthSample } from 'gps-plus-slam-app-framework/state/recording-slice';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';

describe('Occupancy-grid cube wiring in live AR', () => {
  beforeEach(() => {
    // Reset module state from the previous test FIRST (it calls dispose on
    // leftover wiring), then clear the recorded mock calls.
    resetMainState();
    vi.clearAllMocks();
    occupancyGridDisposers.length = 0;

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

  it('creates the grid + cube visualizer on the AR world group and wires them after AR init', async () => {
    await handleEnterARForTesting();

    expect(mockOccupancyGridCtor).toHaveBeenCalledTimes(1);
    // Voxel size flows from the recorder setting (occupancy.cellSizeM) into the
    // grid constructor — 2026-06-13 occupancy-grid-settings review, item 1.
    // Confidence-guarded carving is tied to the SAME noise floor the renderers
    // use (occupancy.minConfidence): any voxel solid enough to be shown can no
    // longer be erased by one deeper reading (2026-07-16 synthetic-scene
    // investigation — eliminates silhouette churn + occluded-background loss).
    expect(mockOccupancyGridCtor).toHaveBeenCalledWith({
      cellSizeM: 0.15,
      carveConfidenceThreshold: 3,
    });
    expect(mockVisualizerCtor).toHaveBeenCalledTimes(1);
    // The visualizer must hang off arWorldGroup, NOT the scene root: the
    // grid's cells are raw-WebXR coordinates that only register with the
    // real world when they ride the alignment matrix like the camera does
    // (port plan Iter 7 reparenting fix).
    // arWorldGroup as parent, plus the noise filter forwarded from the
    // recorder setting (occupancy.minConfidence → visualizer.minObservations,
    // 2026-06-22 behind-surface-noise plan).
    expect(mockVisualizerCtor).toHaveBeenCalledWith(mockGetArWorldGroup(), {
      minObservations: 3,
    });
    expect(mockVisualizerCtor).not.toHaveBeenCalledWith(mockGetScene());
    expect(mockWireOccupancyGridSubscribers).toHaveBeenCalledTimes(1);

    const options = mockWireOccupancyGridSubscribers.mock.calls[0]?.[0] as {
      storeRef: unknown;
      grid: unknown;
      visualizer: unknown;
      occluder: unknown;
      refreshIntervalMs: unknown;
    };
    expect(options.grid).toBe(mockOccupancyGridInstance);
    expect(options.visualizer).toBe(mockVisualizerInstance);
    expect(options.storeRef).toBeDefined();
    // This test exercises the occluder-OFF path: the mock options omit
    // occupancy.persistentOcclusion (falsy), so no occluder sink is wired. (The
    // shipped default is now ON — see recording-options.ts — but the wiring keys
    // off the raw flag, which this mock leaves unset.)
    expect(options.occluder).toBeUndefined();
    // Issue A (2026-06-22 cube cadence/locality plan §2): the cube-refresh
    // throttle is wired from depth.intervalMs (500 ms in the mock), not the
    // visualizer's hardcoded 1000 ms fallback. This pins the one thing that
    // can silently regress — the call site dropping the option again.
    expect(options.refreshIntervalMs).toBe(500);
  });

  describe('windowed persistent occluder (Step 2, 2026-07-03 fps plan)', () => {
    // Why these tests matter: the camera-local occluder window is the plan's
    // structural fix for the O(total-cells) snapshot+pack cost. The sink
    // main.ts hands the wirer must snapshot getOccupiedCellsWithinFlat
    // around the pose when occluderRadiusM > 0 and degrade to the unbounded
    // flat snapshot otherwise — and the wirer must get the camera-move ε so
    // a settled grid still re-windows when the user walks.

    function makeFakeGrid() {
      const flatWindow = new Int32Array([1, 2, 3]);
      const flatFull = new Int32Array([4, 5, 6, 7, 8, 9]);
      return {
        flatWindow,
        flatFull,
        grid: {
          getOccupiedCellsWithinFlat: vi.fn(() => flatWindow),
          getOccupiedCellsFlat: vi.fn(() => flatFull),
          getCellPoint: vi.fn(() => null),
          cellSizeM: 0.15,
        },
      };
    }

    function optionsWithOccluderOn(occluderRadiusM: number) {
      return {
        ...loadRecordingOptions(),
        occupancy: {
          cellSizeM: 0.15,
          minConfidence: 3,
          persistentOcclusion: true,
          liveOcclusion: false,
          occluderDebugStyle: 'off' as const,
          occluderMeshMode: 'smooth' as const,
          occluderRadiusM,
        },
      };
    }

    async function wiredOccluderSink(occluderRadiusM: number) {
      setRecordingOptionsForTesting(optionsWithOccluderOn(occluderRadiusM));
      await handleEnterARForTesting();
      // .at(-1): a test may enter AR more than once — always read the wiring
      // of the LATEST cycle.
      const options = mockWireOccupancyGridSubscribers.mock.calls.at(
        -1
      )?.[0] as {
        occluder?: {
          refresh(grid: unknown, pose?: { cameraPos: number[] }): void;
        };
        refreshOnCameraMoveM?: number;
      };
      return options;
    }

    it('snapshots the camera-local window and passes the ε guard to the wirer', async () => {
      const options = await wiredOccluderSink(25);
      expect(options.occluder).toBeDefined();
      // ε = one chunk edge = 16 · cellSizeM = 2.4 m at the 0.15 m default.
      expect(options.refreshOnCameraMoveM).toBeCloseTo(2.4, 10);

      const { grid, flatWindow } = makeFakeGrid();
      options.occluder!.refresh(grid, { cameraPos: [1, 2, 3] });
      expect(grid.getOccupiedCellsWithinFlat).toHaveBeenCalledWith(
        [1, 2, 3],
        25,
        3
      );
      expect(grid.getOccupiedCellsFlat).not.toHaveBeenCalled();
      expect(mockDriverRequest).toHaveBeenCalledWith(
        flatWindow,
        0.15,
        'smooth',
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('falls back to the unbounded snapshot for radius 0, a missing pose, or a non-finite pose', async () => {
      const options = await wiredOccluderSink(0);
      const { grid: g0, flatFull } = makeFakeGrid();
      options.occluder!.refresh(g0, { cameraPos: [1, 2, 3] });
      expect(g0.getOccupiedCellsWithinFlat).not.toHaveBeenCalled();
      expect(mockDriverRequest).toHaveBeenLastCalledWith(
        flatFull,
        0.15,
        'smooth',
        expect.any(Function),
        expect.any(Function)
      );

      const options25 = await wiredOccluderSink(25);
      const { grid: g1 } = makeFakeGrid();
      options25.occluder!.refresh(g1); // no pose (first refresh edge case)
      expect(g1.getOccupiedCellsWithinFlat).not.toHaveBeenCalled();
      expect(g1.getOccupiedCellsFlat).toHaveBeenCalledWith(3);

      const { grid: g2 } = makeFakeGrid();
      options25.occluder!.refresh(g2, { cameraPos: [NaN, 0, 0] });
      // A glitched pose must degrade to unbounded, never blank the occluder.
      expect(g2.getOccupiedCellsWithinFlat).not.toHaveBeenCalled();
      expect(g2.getOccupiedCellsFlat).toHaveBeenCalledWith(3);
    });
  });

  it('resetMainState disposes the wiring and the visualizer', async () => {
    await handleEnterARForTesting();
    expect(occupancyGridDisposers).toHaveLength(1);

    resetMainState();
    expect(occupancyGridDisposers[0]).toHaveBeenCalledTimes(1);
    expect(mockVisualizerInstance.dispose).toHaveBeenCalledTimes(1);
  });

  /**
   * Why this test matters (Iter 2.5): the COLMAP contributor and future grid
   * consumers read the live grid through `getOccupancyGrid()`. main.ts must
   * publish the SAME instance it feeds the visualizer when entering AR, and
   * clear it back to null on session-swap/teardown so a stale grid is never
   * exported (e.g. during replay, which keeps its own grid).
   */
  it('publishes the live grid via the provider on Enter AR and clears it on reset', async () => {
    await handleEnterARForTesting();
    // Same instance the visualizer/subscribers were fed.
    expect(getOccupancyGrid()).toBe(mockOccupancyGridInstance);

    resetMainState();
    expect(getOccupancyGrid()).toBeNull();
  });

  /**
   * Why this test matters (re-entry leak guard): handleEnterAR runs again
   * whenever the user goes back to setup and taps Enter AR a second time
   * (main.ts documents this; onBackToSetup does NO teardown, and the only
   * production teardown — resetMainState — is test-only). Each cycle calls
   * wireOccupancyGridSubscribers, which registers a *persistent* storeRef
   * swap-listener plus a store subscription and allocates an instanced-mesh
   * visualizer. If the prior cycle's wiring is not disposed before the new
   * instances are created, the old swap-listener stays attached to storeRef
   * forever (keeps refreshing a discarded visualizer) and the old GPU mesh
   * leaks — the same defect the tracking-quality subscription guards against.
   */
  it('disposes the prior cycle wiring + visualizer when handleEnterAR re-enters', async () => {
    await handleEnterARForTesting();
    expect(occupancyGridDisposers).toHaveLength(1);
    expect(occupancyGridDisposers[0]).not.toHaveBeenCalled();
    expect(mockVisualizerInstance.dispose).not.toHaveBeenCalled();

    // Second enter-AR cycle (back to setup → Enter AR again).
    await handleEnterARForTesting();

    // The first cycle's subscriber and visualizer must be torn down before
    // the second cycle's instances are wired.
    expect(occupancyGridDisposers[0]).toHaveBeenCalledTimes(1);
    expect(mockVisualizerInstance.dispose).toHaveBeenCalledTimes(1);
    expect(mockWireOccupancyGridSubscribers).toHaveBeenCalledTimes(2);
    expect(occupancyGridDisposers).toHaveLength(2);
  });

  it('skips the wiring when the AR scene is unavailable', async () => {
    mockGetScene.mockReturnValueOnce(null);

    await handleEnterARForTesting();

    expect(mockVisualizerCtor).not.toHaveBeenCalled();
    expect(mockWireOccupancyGridSubscribers).not.toHaveBeenCalled();
  });

  it('skips the wiring when the AR world group is unavailable', async () => {
    mockGetArWorldGroup.mockReturnValueOnce(null);

    await handleEnterARForTesting();

    expect(mockVisualizerCtor).not.toHaveBeenCalled();
    expect(mockWireOccupancyGridSubscribers).not.toHaveBeenCalled();
  });

  it('AR init survives a visualizer construction failure (best-effort wiring)', async () => {
    mockVisualizerCtor.mockImplementationOnce(() => {
      throw new Error('no WebGL');
    });

    await expect(handleEnterARForTesting()).resolves.not.toThrow();
    expect(mockWireOccupancyGridSubscribers).not.toHaveBeenCalled();
  });

  /**
   * Why this test matters (2026-06-12-1130-payload-rebuild-field-drop-audit.md F1):
   * handleDepthSampleCaptured used to re-create the recordDepthSample
   * payload field-by-field, silently dropping the optional
   * projectionMatrix — the camera intrinsics the occupancy grid needs to
   * unproject points. The handler must forward the sampler's payload
   * AS-IS (same reference, every field).
   */
  it('forwards captured depth samples to recordDepthSample unmodified', async () => {
    await handleEnterARForTesting();

    // Since the setter fold, the depth handler rides into initAR's callbacks.
    const handler = vi.mocked(initAR).mock.calls[0]?.[3]?.depth?.onCaptured;
    expect(handler).toBeDefined();

    const sample: DepthSample = {
      timestamp: 1234,
      cameraPos: [1, 2, 3],
      cameraRot: [0, 0, 0, 1],
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
      projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0],
    };
    handler!(sample);

    const dispatched = vi.mocked(recordDepthSample).mock.calls[0]?.[0];
    // Same reference — nothing was rebuilt, so no field can be dropped
    expect(dispatched).toBe(sample);
    expect(dispatched?.projectionMatrix).toEqual(sample.projectionMatrix);
  });

  /**
   * Why this test matters (2026-06-12-1130-payload-rebuild-field-drop-audit.md F2):
   * handleImageCaptured rebuilds the add2dImage payload field-by-field — the
   * same seam shape as the F1 depth bug above. When CapturedImage gains a
   * persistable field it can be silently dropped before persistence with no
   * compile error (omitting an optional property still satisfies the target).
   * This test populates every CapturedImage field and asserts each persistable
   * one reaches the dispatched add2dImage payload. Note the two fields that are
   * NOT in the payload by design: `blob` is routed through store.writeFrame and
   * `frameIndex` is encoded into the `images/…` filename. A new CapturedImage
   * field MUST be threaded through handleImageCaptured and asserted here.
   */
  it('forwards every persistable CapturedImage field into the add2dImage payload', async () => {
    await handleEnterARForTesting();

    // Since the setter fold, the image handler rides into initAR's callbacks.
    const handler =
      vi.mocked(initAR).mock.calls[0]?.[3]?.imageCapture?.onCaptured;
    expect(handler).toBeDefined();

    const image: CapturedImage = {
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      timestamp: 1700000000123,
      frameIndex: 7,
      position: { x: 1.5, y: -2.5, z: 3.5 },
      rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      screenRotation: 90,
    };
    handler!(image);

    expect(add2dImage).toHaveBeenCalledTimes(1);
    expect(add2dImage).toHaveBeenCalledWith({
      imageFile: 'images/frame-000007.jpg', // frameIndex encoded into the filename (renamed from frames/, Q5)
      position: [1.5, -2.5, 3.5], // WebXRVec3 → tuple (reducer converts to NUE)
      rotation: [0.1, 0.2, 0.3, 0.9], // WebXRQuaternion → tuple
      screenRotation: 90,
      capturedAt: 1700000000123, // timestamp → capturedAt
    });
  });
});

/**
 * Live CPU-depth occluder wiring (2026-06-29 occlusion-debug-viz-and-live-occluder
 * Finding 2). When `occupancy.liveOcclusion` is on, handleEnterAR must construct a
 * DepthOccluder, add its full-screen mesh to arWorldGroup, feed it the per-frame
 * depth via a registerXrFrameUpdate callback, and dispose it via a session
 * disposer. The actual occlusion render is device-gated; this pins the JS wiring.
 */
describe('Live CPU-depth occluder wiring in live AR', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
    liveOccluderFrameCallbacks.length = 0;
    document.body.innerHTML = `
      <div id="app"></div>
      <div id="setup-modal"><h1 id="setup-title">Recorder</h1></div>
      <div id="controls"></div>
      <div id="replay-controls" class="hidden"></div>
      <div id="ref-point-picker-modal"></div>
    `;
  });

  /** Turn liveOcclusion on for the next Enter-AR (module-global options need the
   *  *ForTesting setter, not a per-call loadRecordingOptions override). */
  function enableLiveOcclusion(): void {
    const base = vi.mocked(loadRecordingOptions)();
    setRecordingOptionsForTesting({
      ...base,
      occupancy: { ...base.occupancy, liveOcclusion: true },
    });
  }

  it('does NOT construct the live occluder when liveOcclusion is off (default)', async () => {
    await handleEnterARForTesting();
    expect(mockDepthOccluderCtor).not.toHaveBeenCalled();
  });

  it('constructs the occluder, adds its mesh to arWorldGroup, and registers the per-frame feed', async () => {
    enableLiveOcclusion();
    await handleEnterARForTesting();

    expect(mockDepthOccluderCtor).toHaveBeenCalledTimes(1);
    expect(mockDepthOccluderInstance.getOcclusionMesh).toHaveBeenCalledTimes(1);
    expect(mockArWorldGroup.add).toHaveBeenCalledWith(mockOcclusionMeshObject);
    expect(mockRegisterXrFrameUpdate).toHaveBeenCalledTimes(1);
  });

  it('feeds per-frame depth to the occluder via the frame callback', async () => {
    enableLiveOcclusion();
    await handleEnterARForTesting();

    const cb = liveOccluderFrameCallbacks[0];
    expect(cb).toBeDefined();
    const pose = { views: [{}] };
    cb!({
      frame: { getViewerPose: vi.fn(() => pose) },
      referenceSpace: { name: 'ref' },
    });
    // getDepthInfoFromFrame returns a truthy depthInfo → update is called with it.
    expect(mockGetDepthInfoFromFrame).toHaveBeenCalledTimes(1);
    expect(mockDepthOccluderInstance.update).toHaveBeenCalledWith({
      depth: true,
    });
  });

  it('does not update the occluder when the frame has no depth (degraded frame)', async () => {
    enableLiveOcclusion();
    mockGetDepthInfoFromFrame.mockReturnValueOnce(null);
    await handleEnterARForTesting();

    liveOccluderFrameCallbacks[0]!({
      frame: { getViewerPose: vi.fn(() => null) },
      referenceSpace: {},
    });
    expect(mockDepthOccluderInstance.update).not.toHaveBeenCalled();
  });

  it('disposes the occluder + unregisters the frame feed on resetMainState', async () => {
    enableLiveOcclusion();
    await handleEnterARForTesting();
    expect(mockDepthOccluderInstance.dispose).not.toHaveBeenCalled();

    resetMainState();
    expect(liveOccluderUnregisterFrame).toHaveBeenCalledTimes(1);
    expect(mockDepthOccluderInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the prior occluder + unregisters when Enter-AR re-enters', async () => {
    enableLiveOcclusion();
    await handleEnterARForTesting();
    enableLiveOcclusion(); // re-enable for the second enter
    await handleEnterARForTesting();

    // The first cycle's occluder/frame feed is torn down before the second wires up.
    expect(liveOccluderUnregisterFrame).toHaveBeenCalled();
    expect(mockDepthOccluderInstance.dispose).toHaveBeenCalled();
    expect(mockDepthOccluderCtor).toHaveBeenCalledTimes(2);
  });
});
