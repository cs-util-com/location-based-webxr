/**
 * Main Module Tests
 *
 * Tests for the main application coordinator logic.
 *
 * Why these tests matter:
 * The main module coordinates UI events with recording state.
 * These tests verify that user selections (like scenario choice)
 * are properly persisted and used when starting recordings.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GpsCoord } from 'gps-plus-slam-app-framework/types/geo-types';
import type * as StoreModule from './state/recorder-store';

// Use vi.hoisted to define mock state that can be used inside vi.mock factory
const {
  mockState,
  storeListeners,
  mockStore,
  mockStorageStartSession,
  mockSyncManagerInstance,
  mockShowRefPointPicker,
  mockWriteSessionMetadata,
} = vi.hoisted(() => {
  const mockState: {
    gpsData?: {
      zero?: GpsCoord;
      gpsEvents?: {
        gpsPositions?: Array<{
          latitude: number;
          longitude: number;
          altitude?: number;
          timestamp?: number;
        }>;
      };
    };
    recording?: {
      sessionMetadata?: {
        contextTag?: string;
        sessionName?: string;
        startTime?: number;
      };
    };
    scenario?: {
      currentScenarioName?: string;
    };
    refPoints?: {
      entries: ReadonlyArray<{
        id: string;
        timestamp: number;
        name?: string;
        rawGpsPoint?: unknown;
        gpsPoint?: unknown;
      }>;
    };
  } = {
    recording: {
      sessionMetadata: {
        contextTag: 'TestScenario',
        sessionName: 'recording-test',
        startTime: Date.now(),
      },
    },
    scenario: {
      currentScenarioName: '',
    },
    refPoints: { entries: [] },
  };
  const storeListeners: Array<() => void> = [];

  // Mock writeSessionMetadata to verify F1 fix: session.json is written on stop
  // NOTE: Defined before mockStore because mockStore references it (A1 fix).
  const mockWriteSessionMetadata = vi.fn().mockResolvedValue(undefined);

  const mockStore = {
    getState: () => mockState,
    subscribe: (listener: () => void) => {
      storeListeners.push(listener);
      return () => {
        const idx = storeListeners.indexOf(listener);
        if (idx !== -1) {
          storeListeners.splice(idx, 1);
        }
      };
    },
    dispatch: (action?: { type?: string; payload?: unknown }) => {
      // Translate the V2 sidecar-import action into mockState so
      // selectors (and exports like `getImportedRefPoints`) observe
      // the write. Legacy `refPoints/*` actions were removed in
      // 5.7a-3 Option C.
      if (action?.type === 'refPoints/setImportedRefPointEntries') {
        mockState.refPoints = {
          entries: action.payload as NonNullable<
            typeof mockState.refPoints
          >['entries'],
        };
      } else if (action?.type === 'refPoints/resetRefPoints') {
        mockState.refPoints = { entries: [] };
      } else if (action?.type === 'scenario/setCurrentScenarioName') {
        mockState.scenario = {
          ...mockState.scenario,
          currentScenarioName: action.payload as string,
        };
      }
    },
    replaceReducer: () => {},
    [Symbol.observable]: () => {},
    // A1 fix: writeFrame and writeSessionMetadata routed through store
    writeFrame: vi.fn().mockResolvedValue(undefined),
    writeSessionMetadata: mockWriteSessionMetadata,
  };

  // Track if storage.startSession was called (for bug verification)
  const mockStorageStartSession = vi.fn().mockResolvedValue({
    scenarioPath: 'TestScenario',
    sessionPath: 'recording-2026-01-12',
  });

  // Mock sync manager instance for external backup integration tests
  const mockSyncManagerInstance = {
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn().mockReturnValue({
      state: 'idle',
      lastSyncTime: null,
      lastError: null,
    }),
    syncNow: vi.fn().mockResolvedValue(undefined),
  };

  // Mock showRefPointPicker to capture the existingIds passed to it (Task 1e)
  const mockShowRefPointPicker = vi.fn().mockResolvedValue(null);

  return {
    mockState,
    storeListeners,
    mockStore,
    mockStorageStartSession,
    mockSyncManagerInstance,
    mockShowRefPointPicker,
    mockWriteSessionMetadata,
  };
});

vi.mock('./state/recorder-store', async () => {
  const actual: typeof StoreModule = await vi.importActual(
    './state/recorder-store'
  );
  return {
    ...actual,
    createRecorderStore: () => mockStore,
  };
});

// Mock dependencies that handleScenarioChange uses
vi.mock('./storage/scenario-storage', () => ({
  setCurrentScenario: vi.fn().mockResolvedValue(null),
  getCurrentScenarioHandle: vi.fn().mockReturnValue(null),
  initStorage: vi.fn().mockResolvedValue([]),
  startSession: mockStorageStartSession,
  resetForNewSession: vi.fn(),
  clearRefPointsCacheForAllScenarios: vi
    .fn()
    .mockResolvedValue({ scenariosCleared: 0, errors: [] }),
}));

// Mock toast module — handleClearRefPointCache and other handlers call
// showToast(); the real implementation requires initToast() to have been
// called and an attached DOM container. Mocking keeps tests deterministic.
vi.mock('./ui/toast', () => ({
  initToast: vi.fn(),
  showToast: vi.fn(),
  TOAST_DURATION_ERROR: 8000,
}));

// Mock external-file-storage for sync manager integration tests
vi.mock('./storage/external-file-storage', () => ({
  isExternalStorageSupported: vi.fn().mockReturnValue(true),
  selectReadFolder: vi.fn(),
  selectSaveFile: vi.fn(),
  getSaveFileHandle: vi.fn().mockReturnValue(null),
  getSaveFileName: vi.fn().mockReturnValue(null),
  generateSessionFilename: vi
    .fn()
    .mockReturnValue('2025-01-01_00-00-00utc.zip'),
  getReadFolderHandle: vi.fn().mockReturnValue(null),
  resetExternalStorageState: vi.fn(),
  resetForNewRecording: vi.fn(),
  hasReadFolderPermission: vi.fn().mockResolvedValue(false),
}));

// Mock sync-manager for integration tests (uses hoisted mockSyncManagerInstance)
vi.mock('./storage/sync-manager', () => ({
  createSyncManager: vi.fn().mockReturnValue(mockSyncManagerInstance),
  DEFAULT_SYNC_INTERVAL_MS: 60000,
}));

// Mock the recorder's scenario ZIP export for sync/stop integration tests.
vi.mock('./storage/scenario-zip-export', () => ({
  syncScenarioSessionToExternalZip: vi.fn().mockResolvedValue(undefined),
  exportScenarioSessionAsZip: vi
    .fn()
    .mockResolvedValue({ blob: new Blob(['test']), fileCount: 1 }),
}));

// Mock session-summary for stop recording tests
vi.mock('./ui/session-summary', () => ({
  initSessionSummary: vi.fn(),
  showSessionSummary: vi.fn(),
  hideSessionSummary: vi.fn(),
}));

// Mock ref-point-picker to capture existingIds passed to showRefPointPicker (Task 1e)
vi.mock('./ui/ref-point-picker', () => ({
  showRefPointPicker: mockShowRefPointPicker,
  createRefPointPickerHtml: vi.fn().mockReturnValue('<div></div>'),
  isRefPointPickerVisible: vi.fn().mockReturnValue(false),
}));

vi.mock('./storage/ref-point-loader', () => ({
  loadAllRefPoints: vi.fn().mockResolvedValue([]),
  saveRefPointObservation: vi.fn().mockResolvedValue(undefined),
  flattenRefPointsToMarks: vi.fn().mockReturnValue([]),
  listRefPointIds: vi.fn().mockResolvedValue([]),
  averageGpsPerRefPoint: vi.fn().mockReturnValue([]),
}));

vi.mock('gps-plus-slam-app-framework/visualization/reference-points', () => ({
  refPointVisualizer: {
    setZeroRef: vi.fn(),
  },
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
  hideRecordingControls: vi.fn(),
  showRecordingControls: vi.fn(),
  setStopButtonBusy: vi.fn(),
  showArReadyControls: vi.fn(),
  setSaveLocationSelected: vi.fn(),
  setFolderImportExpanded: vi.fn(),
  setFolderImportProgress: vi.fn(),
  updateFolderStatus: vi.fn(),
  updateSaveStatus: vi.fn(),
  updateSyncStatus: vi.fn(),
  resetUIForNewRecording: vi.fn(),
  validateEnterButton: vi.fn(),
  updatePermissionStatus: vi.fn(),
  setPermissionsReady: vi.fn(),
  showSetupModal: vi.fn(),
  updateFrameCount: vi.fn(),
  hideFrameCount: vi.fn(),
  updateRefPointButtonLabel: vi.fn(),
  setNewRefPointButtonVisible: vi.fn(),
  updateTrackingQuality: vi.fn(),
  hideTrackingQuality: vi.fn(),
  setAbsCompassStatus: vi.fn(),
  hideAbsCompass: vi.fn(),
  hideQrStatus: vi.fn(),
  setQrStatus: vi.fn(),
}));

// Mock recording-discovery for handleOpenFolder tests (Issue 1 — 2026-02-27 + 2026-03-01)
vi.mock('./storage/recording-discovery', () => ({
  listScenariosFromFolder: vi.fn().mockResolvedValue([]),
  extractScenarioNamesFromZips: vi.fn().mockResolvedValue([]),
  listSessionZipsInScenario: vi.fn().mockResolvedValue([]),
  discoverScenariosFromZipMetadata: vi.fn().mockResolvedValue({
    scenarioSessions: new Map(),
    scenarioNames: [],
  }),
}));

// Mock ref-point-importer for handleOpenFolder tests (Issue 1 — 2026-02-27)
vi.mock('./storage/ref-point-importer', () => ({
  importRefPointsFromFolder: vi.fn().mockResolvedValue({
    success: true,
    refPoints: [],
    errors: [],
    zipFilesScanned: 0,
  }),
}));

// Mock confirm-dialog for back-during-recording tests (Issue 5 — 2026-02-27)
vi.mock('./ui/confirm-dialog', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(false),
  isConfirmDialogVisible: vi.fn().mockReturnValue(false),
  destroyConfirmDialog: vi.fn(),
}));

// Mock navigation for back-during-recording tests (Issue 5 — 2026-02-27)
vi.mock('./ui/navigation', () => ({
  initNavigation: vi.fn(),
  getCurrentScreen: vi.fn(() => 'setup'),
  enableBeforeUnloadWarning: vi.fn(),
  disableBeforeUnloadWarning: vi.fn(),
  pushScreenState: vi.fn(),
  replaceScreenState: vi.fn(),
}));

vi.mock('./utils/build-info', () => ({
  getBuildInfo: vi.fn().mockReturnValue({
    commitHash: 'test123',
    appVersion: '0.1.0',
    libraryVersion: '1.0.0',
    frameworkVersion: '0.1.0',
    buildTime: '2026-04-20T00:00:00.000Z',
  }),
}));

vi.mock('gps-plus-slam-app-framework/sensors/gps', () => ({
  startGpsWatch: vi.fn(),
  stopGpsWatch: vi.fn(),
  startOrientationWatch: vi.fn(),
  stopOrientationWatch: vi.fn(),
  requestOrientationPermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('gps-plus-slam-app-framework/sensors/gps-error-handler', () => ({
  createGpsErrorHandler: vi.fn().mockReturnValue(() => {}),
}));

// Mock permission-checker for GPS warm-up tests (Issue 4)
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

vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  createGpsPositionHandler: vi.fn().mockReturnValue(() => {}),
  updateDeviceOrientation: vi.fn(),
  resetCoordinatorState: vi.fn(),
  extractOdomPosition: vi.fn().mockReturnValue([0, 0, 0]),
  extractOdomRotation: vi.fn().mockReturnValue([0, 0, 0, 1]),
}));

vi.mock('./state/recording-options', () => {
  // The settings-modal OPTION_BINDINGS table dereferences the *_CONSTRAINTS
  // exports at module load (slider bounds), so this factory must provide their
  // shapes — values are inert here; the real bounds behavior is unit-tested in
  // settings-modal.test.ts and recording-options.test.ts.
  const range = { min: 0, max: 100, step: 1 };
  return {
    DEPTH_CONSTRAINTS: { intervalMs: range, gridSize: range },
    IMAGE_CONSTRAINTS: {
      intervalMs: range,
      quality: range,
      resolutionDivisor: range,
    },
    MOTION_FILTER_CONSTRAINTS: {
      maxAngularVelocity: range,
      maxLinearVelocity: range,
    },
    QUALITY_FILTER_CONSTRAINTS: {
      blurRelativeThreshold: range,
      minMeanLuminance: range,
    },
    OCCUPANCY_CONSTRAINTS: {
      cellSizeM: range,
      minConfidence: range,
      occluderRadiusM: range,
    },
    FRAME_TILE_DISPLAY_CONSTRAINTS: { divisor: range, maxTiles: range },
    QR_CONSTRAINTS: { intervalMs: range, captureSize: range },
    COMPASS_DEBUG_CONSTRAINTS: { voteWeight: range },
    // main.ts also consumes the pure compassStoreOptions mapping — stubbed
    // inert here; its real logic is unit-tested in recording-options.test.ts.
    compassStoreOptions: () => ({}),
    loadRecordingOptions: vi.fn().mockReturnValue({
      qr: { enabled: false, intervalMs: 125, captureSize: 1024 },
      images: { enabled: false, intervalMs: 1000, quality: 0.8 },
      depth: { enabled: false, intervalMs: 1000 },
      arCrashIsolation: {
        enableDomOverlay: true,
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: true,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: false,
      },
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
  };
});

// odometryTrackingRestarted action creator mock (dispatched by the tracking
// onRestarted callback passed to initAR).
const { mockOdometryTrackingRestarted } = vi.hoisted(() => {
  const mockOdometryTrackingRestarted = vi.fn((payload: unknown) => ({
    type: 'gpsData/odometryTrackingRestarted',
    payload,
  }));
  return {
    mockOdometryTrackingRestarted,
  };
});

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  endARSession: vi.fn().mockResolvedValue(undefined),
  isWebXRSupported: vi.fn().mockResolvedValue(true),
  getCurrentArPose: vi.fn().mockReturnValue(null),
  applyAlignmentMatrix: vi.fn(),
  startImageCapture: vi.fn(),
  stopImageCapture: vi.fn(),
  startDepthCapture: vi.fn(),
  stopDepthCapture: vi.fn(),
  rebindTrackingStore: vi.fn(),
  getScene: vi.fn().mockReturnValue(null),
  getCamera: vi.fn().mockReturnValue(null),
  getArWorldGroup: vi.fn().mockReturnValue(null),
  getDepthInfoFromFrame: vi.fn().mockReturnValue(null),
  getImageCaptureFrameCount: vi.fn().mockReturnValue(0),
  getDepthSampleCount: vi.fn().mockReturnValue(0),
}));

/**
 * Extract the `callbacks` struct handed to the mocked initAR (4th argument).
 * Since the pre-init setter fold (surface-reduction step 1), every wiring
 * assertion that used to pin "setX was called before initAR" instead pins the
 * corresponding field of this struct.
 */
async function getInitArCallbacks() {
  const { initAR } =
    await import('gps-plus-slam-app-framework/ar/webxr-session');
  const call = vi.mocked(initAR).mock.calls[0];
  expect(call).toBeDefined();
  const callbacks = call![3];
  expect(callbacks).toBeDefined();
  return callbacks!;
}

// Mock the framework's core re-export — provides odometryTrackingRestarted action creator.
// (After the Option-C migration, app code imports core symbols via
// `gps-plus-slam-app-framework/core` rather than directly from `gps-plus-slam-js`.)
vi.mock('gps-plus-slam-app-framework/core', () => ({
  odometryTrackingRestarted: mockOdometryTrackingRestarted,
}));

vi.mock('gps-plus-slam-app-framework', () => ({
  selectTrackingQuality: vi.fn().mockReturnValue(null),
}));

import {
  getCurrentScenarioName,
  setCurrentScenarioName,
  resetMainState,
  handleScenarioChangeForTesting,
  waitForZeroReference,
  handleStartRecordingForTesting,
  resetForNewRecording,
  getImportedRefPoints,
  setImportedRefPointsForTesting,
  loadAndDisplayRefPoints,
  handleOpenFolderForTesting,
  setCachedOpfsScenariosForTesting,
  handleBackDuringRecordingForTesting,
  setReplayModeForTesting,
  handleReplayScenarioChangeForTesting,
  getReplaySessionEntriesForTesting,
  handleRefPointIndexingSettled,
} from './main';
import { startSession as storageStartSession } from './storage/scenario-storage';
import { resetForNewSession } from './storage/scenario-storage';
import {
  resetForNewRecording as resetExternalForNewRecording,
  hasReadFolderPermission,
  getReadFolderHandle,
  selectReadFolder,
} from './storage/external-file-storage';
import { hideSessionSummary } from './ui/session-summary';
import {
  resetUIForNewRecording,
  populateScenarios,
  updateFolderStatus,
  setFolderImportProgress,
} from './ui/hud';
import { showToast } from './ui/toast';
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  listSessionZipsInScenario,
  discoverScenariosFromZipMetadata,
} from './storage/recording-discovery';
import { importRefPointsFromFolder } from './storage/ref-point-importer';
import { showConfirmDialog } from './ui/confirm-dialog';
import { pushScreenState } from './ui/navigation';

// Helper to simulate state changes
function simulateStateChange(): void {
  for (const listener of storeListeners) {
    listener();
  }
}

describe('Scenario Name State', () => {
  beforeEach(() => {
    // Reset state before each test
    resetMainState();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * Issue #7 - When user selects a scenario from the dropdown,
   * currentScenarioName must be updated so that handleStartRecording
   * uses the correct scenario instead of 'Default Scenario'.
   */
  it('should update currentScenarioName when setCurrentScenarioName is called', () => {
    // Initially empty
    expect(getCurrentScenarioName()).toBe('');

    // Simulate user selecting a scenario
    setCurrentScenarioName('Paris Eiffeltower');

    // Should be updated
    expect(getCurrentScenarioName()).toBe('Paris Eiffeltower');
  });

  /**
   * Why this test matters:
   * Verifies that the reset function works correctly for test isolation.
   */
  it('should reset currentScenarioName to empty string', () => {
    setCurrentScenarioName('Test Scenario');
    expect(getCurrentScenarioName()).toBe('Test Scenario');

    resetMainState();

    expect(getCurrentScenarioName()).toBe('');
  });

  /**
   * Why this test matters:
   * Ensures that scenario selection persists across multiple changes.
   */
  it('should persist the last selected scenario name', () => {
    setCurrentScenarioName('Scenario A');
    expect(getCurrentScenarioName()).toBe('Scenario A');

    setCurrentScenarioName('Scenario B');
    expect(getCurrentScenarioName()).toBe('Scenario B');

    // Should be the last one set
    expect(getCurrentScenarioName()).toBe('Scenario B');
  });

  /**
   * Why this test matters:
   * This is the ACTUAL BUG test (Issue #7).
   * handleScenarioChange must update currentScenarioName so that
   * when the user starts recording, the correct scenario is used.
   */
  it('should update currentScenarioName when handleScenarioChange is called', async () => {
    // Initially empty
    expect(getCurrentScenarioName()).toBe('');

    // Simulate user selecting a scenario from dropdown (triggers handleScenarioChange)
    await handleScenarioChangeForTesting('My Test Scenario');

    expect(getCurrentScenarioName()).toBe('My Test Scenario');
  });
});

describe('waitForZeroReference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset mock state
    delete mockState.gpsData;
    storeListeners.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Why this test matters:
   * Issue #2 - When zero reference is already set, we should return immediately
   * without waiting for any timeout or state changes.
   */
  it('should resolve immediately if zero reference is already set', async () => {
    mockState.gpsData = { zero: { lat: 52.52, lng: 13.405 } };

    const result = await waitForZeroReference(5000);

    expect(result).toEqual({ lat: 52.52, lng: 13.405 });
  });

  /**
   * Why this test matters:
   * Issue #2 - When zero reference becomes available via state subscription,
   * we should resolve promptly rather than waiting the full timeout.
   */
  it('should resolve when zero reference becomes available via subscription', async () => {
    // Start with no zero reference
    mockState.gpsData = undefined;

    const promise = waitForZeroReference(10000);

    // Simulate GPS zero reference arriving after 500ms
    setTimeout(() => {
      mockState.gpsData = { zero: { lat: 48.8566, lng: 2.3522 } };
      simulateStateChange();
    }, 500);

    // Advance timers to trigger the setTimeout
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  /**
   * Why this test matters:
   * Issue #2 - When no zero reference arrives within timeout, we should
   * return null instead of hanging forever or throwing.
   */
  it('should resolve with null if timeout expires without zero reference', async () => {
    mockState.gpsData = undefined;

    const promise = waitForZeroReference(1000);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1001);

    const result = await promise;
    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * Ensures the subscription cleanup happens properly to avoid memory leaks.
   */
  it('should unsubscribe after resolving', async () => {
    mockState.gpsData = { zero: { lat: 40.7128, lng: -74.006 } };

    const initialListenerCount = storeListeners.length;

    await waitForZeroReference(5000);

    // Listener should be removed after resolution
    expect(storeListeners.length).toBe(initialListenerCount);
  });

  /**
   * Why this test matters:
   * The state might have gpsData but no zero property - we should wait.
   */
  it('should wait if gpsData exists but zero is not set', async () => {
    mockState.gpsData = {}; // gpsData exists but zero is undefined

    const promise = waitForZeroReference(2000);

    setTimeout(() => {
      mockState.gpsData = { zero: { lat: 51.5074, lng: -0.1278 } };
      simulateStateChange();
    }, 100);

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toEqual({ lat: 51.5074, lng: -0.1278 });
  });
});

describe('Session Notes', () => {
  beforeEach(() => {
    // Set up DOM with session-notes textarea
    document.body.innerHTML = `
      <textarea id="session-notes">Test notes about this session</textarea>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetMainState();
  });

  /**
   * Why this test matters:
   * Issue #8 - Session notes UI exists but is not wired to store.
   * The getSessionNotes function should read the value from the textarea.
   */
  it('should read session notes from textarea', async () => {
    const { getSessionNotes } = await import('./main');
    const notes = getSessionNotes();
    expect(notes).toBe('Test notes about this session');
  });

  /**
   * Why this test matters:
   * When textarea is empty, should return empty string (not undefined).
   */
  it('should return empty string when textarea is empty', async () => {
    const textarea = document.getElementById(
      'session-notes'
    ) as HTMLTextAreaElement;
    textarea.value = '';

    const { getSessionNotes } = await import('./main');
    const notes = getSessionNotes();
    expect(notes).toBe('');
  });

  /**
   * Why this test matters:
   * If textarea doesn't exist, should return empty string gracefully.
   */
  it('should return empty string when textarea does not exist', async () => {
    document.body.innerHTML = ''; // Remove textarea

    const { getSessionNotes } = await import('./main');
    const notes = getSessionNotes();
    expect(notes).toBe('');
  });

  /**
   * Why this test matters:
   * Whitespace-only notes should be treated as empty.
   */
  it('should trim whitespace from notes', async () => {
    const textarea = document.getElementById(
      'session-notes'
    ) as HTMLTextAreaElement;
    textarea.value = '  Some notes with whitespace  ';

    const { getSessionNotes } = await import('./main');
    const notes = getSessionNotes();
    expect(notes).toBe('Some notes with whitespace');
  });
});

describe('Storage Session Initialization', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * BUG: handleStartRecording dispatches Redux startSession action but never
   * calls storage.startSession(), leaving actionsHandle/framesHandle null.
   * This causes writeAction to throw "No active session" on every action dispatch.
   *
   * The fix: call storage.startSession() before dispatching any actions that
   * trigger persistence (i.e., before the Redux startSession action).
   */
  it('should call storage.startSession before dispatching actions', async () => {
    // Set up a scenario name
    setCurrentScenarioName('TestScenario');

    // Call handleStartRecording (the function under test)
    await handleStartRecordingForTesting();

    // EXPECTED: storage.startSession should have been called to initialize
    // the File System Access handles (actionsHandle, framesHandle)
    expect(storageStartSession).toHaveBeenCalled();
    expect(storageStartSession).toHaveBeenCalledWith('TestScenario');
  });

  /**
   * Why this test matters:
   * Issue #2 (User Feedback 2025-01-25): When entering AR, the UI showed Start+Stop
   * buttons simultaneously. The fix: AR_READY shows only Start; when recording starts,
   * showRecordingControls() switches to Stop + indicator. This test verifies
   * handleStartRecording calls showRecordingControls to transition to RECORDING state.
   */
  it('should call showRecordingControls when recording starts', async () => {
    const { showRecordingControls } = await import('./ui/hud');

    // Set up a scenario name
    setCurrentScenarioName('TestScenario');

    // Call handleStartRecording
    await handleStartRecordingForTesting();

    // EXPECTED: showRecordingControls should be called to show Stop button
    // and hide Start button, transitioning from AR_READY → RECORDING
    expect(showRecordingControls).toHaveBeenCalled();
  });
});

describe('GPS Error Handler Integration', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * Field Test Readiness Issue #1 - GPS errors must be shown to the user
   * instead of only being logged. startGpsWatch must be called with an
   * onError callback that displays user-friendly messages.
   */
  it('should pass GPS error handler to startGpsWatch', async () => {
    const { startGpsWatch } =
      await import('gps-plus-slam-app-framework/sensors/gps');

    // Set up a scenario name
    setCurrentScenarioName('TestScenario');

    // Call handleStartRecording
    await handleStartRecordingForTesting();

    // EXPECTED: startGpsWatch should have been called with two arguments:
    // the position handler AND an error handler
    expect(startGpsWatch).toHaveBeenCalled();
    const calls = vi.mocked(startGpsWatch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // The second argument should be a function (the error handler)
    const [, errorHandler] = calls[0];
    expect(typeof errorHandler).toBe('function');
  });
});

describe('Orientation Permission Handling', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * Field Test Readiness Issue #2 - When orientation permission is denied
   * (especially on iOS), the user should be warned that compass data
   * will be unavailable. The return value of requestOrientationPermission
   * must be checked and acted upon.
   */
  it('should show warning when orientation permission is denied', async () => {
    const { requestOrientationPermission } =
      await import('gps-plus-slam-app-framework/sensors/gps');
    const { showError } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    // Mock permission denied
    vi.mocked(requestOrientationPermission).mockResolvedValue(false);

    // Call handleEnterAR
    await handleEnterARForTesting();

    // EXPECTED: showError should be called with a message about compass
    expect(showError).toHaveBeenCalledWith(
      expect.stringMatching(/compass|orientation/i)
    );
  });

  /**
   * Why this test matters:
   * When permission is granted, no warning should be shown.
   */
  it('should not show warning when orientation permission is granted', async () => {
    const { requestOrientationPermission } =
      await import('gps-plus-slam-app-framework/sensors/gps');
    const { showError } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    // Reset mocks to clear any previous calls
    vi.clearAllMocks();

    // Mock permission granted
    vi.mocked(requestOrientationPermission).mockResolvedValue(true);

    // Call handleEnterAR
    await handleEnterARForTesting();

    // EXPECTED: showError should NOT be called for orientation
    const showErrorCalls = vi.mocked(showError).mock.calls;
    const orientationErrors = showErrorCalls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0].toLowerCase().includes('compass') ||
          call[0].toLowerCase().includes('orientation'))
    );
    expect(orientationErrors).toHaveLength(0);
  });
});

describe('AR Partial Init Failure Cleanup (Issue #10)', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters (Issue #10):
   * If initAR() succeeds but a later step throws (e.g., the arWorldGroup
   * wiring), the AR session is left running with incomplete wiring. The catch
   * block must call endARSession() to tear down the XR session and free GPU
   * resources. Without this, users see a camera feed but nothing works.
   */
  it('should call endARSession when post-init setup throws', async () => {
    const { initAR, getArWorldGroup, endARSession } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const { showError } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    vi.clearAllMocks();
    document.body.innerHTML = '<div id="app"></div>';

    // initAR succeeds
    vi.mocked(initAR).mockResolvedValue(undefined);

    // getArWorldGroup throws (simulates post-init failure)
    vi.mocked(getArWorldGroup).mockImplementation(() => {
      throw new Error('Post-init failure');
    });

    await handleEnterARForTesting();

    // Restore the default so later tests see the usual null return.
    vi.mocked(getArWorldGroup).mockReset();
    vi.mocked(getArWorldGroup).mockReturnValue(null);

    expect(initAR).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        enableDomOverlay: true,
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: true,
        enableCameraTextureAcquisition: true,
      }),
      // Live occluder OFF in the default mock options → depth occlusion not
      // requested as a session feature (2026-06-29 two-occlusion-toggles).
      expect.objectContaining({ requestDepthOcclusion: false }),
      // The per-session callbacks struct (surface-reduction step 1).
      expect.any(Object)
    );

    // endARSession should be called to clean up the XR session
    expect(endARSession).toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  /**
   * Why this test matters (2026-06-29 two-composable-occlusion-toggles):
   * the "Live depth occluder" checkbox (occupancy.liveOcclusion) must request
   * the `requestDepthOcclusion` session feature so the session negotiates the
   * `cpu-optimized` depth stream the live occluder consumes — even when depth
   * *recording* is independent. This is the CI-testable half of the live
   * wiring; the render-side integration is device-gated (see the follow-ups).
   */
  it('requests depth occlusion as a session feature when liveOcclusion is on', async () => {
    const { initAR } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const { loadRecordingOptions } = await import('./state/recording-options');
    const { handleEnterARForTesting, setRecordingOptionsForTesting } =
      await import('./main');

    vi.clearAllMocks();
    document.body.innerHTML = '<div id="app"></div>';
    vi.mocked(initAR).mockResolvedValue(undefined);

    // Turn the live occluder ON for this one Enter-AR by overriding the
    // module-level recording options (spread the default mock so every other
    // field main.ts reads stays intact).
    const base = vi.mocked(loadRecordingOptions)();
    setRecordingOptionsForTesting({
      ...base,
      occupancy: { ...base.occupancy, liveOcclusion: true },
    });

    await handleEnterARForTesting();

    expect(initAR).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.any(Object),
      expect.objectContaining({ requestDepthOcclusion: true }),
      expect.any(Object)
    );
  });
});

describe('AR Tracking Lost Callback', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * Field Test Readiness Issue #3 - When AR tracking is lost, the user
   * should be warned so they can move to a better location. This test
   * verifies that handleEnterAR wires the tracking group (store + onLost)
   * into initAR's callbacks struct.
   */
  it('should wire the tracking-lost callback into initAR during AR initialization', async () => {
    const { handleEnterARForTesting } = await import('./main');

    // Call handleEnterAR
    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    // Store + callbacks arrive together in the tracking group.
    expect(callbacks.tracking?.store).toBeDefined();
    expect(typeof callbacks.tracking?.onLost).toBe('function');
  });

  /**
   * Why this test matters:
   * Verifies that when tracking is lost, the callback shows an error
   * message with guidance for the user.
   */
  it('should show error message when tracking lost callback is invoked', async () => {
    const { showError, updateArInfo } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    // Reset the mock to capture fresh calls
    vi.clearAllMocks();

    // Call handleEnterAR
    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    const trackingCallback = callbacks.tracking!.onLost!;

    // Clear mocks before invoking callback to isolate its effects
    vi.mocked(showError).mockClear();
    vi.mocked(updateArInfo).mockClear();

    // Invoke the callback as if tracking was lost
    trackingCallback();

    // EXPECTED: showError should be called with a message about tracking
    expect(showError).toHaveBeenCalledWith(
      expect.stringMatching(/tracking.*lost|lost.*tracking/i)
    );

    // EXPECTED: updateArInfo should be called with a warning indicator
    expect(updateArInfo).toHaveBeenCalledWith(expect.stringMatching(/lost/i));
  });
});

describe('AR Tracking Restart Callbacks (Phase 1+2)', () => {
  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters:
   * Phase 1 — the tracking `onRestarted` callback must ride into initAR's
   * callbacks struct so that when the tracking slice detects an origin-reset
   * recovery (Case 2), the store receives the odometryTrackingRestarted
   * action to correct accumulated offsets and clear stale trajectory data.
   */
  it('should set up tracking restart callbacks during AR initialization', async () => {
    const { handleEnterARForTesting } = await import('./main');

    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    expect(typeof callbacks.tracking?.onRestarted).toBe('function');
  });

  /**
   * Why this test matters:
   * Verifies the restart callback dispatches odometryTrackingRestarted
   * to the store so the reducer can accumulate position/rotation offsets
   * and clear stale event history.
   */
  it('should dispatch odometryTrackingRestarted when restart callback fires', async () => {
    const { handleEnterARForTesting } = await import('./main');

    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    const callback = callbacks.tracking!.onRestarted! as (
      payload: unknown
    ) => void;

    const fakePayload = {
      posOffset: { x: 1, y: 2, z: 3 },
      rotOffset: { x: 0, y: 0, z: 0, w: 1 },
    };

    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');
    dispatchSpy.mockClear();

    callback(fakePayload);

    expect(mockOdometryTrackingRestarted).toHaveBeenCalledWith(fakePayload);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gpsData/odometryTrackingRestarted',
        payload: fakePayload,
      })
    );
  });

  /**
   * Why this test matters:
   * Regression: Case 2 (origin reset) must clear the "LOST" UI indicator,
   * just like Case 1 (seamless recovery). Without this, the LOST warning
   * persists after a successful Case 2 relocalization.
   */
  it('should clear AR info when tracking restart callback fires (Case 2)', async () => {
    const { updateArInfo } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    vi.clearAllMocks();

    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    const callback = callbacks.tracking!.onRestarted! as (
      payload: unknown
    ) => void;

    vi.mocked(updateArInfo).mockClear();

    const fakePayload = {
      posOffset: { x: 1, y: 2, z: 3 },
      rotOffset: { x: 0, y: 0, z: 0, w: 1 },
    };

    callback(fakePayload);

    // Should clear the LOST indicator on Case 2 recovery
    expect(updateArInfo).toHaveBeenCalledWith('');
  });

  /**
   * Why this test matters:
   * Phase 2 Case 1 — the tracking `onRecovered` callback handles seamless
   * recovery where the coordinate frame hasn't changed. It should
   * clear the "LOST" UI indicator without dispatching alignment correction.
   */
  it('should set up tracking recovered callback during AR initialization', async () => {
    const { handleEnterARForTesting } = await import('./main');

    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    expect(typeof callbacks.tracking?.onRecovered).toBe('function');
  });

  /**
   * Why this test matters:
   * Verifies that the recovered callback clears the AR info display
   * (removing the "LOST" indicator) without dispatching any store action.
   */
  it('should clear AR info when tracking recovered callback fires', async () => {
    const { updateArInfo } = await import('./ui/hud');
    const { handleEnterARForTesting } = await import('./main');

    vi.clearAllMocks();

    await handleEnterARForTesting();

    const callbacks = await getInitArCallbacks();
    const recoveredCallback = callbacks.tracking!.onRecovered!;

    vi.mocked(updateArInfo).mockClear();
    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');
    dispatchSpy.mockClear();

    recoveredCallback();

    // Should clear the AR info display
    expect(updateArInfo).toHaveBeenCalledWith('');

    // Should NOT dispatch odometryTrackingRestarted (Case 1: same frame)
    expect(mockOdometryTrackingRestarted).not.toHaveBeenCalled();
  });
});

describe('External ZIP Sync Integration', () => {
  /**
   * Why this test matters:
   * Issue 1a review finding - When user selects a save location for external backup,
   * the SyncManager must be started during recording so that OPFS data is periodically
   * synced to the external ZIP file. Without this, the "Choose Save Location" button
   * appears to work but data is never actually synced to the user's chosen location.
   */
  it('should start SyncManager when save file handle is available', async () => {
    const { createSyncManager } = await import('./storage/sync-manager');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const { handleStartRecordingForTesting, resetMainState } =
      await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock a save file handle being selected
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
      createWritable: vi.fn(() =>
        Promise.resolve({
          write: vi.fn(() => Promise.resolve()),
          close: vi.fn(() => Promise.resolve()),
        })
      ),
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording
    await handleStartRecordingForTesting();

    // EXPECTED: createSyncManager should have been called
    expect(createSyncManager).toHaveBeenCalled();

    // EXPECTED: The manager's start() should have been called
    // Use the hoisted mock instance directly (avoids unsafe member access)
    expect(mockSyncManagerInstance.start).toHaveBeenCalled();

    resetMainState();
  });

  /**
   * Why this test matters:
   * When no save file handle is selected (external backup not configured),
   * SyncManager should NOT be created. OPFS still provides crash-safe storage,
   * but there's nothing to sync to.
   */
  it('should NOT start SyncManager when no save file handle is available', async () => {
    const { createSyncManager } = await import('./storage/sync-manager');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const { handleStartRecordingForTesting, resetMainState } =
      await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock no save file handle selected
    vi.mocked(getSaveFileHandle).mockReturnValue(null);

    // Start recording
    await handleStartRecordingForTesting();

    // EXPECTED: createSyncManager should NOT have been called
    expect(createSyncManager).not.toHaveBeenCalled();

    resetMainState();
  });

  /**
   * Why this test matters:
   * When recording stops, SyncManager must be stopped to clean up resources
   * (clear interval timers, remove visibility listeners) and perform a final sync.
   */
  it('should stop SyncManager when recording stops', async () => {
    // Note: createSyncManager is mocked at module level, no need to import here
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock a save file handle being selected
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording
    await handleStartRecordingForTesting();

    // Stop recording (now async to await final sync)
    await handleStopRecordingForTesting();

    // EXPECTED: The manager's stop() should have been called
    // Use the hoisted mock instance directly (avoids unsafe member access)
    expect(mockSyncManagerInstance.stop).toHaveBeenCalled();

    resetMainState();
  });

  /**
   * Why this test matters (Task 1d - 2026-01-27 user feedback):
   * The onStatusChange callback from SyncManager must update the HUD sync indicator.
   * Without this wiring, the user has no visibility into whether their external backup
   * is working. The UI has updateSyncStatus() but it was never called.
   */
  it('should wire onStatusChange to updateSyncStatus in HUD', async () => {
    const { createSyncManager } = await import('./storage/sync-manager');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const { updateSyncStatus } = await import('./ui/hud');
    const { handleStartRecordingForTesting, resetMainState } =
      await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock a save file handle being selected
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording - this should create the SyncManager with onStatusChange wired
    await handleStartRecordingForTesting();

    // VERIFY: createSyncManager was called with options containing onStatusChange
    expect(createSyncManager).toHaveBeenCalled();
    const callArgs = vi.mocked(createSyncManager).mock.calls[0];
    const options = callArgs[1] as {
      onStatusChange?: (status: unknown) => void;
    };
    expect(options).toBeDefined();
    expect(options.onStatusChange).toBeDefined();

    // Simulate a status change from the SyncManager
    const testStatus = {
      state: 'active' as const,
      lastSyncTime: Date.now(),
      lastError: null,
    };
    options.onStatusChange!(testStatus);

    // EXPECTED: updateSyncStatus should have been called with the status
    expect(updateSyncStatus).toHaveBeenCalledWith(testStatus);

    resetMainState();
  });
});

// ============================================================================
// Session Metadata Persistence (Finding F1)
// ============================================================================

describe('Session Metadata Persistence (F1)', () => {
  /**
   * Why this test matters (Finding F1 - Production Bug):
   * writeSessionMetadata() exists in opfs-storage.ts and has unit tests,
   * but is never called from production code. Without this call, exported
   * zip files lack session.json, losing critical metadata (timing, counts,
   * user agent). This test verifies that handleStopRecording() writes
   * session metadata before the session ends.
   */
  it('should call writeSessionMetadata when recording stops', async () => {
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock a save file handle being selected
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording
    await handleStartRecordingForTesting();

    // Stop recording — should write session metadata
    await handleStopRecordingForTesting();

    // EXPECTED: writeSessionMetadata must be called exactly once
    expect(mockWriteSessionMetadata).toHaveBeenCalledTimes(1);

    resetMainState();
  });

  it('should pass correct metadata fields to writeSessionMetadata', async () => {
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Mock a save file handle
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording
    await handleStartRecordingForTesting();

    // Stop recording
    await handleStopRecordingForTesting();

    // Verify metadata structure
    expect(mockWriteSessionMetadata).toHaveBeenCalledTimes(1);
    const metadata = mockWriteSessionMetadata.mock.calls[0][0] as {
      version: number;
      contextTag?: string;
      startedAt: string;
      endedAt: string;
      actionCount: number;
      frameCount: number;
      userAgent: string;
    };

    // Must have version field for forward compatibility
    expect(metadata.version).toBe(1);
    // Must have scenario name from store state (recorded as opaque contextTag)
    expect(metadata.contextTag).toBe('TestScenario');
    // Must have timestamps
    expect(typeof metadata.startedAt).toBe('string');
    expect(typeof metadata.endedAt).toBe('string');
    // Must have counts
    expect(typeof metadata.actionCount).toBe('number');
    expect(typeof metadata.frameCount).toBe('number');
    // Must have user agent
    expect(typeof metadata.userAgent).toBe('string');

    resetMainState();
  });

  /**
   * Why this test matters (Finding F2 - 2026-03-01 user feedback):
   * writeSessionMetadata() must be called BEFORE the final syncManager.syncNow()
   * so that session.json is included in the external ZIP file. If the order is
   * reversed (sync first, then write metadata), the ZIP produced during recording
   * will lack session.json — breaking replay-mode scenario discovery (Issue 1)
   * which reads scenarioName from session.json inside each zip.
   */
  it('should call writeSessionMetadata BEFORE final syncNow (F2 ordering fix)', async () => {
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Track call order between writeSessionMetadata and syncNow
    const callOrder: string[] = [];
    mockWriteSessionMetadata.mockImplementation(() => {
      callOrder.push('writeSessionMetadata');
      return Promise.resolve();
    });
    mockSyncManagerInstance.syncNow.mockImplementation(() => {
      callOrder.push('syncNow');
      return Promise.resolve();
    });

    // Mock a save file handle being selected (triggers SyncManager creation)
    const mockHandle = {
      kind: 'file' as const,
      name: 'test-session.zip',
    } as unknown as FileSystemFileHandle;
    vi.mocked(getSaveFileHandle).mockReturnValue(mockHandle);

    // Start recording (creates SyncManager)
    await handleStartRecordingForTesting();

    // Stop recording — must write metadata THEN do final sync
    await handleStopRecordingForTesting();

    // EXPECTED: writeSessionMetadata runs before syncNow
    expect(callOrder).toContain('writeSessionMetadata');
    expect(callOrder).toContain('syncNow');
    const metadataIndex = callOrder.indexOf('writeSessionMetadata');
    const syncIndex = callOrder.indexOf('syncNow');
    expect(metadataIndex).toBeLessThan(syncIndex);

    resetMainState();
  });
});

// Issue 3 (2026-02-27 user feedback): Share button / ZIP stats missing on summary screen
describe('ZIP generation without external save location (Issue 3)', () => {
  /**
   * Why this test matters:
   * When no external save location is chosen, the summary screen showed
   * "—" for ZIP stats and hid the share button, because lastSyncResult
   * was only populated via SyncManager (which requires a save file handle).
   * The fix generates a ZIP from OPFS at recording stop so the summary
   * always has ZIP data.
   */
  it('should call exportSessionAsZip when no save file handle exists', async () => {
    const { exportScenarioSessionAsZip: exportSessionAsZip } =
      await import('./storage/scenario-zip-export');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    resetMainState();
    vi.clearAllMocks();

    // No external save location
    vi.mocked(getSaveFileHandle).mockReturnValue(null);

    // Mock exportSessionAsZip to return a result
    const mockBlob = new Blob(['test'], { type: 'application/zip' });
    vi.mocked(exportSessionAsZip).mockResolvedValue({
      blob: mockBlob,
      fileCount: 3,
    });

    await handleStartRecordingForTesting();
    await handleStopRecordingForTesting();

    // EXPECTED: exportSessionAsZip should be called as fallback
    expect(exportSessionAsZip).toHaveBeenCalledTimes(1);

    resetMainState();
  });

  /**
   * Why this test matters:
   * The summary data must include ZIP blob, size, and file count so
   * the share button is visible and ZIP stats display real values
   * instead of "—".
   */
  it('should pass ZIP data to showSessionSummary when no save file handle', async () => {
    const { showSessionSummary } = await import('./ui/session-summary');
    const { exportScenarioSessionAsZip: exportSessionAsZip } =
      await import('./storage/scenario-zip-export');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    resetMainState();
    vi.clearAllMocks();

    // No external save location
    vi.mocked(getSaveFileHandle).mockReturnValue(null);

    // Mock exportSessionAsZip to return a result with known values
    const mockBlob = new Blob(['zip-content'], { type: 'application/zip' });
    vi.mocked(exportSessionAsZip).mockResolvedValue({
      blob: mockBlob,
      fileCount: 5,
    });

    await handleStartRecordingForTesting();
    await handleStopRecordingForTesting();

    // EXPECTED: showSessionSummary called with ZIP data populated
    expect(showSessionSummary).toHaveBeenCalledTimes(1);
    const summaryData = vi.mocked(showSessionSummary).mock.calls[0][0] as {
      zipBlob?: Blob;
      zipSizeBytes?: number;
      zipFileCount?: number;
    };
    expect(summaryData.zipBlob).toBe(mockBlob);
    expect(summaryData.zipSizeBytes).toBe(mockBlob.size);
    expect(summaryData.zipFileCount).toBe(5);

    resetMainState();
  });

  /**
   * Why this test matters:
   * When exportSessionAsZip fails (e.g., OPFS error), the recording
   * stop should still complete gracefully — summary shows without ZIP
   * data rather than crashing.
   */
  it('should handle exportSessionAsZip failure gracefully', async () => {
    const { showSessionSummary } = await import('./ui/session-summary');
    const { exportScenarioSessionAsZip: exportSessionAsZip } =
      await import('./storage/scenario-zip-export');
    const { getSaveFileHandle } =
      await import('./storage/external-file-storage');
    const {
      handleStartRecordingForTesting,
      handleStopRecordingForTesting,
      resetMainState,
    } = await import('./main');

    resetMainState();
    vi.clearAllMocks();

    // No external save location
    vi.mocked(getSaveFileHandle).mockReturnValue(null);

    // Mock exportSessionAsZip to throw
    vi.mocked(exportSessionAsZip).mockRejectedValue(
      new Error('OPFS read failed')
    );

    await handleStartRecordingForTesting();
    // Should not throw
    await handleStopRecordingForTesting();

    // EXPECTED: showSessionSummary still called (summary shows, just without ZIP data)
    expect(showSessionSummary).toHaveBeenCalledTimes(1);

    resetMainState();
  });
});

describe('Imported Reference Points in Picker (Task 1e)', () => {
  /**
   * Why this test matters (Task 1e - 2026-01-27 user feedback):
   * When user imports ref points from previous session ZIPs via folder selection,
   * those ref points are used for re-observation detection. If GPS matches an
   * imported ref (H3 gridDisk overlap), the picker is bypassed (single-tap capture).
   * If no match, the picker shows with empty suggestions (IDs are now H3 hex).
   */
  it('should bypass picker when GPS matches an imported ref point (re-observation)', async () => {
    const { getCurrentArPose } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const { getCurrentScenarioHandle } =
      await import('./storage/scenario-storage');
    const {
      handleMarkRefPointForTesting,
      setImportedRefPointsForTesting,
      resetMainState,
      setCurrentScenarioName,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Set up a scenario
    setCurrentScenarioName('TestScenario');

    const mockScenarioHandle = {
      name: 'TestScenario',
    } as FileSystemDirectoryHandle;
    vi.mocked(getCurrentScenarioHandle).mockReturnValue(mockScenarioHandle);

    // Mock AR pose and GPS to pass validation
    vi.mocked(getCurrentArPose).mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    mockState.gpsData = {
      zero: { lat: 49.0, lng: 8.0 },
      gpsEvents: {
        gpsPositions: [
          {
            latitude: 49.0,
            longitude: 8.0,
            altitude: 100,
            timestamp: Date.now(),
          },
        ],
      },
    };

    // Set imported ref point at same GPS position → should trigger re-observation bypass
    setImportedRefPointsForTesting([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'session1.zip',
      },
    ]);

    // Step 5.4: matcher reads from refPoints. Seed the slice with the
    // same anchor (using a real H3-resolution-11 cell id at (49.0, 8.0)).
    const { gpsToH3 } =
      await import('gps-plus-slam-app-framework/geo/h3-proximity');
    const bankH3 = gpsToH3(49.0, 8.0);
    mockState.refPoints = {
      entries: [
        {
          id: bankH3,
          timestamp: Date.now(),
          name: 'Bank',
          rawGpsPoint: {
            id: `gps-${bankH3}`,
            latitude: 49.0,
            longitude: 8.0,
            timestamp: Date.now(),
          },
        },
      ],
    };

    // Call handleMarkRefPoint
    await handleMarkRefPointForTesting();

    // EXPECTED: picker should NOT be shown (re-observation bypass)
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();

    resetMainState();
  });

  /**
   * Why this test matters:
   * When no ref points have been imported and no nearby match exists,
   * the picker should show with empty suggestions (since IDs are now H3 hex
   * strings that are meaningless to users).
   */
  it('should show picker with empty suggestions when no ref points are imported', async () => {
    const { getCurrentArPose } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const { getCurrentScenarioHandle } =
      await import('./storage/scenario-storage');
    const {
      handleMarkRefPointForTesting,
      setImportedRefPointsForTesting,
      resetMainState,
      setCurrentScenarioName,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Set up a scenario
    setCurrentScenarioName('TestScenario');

    // Mock getCurrentScenarioHandle to return a handle
    const mockScenarioHandle = {
      name: 'TestScenario',
    } as FileSystemDirectoryHandle;
    vi.mocked(getCurrentScenarioHandle).mockReturnValue(mockScenarioHandle);

    // Mock AR pose and GPS to pass validation
    vi.mocked(getCurrentArPose).mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    mockState.gpsData = {
      zero: { lat: 49.0, lng: 8.0 },
      gpsEvents: {
        gpsPositions: [
          {
            latitude: 49.0,
            longitude: 8.0,
            altitude: 100,
            timestamp: Date.now(),
          },
        ],
      },
    };

    // No imported ref points (empty array after reset)
    setImportedRefPointsForTesting([]);

    // Call handleMarkRefPoint
    await handleMarkRefPointForTesting();

    // EXPECTED: showRefPointPicker called with empty suggestions (H3 IDs, not user names)
    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0] as string[];

    expect(passedIds).toEqual([]);

    resetMainState();
  });
});

// ============================================================================
// Concurrent handleMarkRefPoint Race Condition (2026-02-27 Issue 2)
// ============================================================================

describe('handleMarkRefPoint concurrent call prevention', () => {
  /**
   * Why this test matters (2026-02-27 user feedback Issue 2 - recurring):
   * Two rapid taps on "Mark Reference Point" can both pass the
   * isRefPointPickerVisible() guard before the picker is shown (async gap
   * during listRefPointIds). The second call overwrites currentResolver,
   * orphaning the first promise and causing the confirm button to require
   * multiple clicks. The synchronous lock (markRefPointInProgress) prevents
   * the second call from entering the async section.
   */
  it('should block concurrent calls via synchronous lock', async () => {
    const { getCurrentArPose } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    const { getCurrentScenarioHandle } =
      await import('./storage/scenario-storage');
    const {
      handleMarkRefPointForTesting,
      setImportedRefPointsForTesting,
      resetMainState,
      setCurrentScenarioName,
    } = await import('./main');

    // Clear any previous state
    resetMainState();
    vi.clearAllMocks();

    // Set up a scenario
    setCurrentScenarioName('TestScenario');

    const mockScenarioHandle = {
      name: 'TestScenario',
    } as FileSystemDirectoryHandle;
    vi.mocked(getCurrentScenarioHandle).mockReturnValue(mockScenarioHandle);

    // Mock AR pose and GPS
    vi.mocked(getCurrentArPose).mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    mockState.gpsData = {
      zero: { lat: 49.0, lng: 8.0 },
      gpsEvents: {
        gpsPositions: [
          {
            latitude: 49.0,
            longitude: 8.0,
            altitude: 100,
            timestamp: Date.now(),
          },
        ],
      },
    };

    setImportedRefPointsForTesting([]);

    // Make showRefPointPicker slow to widen the race window
    let resolveShowPicker!: (
      value: { id: string; isNew: boolean } | null
    ) => void;
    mockShowRefPointPicker.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveShowPicker = resolve;
        })
    );

    // Launch two concurrent calls (simulates rapid double tap)
    const call1 = handleMarkRefPointForTesting();
    const call2 = handleMarkRefPointForTesting();

    // Resolve the first call's showRefPointPicker
    resolveShowPicker({ id: 'point1', isNew: true });

    await call1;
    await call2;

    // showRefPointPicker should only be called ONCE (the second call was blocked)
    expect(mockShowRefPointPicker).toHaveBeenCalledTimes(1);

    resetMainState();
  });
});

// ============================================================================
// Soft Reset Tests (Issue 4 — retain read permission on new recording)
// ============================================================================

describe('resetForNewRecording (soft reset)', () => {
  afterEach(() => {
    resetMainState();
  });

  // Why this test matters: The core purpose of Issue 4 is that clicking
  // "New Recording" performs a soft reset instead of window.location.reload().
  // This test verifies the reset calls the right storage reset functions.
  it('calls resetForNewSession and resetExternalForNewRecording', async () => {
    await resetForNewRecording();

    expect(resetForNewSession).toHaveBeenCalled();
    expect(resetExternalForNewRecording).toHaveBeenCalled();
  });

  // Why this test matters: Bug 7 (SPA audit) — clearSessionRefPointUsage
  // was dispatched to the old store before createNewStore() replaced it,
  // making the dispatch a no-op. The new store starts with clean state by
  // default, so the dispatch was redundant. This test documents that the
  // redundant call was removed.
  it('does not dispatch clearSessionRefPointUsage to old store', async () => {
    // Get the mock store and spy on dispatch
    const { createRecorderStore } = await import('./state/recorder-store');
    const store = createRecorderStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    await resetForNewRecording();

    const clearCalls = dispatchSpy.mock.calls.filter(
      ([action]) =>
        (action as { type?: string })?.type ===
        'refPoints/clearSessionRefPointUsage'
    );
    expect(clearCalls).toHaveLength(0);

    dispatchSpy.mockRestore();
  });

  // Why this test matters: The session summary panel must be hidden so the
  // user sees the setup screen.
  it('hides the session summary panel', async () => {
    await resetForNewRecording();

    expect(hideSessionSummary).toHaveBeenCalled();
  });

  // Why this test matters: When the read folder handle's permission is still
  // granted, the UI should retain the folder-selected state so the user
  // doesn't have to re-select it.
  it('keeps folder selected when read permission is still granted', async () => {
    vi.mocked(hasReadFolderPermission).mockResolvedValue(true);
    vi.mocked(getReadFolderHandle).mockReturnValue({
      name: 'TestFolder',
    } as unknown as FileSystemDirectoryHandle);

    setImportedRefPointsForTesting([
      {
        id: 'bench',
        name: 'bench',
        lat: 50,
        lon: 8,
        sourceZipName: 'session1.zip',
      },
    ]);

    await resetForNewRecording();

    expect(resetUIForNewRecording).toHaveBeenCalledWith({
      keepFolder: true,
    });
    // Imported ref points should be preserved
    expect(getImportedRefPoints()).toHaveLength(1);
  });

  // Why this test matters: When the read folder permission has been revoked
  // (e.g., browser cleared it), the folder-selected state must be cleared
  // and imported ref points discarded.
  it('clears folder selection when read permission is lost', async () => {
    vi.mocked(hasReadFolderPermission).mockResolvedValue(false);

    setImportedRefPointsForTesting([
      {
        id: 'bench',
        name: 'bench',
        lat: 50,
        lon: 8,
        sourceZipName: 'session1.zip',
      },
    ]);

    await resetForNewRecording();

    expect(resetUIForNewRecording).toHaveBeenCalledWith({
      keepFolder: false,
    });
    // Imported ref points should be cleared since folder access is lost
    expect(getImportedRefPoints()).toHaveLength(0);
  });

  // Why this test matters: The session name must be empty so a new name is
  // generated when the next recording starts.
  it('clears session name for next recording', async () => {
    setCurrentScenarioName('TestScenario');

    await resetForNewRecording();

    // resetForNewSession is called which clears session-level state
    expect(resetForNewSession).toHaveBeenCalled();
    // hideSessionSummary is called to dismiss the summary panel
    expect(hideSessionSummary).toHaveBeenCalled();
  });

  // Why this test matters: hasReadFolderPermission errors should not crash
  // the soft reset; treat as "permission lost" and continue.
  // Note: The real hasReadFolderPermission catches errors internally and returns
  // false, but we add a safety catch in resetForNewRecording too.
  it('handles hasReadFolderPermission returning false gracefully', async () => {
    vi.mocked(hasReadFolderPermission).mockResolvedValue(false);

    setImportedRefPointsForTesting([
      {
        id: 'tree',
        name: 'tree',
        lat: 50,
        lon: 8,
        sourceZipName: 'session1.zip',
      },
      {
        id: 'bench',
        name: 'bench',
        lat: 50.1,
        lon: 8.1,
        sourceZipName: 'session2.zip',
      },
    ]);

    await resetForNewRecording();

    // Folder not kept, imported ref points cleared
    expect(resetUIForNewRecording).toHaveBeenCalledWith({
      keepFolder: false,
    });
    expect(getImportedRefPoints()).toHaveLength(0);
    expect(hideSessionSummary).toHaveBeenCalled();
  });

  // Why this test matters: the soft reset used to keep the WebXR session
  // alive ("user returns to AR_READY"), but the setup screen it lands on
  // requires pressing Enter AR again, and initAR() throws on a live session
  // (re-entry guard, framework commit 8a4a2d2) — so the first Enter AR after
  // a soft reset surfaced an error toast and needed a second press. The reset
  // must end the session so the next Enter AR initializes cleanly. F3's
  // session-end callback fires with requestedByApp: true here, which the
  // system-session-end handler ignores — no double navigation or toast.
  // See docs/2026-07-04-2319-soft-reset-end-ar-session-plan.md (GpsPlusSlamJs_Docs).
  it('ends the AR session so the next Enter AR starts clean', async () => {
    const { endARSession } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    vi.mocked(endARSession).mockClear();

    await resetForNewRecording();

    expect(endARSession).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: ending the session is best-effort — a rejected
  // XRSession.end() (already-ended session, teardown race) must not abort
  // the rest of the soft reset, or the user would be stranded on a
  // half-reset screen. The framework's endARSession() already guarantees
  // clean module state on rejection; the app just logs and continues.
  it('completes the soft reset even when endARSession rejects', async () => {
    const { endARSession } =
      await import('gps-plus-slam-app-framework/ar/webxr-session');
    vi.mocked(endARSession).mockClear();
    vi.mocked(endARSession).mockRejectedValueOnce(new Error('already ended'));
    vi.mocked(resetUIForNewRecording).mockClear();

    await expect(resetForNewRecording()).resolves.toBeUndefined();

    expect(endARSession).toHaveBeenCalledTimes(1);
    // The reset still reaches the UI stage after the failed session end.
    expect(resetUIForNewRecording).toHaveBeenCalled();
  });
});

// ============================================================================
// Extracted Helper Tests — loadAndDisplayRefPoints
// ============================================================================

describe('loadAndDisplayRefPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Why this test matters:
   * loadAndDisplayRefPoints extracts the duplicated load→flatten→display
   * pattern used in both loadPriorReferencePoints and handleScenarioChange.
   * Verifying it calls the right pipeline prevents regressions if either
   * call site is changed independently.
   */
  it('should load, flatten, and display ref points from a scenario handle', async () => {
    const { loadAllRefPoints, flattenRefPointsToMarks } =
      await import('./storage/ref-point-loader');

    const mockHandle = { name: 'TestScenario' } as FileSystemDirectoryHandle;
    const mockDefs = [{ id: 'pt-A' }, { id: 'pt-B' }];
    const mockMarks = [{ id: 'pt-A' }, { id: 'pt-B' }, { id: 'pt-A-obs2' }];

    vi.mocked(loadAllRefPoints).mockResolvedValue(mockDefs as never);
    vi.mocked(flattenRefPointsToMarks).mockReturnValue(mockMarks as never);
    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');

    const result = await loadAndDisplayRefPoints(mockHandle);

    expect(loadAllRefPoints).toHaveBeenCalledWith(mockHandle);
    expect(flattenRefPointsToMarks).toHaveBeenCalledWith(mockDefs);
    // 5.7a-3 Option C: visualizer is driven by `refPoints` (see
    // ref-point-subscribers Step 5.3). The call site dispatches the
    // averaged sidecar entries instead of the legacy prior-marks action.
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refPoints/setImportedRefPointEntries',
      })
    );
    expect(result).toEqual({ refPointCount: 2, observationCount: 3 });
  });

  /**
   * Why this test matters:
   * When a scenario has no ref points, the helper should return zeros
   * and still dispatch the V2 sidecar-import action (with []) so the
   * visualizer subscription clears any previously rendered markers.
   */
  it('should return zero counts for empty scenario', async () => {
    const { loadAllRefPoints, flattenRefPointsToMarks } =
      await import('./storage/ref-point-loader');

    const mockHandle = { name: 'EmptyScenario' } as FileSystemDirectoryHandle;

    vi.mocked(loadAllRefPoints).mockResolvedValue([]);
    vi.mocked(flattenRefPointsToMarks).mockReturnValue([]);
    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');

    const result = await loadAndDisplayRefPoints(mockHandle);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refPoints/setImportedRefPointEntries',
        payload: [],
      })
    );
    expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
  });
});

// ============================================================================
// handleClearRefPointCache — settings-modal "Clear Reference Point Cache"
// ============================================================================
//
// Why these tests matter:
// handleClearRefPointCache has three branches that each touch user-visible
// state (in-memory imported ref points, toast/error UI). A regression in any
// one of them silently leaves stale ref-point data in proximity checks. The
// failure-path test specifically pins down a bug fix: when the re-import
// after cache clear throws, the in-memory imported ref points must be
// cleared so future proximity checks don't see stale entries.

describe('handleClearRefPointCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMainState();
  });

  /**
   * Why this test matters (regression pin):
   * Previously the inner catch only logged the warning, so a failed re-import
   * left the previously-imported ref points in memory. Subsequent proximity
   * checks then matched against stale entries that no longer existed in the
   * (now cleared) OPFS cache. The catch must also dispatch
   * `setImportedRefPoints([])`.
   */
  it('clears stale imported ref points when re-import after cache clear fails', async () => {
    const { handleClearRefPointCache } = await import('./main');
    const { getCurrentScenarioHandle, clearRefPointsCacheForAllScenarios } =
      await import('./storage/scenario-storage');
    const { loadAllRefPoints } = await import('./storage/ref-point-loader');

    setImportedRefPointsForTesting([
      {
        id: 'stale-pt',
        lat: 0,
        lon: 0,
        sourceZipName: 'old.zip',
      },
    ]);

    const mockHandle = { name: 'TestScenario' } as FileSystemDirectoryHandle;
    vi.mocked(getCurrentScenarioHandle).mockReturnValue(mockHandle);
    vi.mocked(clearRefPointsCacheForAllScenarios).mockResolvedValue({
      scenariosCleared: 1,
      scenariosScanned: 1,
      errors: [],
    });
    vi.mocked(loadAllRefPoints).mockRejectedValue(
      new Error('disk read failed')
    );

    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');

    await handleClearRefPointCache();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refPoints/setImportedRefPointEntries',
        payload: [],
      })
    );
  });

  /**
   * Why this test matters:
   * When no scenario is currently selected the handler must still clear the
   * in-memory imported ref points unconditionally — otherwise stale entries
   * imported earlier in the session would remain after the OPFS cache wipe.
   */
  it('clears in-memory imported ref points when no scenario is currently selected', async () => {
    const { handleClearRefPointCache } = await import('./main');
    const { getCurrentScenarioHandle, clearRefPointsCacheForAllScenarios } =
      await import('./storage/scenario-storage');

    setImportedRefPointsForTesting([
      {
        id: 'stale-pt',
        lat: 0,
        lon: 0,
        sourceZipName: 'old.zip',
      },
    ]);

    vi.mocked(getCurrentScenarioHandle).mockReturnValue(null);
    vi.mocked(clearRefPointsCacheForAllScenarios).mockResolvedValue({
      scenariosCleared: 0,
      scenariosScanned: 0,
      errors: [],
    });

    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');

    await handleClearRefPointCache();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refPoints/setImportedRefPointEntries',
        payload: [],
      })
    );
  });

  /**
   * Why this test matters:
   * If the cache-clear operation itself rejects, the user must be informed
   * via the existing error channel rather than silently swallowing the
   * failure. Pins down the outer catch path.
   */
  it('shows an error when the cache-clear operation itself fails', async () => {
    const { handleClearRefPointCache } = await import('./main');
    const { clearRefPointsCacheForAllScenarios } =
      await import('./storage/scenario-storage');
    const { showError } = await import('./ui/hud');

    vi.mocked(clearRefPointsCacheForAllScenarios).mockRejectedValue(
      new Error('OPFS unavailable')
    );

    await handleClearRefPointCache();

    expect(showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear ref-point cache')
    );
  });

  /**
   * Why this test matters:
   * Happy path — when an active scenario exists and the re-import succeeds,
   * the cleared cache must be repopulated by dispatching
   * `setPriorRefPointMarks` (via folderManager.loadAndDisplayRefPoints) so
   * the visualizer reflects the post-clear state immediately.
   */
  it('re-imports ref points for the active scenario after a successful clear', async () => {
    const { handleClearRefPointCache } = await import('./main');
    const { getCurrentScenarioHandle, clearRefPointsCacheForAllScenarios } =
      await import('./storage/scenario-storage');
    const { loadAllRefPoints, flattenRefPointsToMarks } =
      await import('./storage/ref-point-loader');

    const mockHandle = { name: 'TestScenario' } as FileSystemDirectoryHandle;
    vi.mocked(getCurrentScenarioHandle).mockReturnValue(mockHandle);
    vi.mocked(clearRefPointsCacheForAllScenarios).mockResolvedValue({
      scenariosCleared: 2,
      scenariosScanned: 2,
      errors: [],
    });
    vi.mocked(loadAllRefPoints).mockResolvedValue([{ id: 'pt-A' } as never]);
    vi.mocked(flattenRefPointsToMarks).mockReturnValue([
      { id: 'pt-A' } as never,
    ]);

    const dispatchSpy = vi.spyOn(mockStore, 'dispatch');

    await handleClearRefPointCache();

    expect(loadAllRefPoints).toHaveBeenCalledWith(mockHandle);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'refPoints/setImportedRefPointEntries',
      })
    );
  });
});

// ============================================================================
// GPS Warm-up Tests (Issue 4, 2026-02-27 user feedback)
// ============================================================================

describe('GPS warm-up after permission grant (Issue 4)', () => {
  /**
   * Why this test matters:
   * GPS hardware needs time to acquire satellite fixes. Starting
   * watchPosition only when the user taps "Start Recording" means a
   * 5-15s cold-start delay. Starting it as soon as geolocation permission
   * is confirmed gives the GPS maximum warm-up time.
   */
  it('should start GPS warm-up watch after permissions are granted', async () => {
    const { startGpsWatch } =
      await import('gps-plus-slam-app-framework/sensors/gps');
    const { requestAllPermissions } =
      await import('gps-plus-slam-app-framework/sensors/permission-checker');
    const { handleRequestPermissionsForTesting, resetMainState } =
      await import('./main');

    resetMainState();
    vi.clearAllMocks();

    // Mock permissions returning all mandatory granted
    vi.mocked(requestAllPermissions).mockResolvedValue({
      allMandatoryReady: true,
      geolocation: { granted: true, supported: true },
      camera: { granted: true, supported: true },
      webxr: { granted: true, supported: true },
      orientation: { granted: true, supported: true },
      fileSystem: { granted: true, supported: true },
    });

    await handleRequestPermissionsForTesting();

    // EXPECTED: startGpsWatch should be called for warm-up
    expect(startGpsWatch).toHaveBeenCalled();

    resetMainState();
  });

  /**
   * Why this test matters:
   * When geolocation permission is denied, GPS warm-up should NOT start
   * (it would trigger a browser permission error).
   */
  it('should NOT start GPS warm-up when geolocation is denied', async () => {
    const { startGpsWatch } =
      await import('gps-plus-slam-app-framework/sensors/gps');
    const { requestAllPermissions } =
      await import('gps-plus-slam-app-framework/sensors/permission-checker');
    const { handleRequestPermissionsForTesting, resetMainState } =
      await import('./main');

    resetMainState();
    vi.clearAllMocks();

    // Mock permissions with geolocation denied
    vi.mocked(requestAllPermissions).mockResolvedValue({
      allMandatoryReady: false,
      geolocation: { granted: false, supported: true },
      camera: { granted: true, supported: true },
      webxr: { granted: true, supported: true },
      orientation: { granted: true, supported: true },
      fileSystem: { granted: true, supported: true },
    });

    await handleRequestPermissionsForTesting();

    // EXPECTED: startGpsWatch should NOT be called
    expect(startGpsWatch).not.toHaveBeenCalled();

    resetMainState();
  });
});

// ============================================================================
// Extracted Helper Tests — collectTrackerErrors
// ============================================================================

describe('collectTrackerErrors', () => {
  /**
   * Why this test matters:
   * collectTrackerErrors extracts the duplicated pattern from
   * handleStopRecording that collects failure counts from write/capture
   * trackers and appends human-readable error messages. Verifying the helper
   * ensures consistent error reporting across tracker types.
   */
  it('should collect errors and reset tracker when failures exist', async () => {
    const { collectTrackerErrors } = await import('./main');

    const mockTracker = {
      getFailureCount: vi.fn().mockReturnValue(5),
      reset: vi.fn(),
    };
    const errors: string[] = [];

    collectTrackerErrors(mockTracker, 'image write failures', errors);

    expect(errors).toEqual(['5 image write failures']);
    expect(mockTracker.reset).toHaveBeenCalled();
  });

  /**
   * Why this test matters:
   * When a tracker has zero failures, no error string should be pushed.
   * The tracker should still be reset (cleanup).
   */
  it('should reset tracker but not add errors when failure count is zero', async () => {
    const { collectTrackerErrors } = await import('./main');

    const mockTracker = {
      getFailureCount: vi.fn().mockReturnValue(0),
      reset: vi.fn(),
    };
    const errors: string[] = [];

    collectTrackerErrors(mockTracker, 'image capture failures', errors);

    expect(errors).toHaveLength(0);
    expect(mockTracker.reset).toHaveBeenCalled();
  });

  /**
   * Why this test matters:
   * When tracker is null (not initialized), the function should be a no-op.
   * This matches the existing if-guard pattern.
   */
  it('should be a no-op when tracker is null', async () => {
    const { collectTrackerErrors } = await import('./main');

    const errors: string[] = [];

    collectTrackerErrors(null, 'image write failures', errors);

    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// handleOpenFolder — recording mode scenario dropdown (Issue 1, 2026-02-27)
// ============================================================================

describe('handleOpenFolder — recording mode scenario dropdown', () => {
  // Why this test suite matters:
  // Issue 1 from 2026-02-27 user feedback: when the user selects a folder with
  // existing zip files in recording mode, the scenario dropdown (#scenario-select)
  // must be populated with scenario names from that folder, merged with any OPFS
  // scenarios. Before this fix, recording mode only imported ref points and never
  // populated the dropdown from the folder.

  const mockFolderHandle = {
    kind: 'directory',
    name: 'TestFolder',
  } as unknown as FileSystemDirectoryHandle;

  beforeEach(() => {
    resetMainState();
    vi.clearAllMocks();

    // Configure selectReadFolder to succeed
    vi.mocked(selectReadFolder).mockResolvedValue({
      success: true,
      folderName: 'TestFolder',
    } as never);

    // Configure getReadFolderHandle to return a mock handle
    vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

    // Default: no scenarios from folder
    vi.mocked(listScenariosFromFolder).mockResolvedValue([]);
    vi.mocked(extractScenarioNamesFromZips).mockResolvedValue([]);

    // Ensure folder-status element exists for status update assertions
    if (!document.getElementById('folder-status')) {
      const el = document.createElement('div');
      el.id = 'folder-status';
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    resetMainState();
    setCachedOpfsScenariosForTesting([]);
  });

  it('should call listScenariosFromFolder with the folder handle', async () => {
    // Why: The recording-mode branch must scan for scenario subdirectories
    // (previously only done in replay mode).
    await handleOpenFolderForTesting();

    expect(listScenariosFromFolder).toHaveBeenCalledWith(mockFolderHandle);
  });

  it('should call extractScenarioNamesFromZips with the folder handle', async () => {
    // Why: Top-level ZIPs with scenario prefixes in their filename must also
    // contribute scenario names to the dropdown.
    await handleOpenFolderForTesting();

    expect(extractScenarioNamesFromZips).toHaveBeenCalledWith(mockFolderHandle);
  });

  it('should populate scenarios dropdown with folder scenarios', async () => {
    // Why: Found scenario directories must appear in the recording-mode
    // scenario dropdown so the user can select them.
    vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris', 'Munich']);

    await handleOpenFolderForTesting();

    expect(populateScenarios).toHaveBeenCalledWith(
      expect.arrayContaining(['Paris', 'Munich'])
    );
  });

  it('should merge OPFS and folder scenarios, deduplicating and sorting', async () => {
    // Why: The dropdown must show a unified view of scenarios from both OPFS
    // (previous in-browser recordings) and the selected folder, without
    // duplicates. Alphabetical sorting ensures predictable dropdown order.
    setCachedOpfsScenariosForTesting(['Paris', 'Berlin']);
    vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris', 'Munich']);
    vi.mocked(extractScenarioNamesFromZips).mockResolvedValue(['Tokyo']);

    await handleOpenFolderForTesting();

    expect(populateScenarios).toHaveBeenCalledWith([
      'Berlin',
      'Munich',
      'Paris',
      'Tokyo',
    ]);
  });

  it('should include scenario names extracted from top-level ZIP files', async () => {
    // Why: Users may store ZIPs at the root level with scenario prefixes
    // (e.g., "Paris-session-2026-01-30_14-30-45utc.zip"). These must
    // be reflected in the dropdown.
    vi.mocked(listScenariosFromFolder).mockResolvedValue([]);
    vi.mocked(extractScenarioNamesFromZips).mockResolvedValue([
      'ScenarioFromZip',
    ]);

    await handleOpenFolderForTesting();

    expect(populateScenarios).toHaveBeenCalledWith(['ScenarioFromZip']);
  });

  it('should NOT call importRefPointsFromFolder (ref point import is scenario-scoped)', async () => {
    // Why: Cross-scenario ZIP scan was removed; ref points are loaded
    // per-scenario in loadAndDisplayRefPoints at scenario-selection time.
    await handleOpenFolderForTesting();

    expect(importRefPointsFromFolder).not.toHaveBeenCalled();
  });

  it('should update folder status with scenario count', async () => {
    // Why: User needs feedback on what was found in the folder.
    vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris', 'Munich']);

    await handleOpenFolderForTesting();

    const lastCall = vi.mocked(updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
    expect(lastCall).toContain('2 scenario');
  });
});
// =============================================================================
// Issue 5: Back Button During Recording (2026-02-27 user feedback)
// =============================================================================

describe('handleBackDuringRecording (Issue 5)', () => {
  beforeEach(() => {
    resetMainState();
    vi.mocked(showConfirmDialog).mockReset();
    vi.mocked(pushScreenState).mockReset();
  });

  afterEach(() => {
    resetMainState();
  });

  it('should show confirm dialog when back is pressed during recording', async () => {
    // Why: User needs a way to stop recording via back button, but it must
    // be behind a confirmation to prevent accidental data loss.
    vi.mocked(showConfirmDialog).mockResolvedValue(false);

    await handleBackDuringRecordingForTesting();

    expect(showConfirmDialog).toHaveBeenCalledExactlyOnceWith({
      message: 'Stop recording and go back?',
      confirmLabel: 'Stop recording',
      cancelLabel: 'Keep recording',
    });
  });

  it('should re-push recording state when user cancels', async () => {
    // Why: If user cancels, the history state that was popped by the browser
    // back button must be restored so the app stays on the recording screen.
    vi.mocked(showConfirmDialog).mockResolvedValue(false);

    await handleBackDuringRecordingForTesting();

    expect(pushScreenState).toHaveBeenCalledWith('recording');
  });

  it('should stop recording when user confirms', async () => {
    // Why: User wants to stop — handleStopRecording runs the normal
    // stop flow (summary screen etc.).
    vi.mocked(showConfirmDialog).mockResolvedValue(true);

    await handleBackDuringRecordingForTesting();

    // handleStopRecording calls disableBeforeUnloadWarning as its first action
    const { disableBeforeUnloadWarning } = await import('./ui/navigation');
    expect(disableBeforeUnloadWarning).toHaveBeenCalled();
  });

  it('should block concurrent calls via synchronous lock (rapid-press guard)', async () => {
    // Why: Multiple rapid back presses must not spawn multiple dialogs.
    // The synchronous flag blocks the second call before any async work.
    let resolveFirst: (value: boolean) => void;
    const firstPromise = new Promise<boolean>((r) => {
      resolveFirst = r;
    });
    vi.mocked(showConfirmDialog).mockReturnValueOnce(firstPromise);

    // Fire first call (will be blocked on the dialog)
    const call1 = handleBackDuringRecordingForTesting();

    // Fire second call immediately (should be blocked by lock)
    vi.mocked(showConfirmDialog).mockResolvedValueOnce(false);
    const call2 = handleBackDuringRecordingForTesting();

    // Second call should have re-pushed recording state (guard path)
    await call2;
    expect(pushScreenState).toHaveBeenCalledWith('recording');

    // Only one dialog should have been shown
    expect(showConfirmDialog).toHaveBeenCalledOnce();

    // Resolve first dialog to clean up
    resolveFirst!(false);
    await call1;
  });

  it('should re-push recording state on error', async () => {
    // Why: If the dialog or stop recording throws, the user must not
    // lose their navigation state. Re-pushing prevents navigation loss.
    vi.mocked(showConfirmDialog).mockRejectedValue(new Error('Dialog failed'));

    await handleBackDuringRecordingForTesting();

    expect(pushScreenState).toHaveBeenCalledWith('recording');
  });

  it('should reset lock after completion (allows subsequent calls)', async () => {
    // Why: After the first back-during-recording flow completes,
    // a subsequent back press must work normally (not be blocked forever).
    vi.mocked(showConfirmDialog).mockResolvedValue(false);

    await handleBackDuringRecordingForTesting();
    await handleBackDuringRecordingForTesting();

    // Both calls should have shown the dialog
    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// handleOpenFolder — replay mode zip discovery (Issue 1, 2026-03-01)
// ============================================================================

describe('handleOpenFolder — replay mode zip discovery', () => {
  // Why this test suite matters:
  // Issue 1 from 2026-03-01 user feedback: when the user opens a folder in
  // replay mode, root-level zip files must be discovered via session.json
  // metadata. Before this fix, replay mode only looked for subdirectories.

  const mockFolderHandle = {
    kind: 'directory',
    name: 'TestFolder',
  } as unknown as FileSystemDirectoryHandle;

  beforeEach(() => {
    resetMainState();
    setReplayModeForTesting(true);
    vi.clearAllMocks();

    vi.mocked(selectReadFolder).mockResolvedValue({
      success: true,
      folderName: 'TestFolder',
    } as never);
    vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    vi.mocked(listScenariosFromFolder).mockResolvedValue([]);
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map(),
      scenarioNames: [],
    });

    if (!document.getElementById('folder-status')) {
      const el = document.createElement('div');
      el.id = 'folder-status';
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    resetMainState();
  });

  it('should call discoverScenariosFromZipMetadata in replay mode', async () => {
    // Why: Replay mode must now discover scenarios from zip metadata,
    // not just from subdirectories.
    await handleOpenFolderForTesting();

    expect(discoverScenariosFromZipMetadata).toHaveBeenCalledWith(
      mockFolderHandle
    );
  });

  it('should merge directory scenarios with zip metadata scenarios', async () => {
    // Why: Both discovery mechanisms must contribute — a folder may have
    // subdirectory-based scenarios AND root-level zips with metadata.
    vi.mocked(listScenariosFromFolder).mockResolvedValue(['DirScenario']);
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map([
        [
          'ZipScenario',
          [
            {
              filename: 'rec.zip',
              fileHandle: {} as FileSystemFileHandle,
              date: null,
            },
          ],
        ],
      ]),
      scenarioNames: ['ZipScenario'],
    });

    await handleOpenFolderForTesting();

    // The status should reflect total scenarios found
    const lastCall = vi.mocked(updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
    expect(lastCall).toContain('2 scenario');
  });

  it('should deduplicate scenarios present in both directories and zip metadata', async () => {
    // Why: A scenario may exist as both a subdirectory and in zip metadata.
    // The merged list must not have duplicates.
    vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris']);
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map([
        [
          'Paris',
          [
            {
              filename: 'rec.zip',
              fileHandle: {} as FileSystemFileHandle,
              date: null,
            },
          ],
        ],
      ]),
      scenarioNames: ['Paris'],
    });

    await handleOpenFolderForTesting();

    const lastCall = vi.mocked(updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
    // Only 1 unique scenario after deduplication
    expect(lastCall).toContain('1 scenario');
  });

  it('should still call listScenariosFromFolder for subdirectory scenarios', async () => {
    // Why: Existing subdirectory-based discovery must not be removed.
    await handleOpenFolderForTesting();

    expect(listScenariosFromFolder).toHaveBeenCalledWith(mockFolderHandle);
  });
});

// ============================================================================
// handleReplayScenarioChange — merged scenario sources (Issue 1, 2026-03-01)
// ============================================================================

describe('handleReplayScenarioChange — zip metadata cache', () => {
  // Why this test suite matters:
  // After zip metadata discovery populates the cache, selecting a scenario
  // that came from zip metadata (not a subdirectory) must serve sessions
  // from the cache instead of trying getDirectoryHandle (which would throw).

  const mockFolderHandle = {
    kind: 'directory',
    name: 'TestFolder',
    getDirectoryHandle: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;

  const mockSessionEntry = {
    filename: '2026-03-01_09-08-48utc.zip',
    fileHandle: {
      kind: 'file',
      name: '2026-03-01_09-08-48utc.zip',
    } as unknown as FileSystemFileHandle,
    date: new Date('2026-03-01T09:08:48Z'),
  };

  beforeEach(() => {
    resetMainState();
    setReplayModeForTesting(true);
    vi.clearAllMocks();

    vi.mocked(selectReadFolder).mockResolvedValue({
      success: true,
      folderName: 'TestFolder',
    } as never);
    vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    vi.mocked(listScenariosFromFolder).mockResolvedValue([]);
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([]);

    if (!document.getElementById('folder-status')) {
      const el = document.createElement('div');
      el.id = 'folder-status';
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    resetMainState();
  });

  it('should serve sessions from cache for metadata-discovered scenarios', async () => {
    // Why: If a scenario was discovered from zip metadata (no subdirectory),
    // handleReplayScenarioChange must use the cached sessions, not fail.
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map([['ParkWalk', [mockSessionEntry]]]),
      scenarioNames: ['ParkWalk'],
    });

    // First: open folder to populate cache
    await handleOpenFolderForTesting();

    // getDirectoryHandle will throw (no such subdirectory)
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

    // Second: select the scenario
    await handleReplayScenarioChangeForTesting('ParkWalk');

    // Should serve the cached session, not an empty list
    const sessions = getReplaySessionEntriesForTesting();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].filename).toBe('2026-03-01_09-08-48utc.zip');
  });

  it('should not crash when directory lookup fails for metadata-only scenario', async () => {
    // Why: The existing code does getDirectoryHandle(scenarioName) which
    // throws DOMException if no subdirectory exists. The fix must handle this.
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map([['MetadataOnly', [mockSessionEntry]]]),
      scenarioNames: ['MetadataOnly'],
    });

    await handleOpenFolderForTesting();

    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

    // This should not throw
    await expect(
      handleReplayScenarioChangeForTesting('MetadataOnly')
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// handleRefPointIndexingSettled — terminal outcome of the eager folder-import
// indexing pass (D2/D3, 2026-07-05 plan Slice 4).
//
// Why these tests matter: the pass runs in the background and the user may
// have entered AR before it settles — the toast (mounted in the #app overlay,
// visible inside AR) is the only completion signal there, while the progress
// bar's durable end state serves the start screen. Failure/abort must reset
// the bar (failure additionally surfaces an error toast); a no-op pass stays
// quiet (no toast spam when every store was already up to date).
// ============================================================================

describe('handleRefPointIndexingSettled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drives the durable bar end state and announces recovered points via toast', () => {
    handleRefPointIndexingSettled({
      status: 'success',
      refPointsWritten: 5,
      zipFilesScanned: 3,
      zipFilesTotal: 3,
      errors: [],
    });

    expect(setFolderImportProgress).toHaveBeenCalledWith({
      kind: 'done',
      refPointsWritten: 5,
      zipFilesTotal: 3,
    });
    expect(showToast).toHaveBeenCalledWith(
      'Recovered 5 reference points from 3 recordings',
      { severity: 'info' }
    );
  });

  it('uses singular copy for one point from one recording', () => {
    handleRefPointIndexingSettled({
      status: 'success',
      refPointsWritten: 1,
      zipFilesScanned: 1,
      zipFilesTotal: 1,
      errors: [],
    });

    expect(showToast).toHaveBeenCalledWith(
      'Recovered 1 reference point from 1 recording',
      { severity: 'info' }
    );
  });

  it('stays quiet (end state only, no toast) when nothing was written', () => {
    handleRefPointIndexingSettled({
      status: 'success',
      refPointsWritten: 0,
      zipFilesScanned: 4,
      zipFilesTotal: 4,
      errors: [],
    });

    expect(setFolderImportProgress).toHaveBeenCalledWith({
      kind: 'done',
      refPointsWritten: 0,
      zipFilesTotal: 4,
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('resets the bar and raises an error toast on failure', () => {
    handleRefPointIndexingSettled({ status: 'error', message: 'boom' });

    expect(setFolderImportProgress).toHaveBeenCalledWith(null);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      expect.objectContaining({ severity: 'error' })
    );
  });

  it('resets the bar silently on abort', () => {
    handleRefPointIndexingSettled({ status: 'aborted' });

    expect(setFolderImportProgress).toHaveBeenCalledWith(null);
    expect(showToast).not.toHaveBeenCalled();
  });
});
