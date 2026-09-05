/**
 * The module stubs every `main.*-wiring.test.ts` suite needs and none of
 * them asserts on: the 22 `vi.mock` statements that were
 * byte-identical across all seven suites until 2026-09-04 (~130 lines each,
 * copied whenever a new wiring suite was started - the copy pattern this
 * file exists to stop). Everything a suite DOES assert on (the hoisted spies
 * for webxr-session, the store, recording-options, ...) stays in that suite.
 *
 * HOW IT WORKS. `vi.mock` is hoisted to the top of the module it is written
 * in and registers against the RESOLVED path, so a mock declared here for
 * `'../ui/hud'` intercepts a suite's `'./ui/hud'` import as long as this
 * module has been evaluated before the suite imports `./main`. That is the
 * one rule for consumers:
 *
 *   import './test-utils/main-module-stubs'; // FIRST, before ./main
 *
 * A suite that needs a different shape for one of these modules simply
 * declares its own `vi.mock` for that path - the suite's own hoisted call
 * runs after this module's and wins.
 *
 * Test-only. See main-module-stubs.ts.md.
 */
import { vi } from 'vitest';

vi.mock('../utils/sentry', () => ({ initSentry: vi.fn() }));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../ui/ref-point-view-wiring', () => ({
  wireRefPointViews: vi.fn(() => ({
    refreshMapMarkers: vi.fn(),
    unsubscribe: vi.fn(),
  })),
}));

vi.mock('../ui/session-summary', () => ({
  initSessionSummary: vi.fn(),
  showSessionSummary: vi.fn(),
  hideSessionSummary: vi.fn(),
}));

vi.mock('../ui/log-panel', () => ({
  initLogPanel: vi.fn(),
  showLogPanel: vi.fn(),
  hideLogPanel: vi.fn(),
  toggleLogPanel: vi.fn(),
}));

vi.mock('../ui/ref-point-picker', () => ({
  showRefPointPicker: vi.fn(),
  createRefPointPickerHtml: vi.fn().mockReturnValue(''),
  isRefPointPickerVisible: vi.fn(),
  cancelRefPointPicker: vi.fn(),
}));

vi.mock('../ui/navigation', () => ({
  initNavigation: vi.fn(),
  getCurrentScreen: vi.fn(() => 'setup'),
  enableBeforeUnloadWarning: vi.fn(),
  disableBeforeUnloadWarning: vi.fn(),
  pushScreenState: vi.fn(),
  replaceScreenState: vi.fn(),
}));

vi.mock('../ui/settings-modal', () => ({
  initSettingsModal: vi.fn(),
}));

vi.mock('../ui/replay-ui', () => ({
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

vi.mock('../storage/recording-discovery', () => ({
  listScenariosFromFolder: vi.fn(),
  extractScenarioNamesFromZips: vi.fn(),
  discoverScenariosFromZipMetadata: vi.fn(),
  listSessionZipsInScenario: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/ar/xr-error-handler', () => ({
  getXrErrorMessage: vi.fn(),
}));

vi.mock('../storage/external-file-storage', () => ({
  isExternalStorageSupported: vi.fn().mockReturnValue(true),
  selectReadFolder: vi.fn(),
  selectSaveFile: vi.fn(),
  getSaveFileHandle: vi.fn(),
  getReadFolderHandle: vi.fn(),
  resetForNewRecording: vi.fn(),
  hasReadFolderPermission: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/storage/zip-export', () => ({
  syncToExternalZip: vi.fn(),
}));

vi.mock('../storage/ref-point-loader', () => ({
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

vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('gps-plus-slam-app-framework/storage/null-storage-backend', () => ({
  NullStorageBackend: vi.fn(),
}));

vi.mock('../storage/write-failure-tracker', () => ({
  createWriteFailureTracker: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/ar/capture-failure-tracker', () => ({
  createCaptureFailureTracker: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework', () => ({
  selectTrackingQuality: vi.fn().mockReturnValue(null),
}));
