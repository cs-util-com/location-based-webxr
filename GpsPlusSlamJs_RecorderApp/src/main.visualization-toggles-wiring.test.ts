// @vitest-environment jsdom
/**
 * Integration tests for the four live debug-overlay toggles in handleEnterAR
 * (main.ts) — Finding B / Slice 4 of
 * 2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md.
 *
 * Why these tests matter:
 * The `visualization` recording-options group must gate ONLY what is drawn live
 * during recording, read once at Enter-AR, without ever touching capture. Each
 * toggle has a different gate mechanism, asserted here:
 *  - frameTiles    → the FrameTileVisualizer + wiring are created only when on.
 *  - compassCubes  → createGpsCompassCubes is called only when on.
 *  - gpsAlignmentMarkers → gpsEventVisualizer.setVisible(flag) is always called
 *    with the flag (markers stay wired so their snapshot positions feed the
 *    session-summary map; they are only hidden).
 *  - occupancyCubes → the cube InstancedMesh visualizer is created only when on,
 *    but the OccupancyGrid is ALWAYS built and published (COLMAP export reads it
 *    via getOccupancyGrid()), so when off the wirer gets a no-op visualizer sink.
 *
 * Mock harness mirrors main.occupancy-cubes-wiring.test.ts. The recording
 * options are a single hoisted object returned by loadRecordingOptions; because
 * main() runs at import and assigns it by reference to the module's
 * `recordingOptions`, mutating its `visualization` flags per test changes what
 * handleEnterAR reads.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------- hoisted mocks ----------

const {
  mockFrameTileVisualizerCtor,
  mockWireFrameTileSubscribers,
  frameTileDisposers,
  mockOccupancyGridCtor,
  mockOccupancyGridInstance,
  mockOccupancyVisualizerCtor,
  mockOccupancyVisualizerInstance,
  mockWireOccupancyGridSubscribers,
  occupancyDisposers,
  mockCreateGpsCompassCubes,
  mockGpsEventVisualizer,
  mockRecordingOptions,
  mockCreateStatsOverlay,
  mockStatsOverlayInstance,
} = vi.hoisted(() => {
  const mockStatsOverlayInstance = {
    dom: {} as HTMLElement,
    panelCount: 3,
    update: vi.fn(),
    dispose: vi.fn(),
  };
  const mockFrameTileVisualizerInstance = {
    addTile: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    getCount: vi.fn().mockReturnValue(0),
  };
  const mockOccupancyGridInstance = { addSample: vi.fn(), clear: vi.fn() };
  const mockOccupancyVisualizerInstance = {
    refresh: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
  const frameTileDisposers: Array<() => void> = [];
  const occupancyDisposers: Array<() => void> = [];
  return {
    // Constructors must be `function` (arrow fns are not constructable).
    mockFrameTileVisualizerCtor: vi.fn(function () {
      return mockFrameTileVisualizerInstance;
    }),
    mockFrameTileVisualizerInstance,
    mockWireFrameTileSubscribers: vi.fn((_options: unknown) => {
      const dispose = vi.fn();
      frameTileDisposers.push(dispose);
      return dispose;
    }),
    frameTileDisposers,
    mockOccupancyGridCtor: vi.fn(function () {
      return mockOccupancyGridInstance;
    }),
    mockOccupancyGridInstance,
    mockOccupancyVisualizerCtor: vi.fn(function () {
      return mockOccupancyVisualizerInstance;
    }),
    mockOccupancyVisualizerInstance,
    mockWireOccupancyGridSubscribers: vi.fn(
      (options: {
        visualizer: { refresh(g: unknown): void; clear(): void };
      }) => {
        const dispose = vi.fn();
        occupancyDisposers.push(dispose);
        // Record the visualizer sink so tests can assert which one was wired.
        (
          mockWireOccupancyGridSubscribers as unknown as {
            lastVisualizer?: unknown;
          }
        ).lastVisualizer = options.visualizer;
        return dispose;
      }
    ),
    occupancyDisposers,
    mockCreateStatsOverlay: vi.fn(() => mockStatsOverlayInstance),
    mockStatsOverlayInstance,
    mockCreateGpsCompassCubes: vi.fn(),
    mockGpsEventVisualizer: {
      setVisible: vi.fn(),
      clearAll: vi.fn(),
      getCounts: vi.fn().mockReturnValue({ raw: 0, fused: 0, snapshots: 0 }),
      setZeroRef: vi.fn(),
      addGpsEvent: vi.fn(),
      getRawMarkerWorldSizes: vi.fn().mockReturnValue([]),
    },
    mockRecordingOptions: {
      qr: { enabled: false, intervalMs: 125, captureSize: 1024 },
      images: { enabled: false, intervalMs: 1000, quality: 0.8 },
      depth: { enabled: false, intervalMs: 1000 },
      occupancy: { cellSizeM: 0.15, minConfidence: 3 },
      frameTileDisplay: { divisor: 2, maxTiles: 100 },
      visualization: {
        frameTiles: true,
        occupancyCubes: true,
        gpsAlignmentMarkers: true,
        compassCubes: true,
        statsOverlay: false,
      },
      loopClosureDebug: { detectorEnabled: false },
    },
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

// ---------- mocks for the gated modules ----------

vi.mock('./visualization/frame-tile-visualizer', () => ({
  FrameTileVisualizer: mockFrameTileVisualizerCtor,
}));
vi.mock('./visualization/frame-texture-decoder', () => ({
  decodeFrameTexture: vi.fn(),
}));
vi.mock('./visualization/wire-frame-tile-subscribers', () => ({
  wireFrameTileSubscribers: mockWireFrameTileSubscribers,
}));
vi.mock('gps-plus-slam-app-framework/ar/occupancy-grid', () => ({
  OccupancyGrid: mockOccupancyGridCtor,
}));
vi.mock(
  'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer',
  () => ({
    OccupancyCubesVisualizer: mockOccupancyVisualizerCtor,
  })
);
vi.mock('./visualization/wire-occupancy-grid-subscribers', () => ({
  wireOccupancyGridSubscribers: mockWireOccupancyGridSubscribers,
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-compass-cubes', () => ({
  createGpsCompassCubes: mockCreateGpsCompassCubes,
}));
vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: mockGpsEventVisualizer,
}));

// ---------- remaining main.ts dependency stubs (occupancy-test precedent) ----------

vi.mock('gps-plus-slam-app-framework/visualization/camera-follower', () => ({
  createCameraFollower: vi.fn().mockReturnValue({
    object3D: { name: 'camera-follower' },
    update: vi.fn(),
    dispose: vi.fn(),
  }),
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
    writeFrame: vi.fn().mockResolvedValue(undefined),
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
  loadRecordingOptions: vi.fn().mockReturnValue(mockRecordingOptions),
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
vi.mock('./ui/stats-overlay', () => ({
  createStatsOverlay: mockCreateStatsOverlay,
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

// Import after mocks. The occupancy-grid provider is REAL so we can assert the
// grid is published even when the cubes overlay is off.
import { handleEnterARForTesting, resetMainState } from './main';
import { getOccupancyGrid } from './state/occupancy-grid-provider';

describe('Visualization overlay toggles in live AR (Finding B)', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
    frameTileDisposers.length = 0;
    occupancyDisposers.length = 0;
    mockRecordingOptions.frameTileDisplay.maxTiles = 100;
    // Reset to the additive default (all overlays ON, stats OFF) before each
    // test — statsOverlay is the group's one off-by-default field.
    mockRecordingOptions.visualization = {
      frameTiles: true,
      occupancyCubes: true,
      gpsAlignmentMarkers: true,
      compassCubes: true,
      statsOverlay: false,
    };
    document.body.innerHTML = `
      <div id="app"></div>
      <div id="setup-modal"><h1 id="setup-title">Recorder</h1></div>
      <div id="controls"></div>
      <div id="replay-controls" class="hidden"></div>
      <div id="ref-point-picker-modal"></div>
    `;
  });

  describe('all overlays ON (default — purely additive)', () => {
    it('wires every overlay', async () => {
      await handleEnterARForTesting();

      expect(mockFrameTileVisualizerCtor).toHaveBeenCalledTimes(1);
      expect(mockWireFrameTileSubscribers).toHaveBeenCalledTimes(1);
      expect(mockOccupancyVisualizerCtor).toHaveBeenCalledTimes(1);
      expect(mockCreateGpsCompassCubes).toHaveBeenCalledTimes(1);
      expect(mockGpsEventVisualizer.setVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('frameTiles toggle', () => {
    it('does NOT create the frame-tile visualizer or wiring when off', async () => {
      mockRecordingOptions.visualization.frameTiles = false;
      await handleEnterARForTesting();

      expect(mockFrameTileVisualizerCtor).not.toHaveBeenCalled();
      expect(mockWireFrameTileSubscribers).not.toHaveBeenCalled();
      // Independent: the other overlays are unaffected.
      expect(mockOccupancyVisualizerCtor).toHaveBeenCalledTimes(1);
      expect(mockCreateGpsCompassCubes).toHaveBeenCalledTimes(1);
    });

    it('creates the frame-tile visualizer + wiring when on', async () => {
      mockRecordingOptions.visualization.frameTiles = true;
      await handleEnterARForTesting();

      expect(mockFrameTileVisualizerCtor).toHaveBeenCalledTimes(1);
      expect(mockWireFrameTileSubscribers).toHaveBeenCalledTimes(1);
    });

    it('passes the LIVE-only frameTileDisplay.maxTiles cap to the visualizer (Step 4, 2026-07-03 fps plan)', async () => {
      // Why: the FIFO tile cap is a live-session bound; the replay wiring
      // deliberately omits it (asserted in replay-mode.test.ts). This pins
      // that the live constructor actually receives the stored setting.
      mockRecordingOptions.frameTileDisplay.maxTiles = 42;
      await handleEnterARForTesting();

      expect(mockFrameTileVisualizerCtor).toHaveBeenCalledWith(
        expect.anything(),
        { maxTiles: 42 }
      );
    });
  });

  describe('compassCubes toggle', () => {
    it('does NOT call createGpsCompassCubes when off', async () => {
      mockRecordingOptions.visualization.compassCubes = false;
      await handleEnterARForTesting();

      expect(mockCreateGpsCompassCubes).not.toHaveBeenCalled();
    });

    it('calls createGpsCompassCubes when on', async () => {
      mockRecordingOptions.visualization.compassCubes = true;
      await handleEnterARForTesting();

      expect(mockCreateGpsCompassCubes).toHaveBeenCalledTimes(1);
    });
  });

  describe('gpsAlignmentMarkers toggle', () => {
    it('calls setVisible(false) when off (markers stay wired, only hidden)', async () => {
      mockRecordingOptions.visualization.gpsAlignmentMarkers = false;
      await handleEnterARForTesting();

      expect(mockGpsEventVisualizer.setVisible).toHaveBeenCalledWith(false);
    });

    it('calls setVisible(true) when on', async () => {
      mockRecordingOptions.visualization.gpsAlignmentMarkers = true;
      await handleEnterARForTesting();

      expect(mockGpsEventVisualizer.setVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('statsOverlay toggle (Step 0 of the 2026-07-03 long-session fps plan)', () => {
    it('does NOT mount the stats overlay by default (off — debug tool)', async () => {
      await handleEnterARForTesting();

      expect(mockCreateStatsOverlay).not.toHaveBeenCalled();
    });

    it('mounts the stats overlay into the #app dom-overlay root when on', async () => {
      mockRecordingOptions.visualization.statsOverlay = true;
      await handleEnterARForTesting();

      expect(mockCreateStatsOverlay).toHaveBeenCalledTimes(1);
      // Must be (inside) the dom-overlay root or it cannot composite in AR.
      expect(mockCreateStatsOverlay).toHaveBeenCalledWith(
        document.getElementById('app')
      );
    });

    it('disposes a previous cycle overlay on re-enter so panels never stack', async () => {
      mockRecordingOptions.visualization.statsOverlay = true;
      await handleEnterARForTesting();
      expect(mockStatsOverlayInstance.dispose).not.toHaveBeenCalled();

      // Second Enter-AR cycle (back-to-setup → Enter AR): the stale overlay
      // must be disposed even when the toggle is now off.
      mockRecordingOptions.visualization.statsOverlay = false;
      await handleEnterARForTesting();
      expect(mockStatsOverlayInstance.dispose).toHaveBeenCalledTimes(1);
      expect(mockCreateStatsOverlay).toHaveBeenCalledTimes(1);
    });
  });

  describe('occupancyCubes toggle', () => {
    it('still builds + publishes the grid when off (COLMAP reads it) but skips the cube visualizer', async () => {
      mockRecordingOptions.visualization.occupancyCubes = false;
      await handleEnterARForTesting();

      // The grid is built and published regardless of the cubes toggle — the
      // COLMAP export and other non-visualizer consumers read it.
      expect(mockOccupancyGridCtor).toHaveBeenCalledTimes(1);
      expect(getOccupancyGrid()).toBe(mockOccupancyGridInstance);
      // ...and the depth-sample wiring still runs so the grid populates.
      expect(mockWireOccupancyGridSubscribers).toHaveBeenCalledTimes(1);
      // But the rendered cube InstancedMesh is NOT allocated.
      expect(mockOccupancyVisualizerCtor).not.toHaveBeenCalled();
      // The wirer received a no-op sink, not the real visualizer instance.
      const wired = (
        mockWireOccupancyGridSubscribers as unknown as {
          lastVisualizer?: unknown;
        }
      ).lastVisualizer;
      expect(wired).not.toBe(mockOccupancyVisualizerInstance);
    });

    it('builds the cube visualizer and wires it when on', async () => {
      mockRecordingOptions.visualization.occupancyCubes = true;
      await handleEnterARForTesting();

      expect(mockOccupancyGridCtor).toHaveBeenCalledTimes(1);
      expect(mockOccupancyVisualizerCtor).toHaveBeenCalledTimes(1);
      const wired = (
        mockWireOccupancyGridSubscribers as unknown as {
          lastVisualizer?: unknown;
        }
      ).lastVisualizer;
      expect(wired).toBe(mockOccupancyVisualizerInstance);
    });
  });
});
