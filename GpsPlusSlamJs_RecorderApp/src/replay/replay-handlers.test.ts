/**
 * Replay Handlers Tests
 *
 * Why these tests matter:
 * The replay handlers module encapsulates all replay-mode state and
 * event handlers extracted from main.ts (Finding #7 decomposition).
 * These tests verify each handler's behavior in isolation, ensuring
 * the extraction preserves the exact same behavior as the original.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReplayModeController } from './replay-mode';
import type {
  SessionEntry,
  ScenarioSessionMap,
} from '../storage/recording-discovery';
import type { RecorderStore } from '../state/recorder-store';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const { mockStartReplayMode, mockReplayController, mockReplayStore } =
  vi.hoisted(() => {
    const mockReplayStore = {
      getState: vi.fn().mockReturnValue({}),
      subscribe: vi.fn().mockReturnValue(() => {}),
      dispatch: vi.fn(),
      replaceReducer: vi.fn(),
      writeFrame: vi.fn(),
      writeSessionMetadata: vi.fn(),
    } as unknown as RecorderStore;

    const mockReplayController: ReplayModeController = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn().mockResolvedValue(undefined),
      setSpeed: vi.fn(),
      getState: vi.fn().mockReturnValue('idle' as const),
      getEngine: vi.fn(),
      getStore: vi.fn().mockReturnValue(mockReplayStore),
      getActionCount: vi.fn().mockReturnValue(42),
      setMapOverlay: vi.fn(),
      dispose: vi.fn(),
    };

    const mockStartReplayMode = vi.fn().mockResolvedValue(mockReplayController);

    return { mockStartReplayMode, mockReplayController, mockReplayStore };
  });

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('./replay-mode', () => ({
  startReplayMode: mockStartReplayMode,
}));

vi.mock('../storage/external-file-storage', () => ({
  getReadFolderHandle: vi.fn().mockReturnValue(null),
}));

vi.mock('../storage/recording-discovery', () => ({
  listSessionZipsInScenario: vi.fn().mockResolvedValue([]),
  discoverScenariosFromZipMetadata: vi.fn().mockResolvedValue({
    scenarioSessions: new Map(),
    scenarioNames: [],
  }),
}));

vi.mock('../ui/replay-ui', () => ({
  populateReplaySessions: vi.fn(),
  updateReplayProgress: vi.fn(),
  showReplayControls: vi.fn(),
  updatePlayPauseButton: vi.fn(),
  updateCameraModeButton: vi.fn(),
}));

vi.mock('../ui/hud', () => ({
  showError: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../ui/toast', () => ({
  showToast: vi.fn(),
  TOAST_DURATION_ERROR: 8000,
}));

const { mockMapOverlay, MockMapOverlayConstructor } = vi.hoisted(() => {
  const overlay = {
    toggle: vi.fn(),
    setGpsPosition: vi.fn(),
    isVisible: vi.fn().mockReturnValue(false),
    getGpsPosition: vi.fn().mockReturnValue(null),
    dispose: vi.fn(),
  };
  // Use a class so `new MapOverlay(...)` works in the production code
  class MockMapOverlay {
    toggle = overlay.toggle;
    setGpsPosition = overlay.setGpsPosition;
    isVisible = overlay.isVisible;
    getGpsPosition = overlay.getGpsPosition;
    dispose = overlay.dispose;
    constructor(..._args: unknown[]) {
      MockMapOverlay._constructorSpy(..._args);
    }
    static _constructorSpy = vi.fn();
  }
  return { mockMapOverlay: overlay, MockMapOverlayConstructor: MockMapOverlay };
});

vi.mock(
  'gps-plus-slam-app-framework/visualization/leaflet-map-overlay',
  () => ({
    LeafletMapOverlay: MockMapOverlayConstructor,
  })
);

const {
  mockCreatePreviewMap,
  mockPreviewMapInstance,
  mockLoadGpsPathFromBlob,
} = vi.hoisted(() => {
  const instance = { destroy: vi.fn() };
  return {
    mockCreatePreviewMap: vi.fn().mockReturnValue(instance),
    mockPreviewMapInstance: instance,
    mockLoadGpsPathFromBlob: vi.fn().mockResolvedValue([{ lat: 50, lng: 8 }]),
  };
});

vi.mock('../ui/preview-map', () => ({
  createPreviewMap: mockCreatePreviewMap,
}));

vi.mock('gps-plus-slam-app-framework/storage/zip-reader', () => ({
  loadGpsPathFromBlob: mockLoadGpsPathFromBlob,
}));

vi.mock('gps-plus-slam-app-framework/ar/replay-scene', () => ({
  toggleCameraMode: vi.fn(),
  getCameraMode: vi.fn().mockReturnValue('orbit'),
  getCameraFollower: vi.fn().mockReturnValue(null),
  getReplayState: vi.fn().mockReturnValue(null),
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { createReplayHandlers, type ReplayHandlers } from './replay-handlers';
import { getReadFolderHandle } from '../storage/external-file-storage';
import { listSessionZipsInScenario } from '../storage/recording-discovery';
import {
  populateReplaySessions,
  showReplayControls,
  updatePlayPauseButton,
  updateCameraModeButton,
} from '../ui/replay-ui';
import { createPreviewMap } from '../ui/preview-map';
import { loadGpsPathFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { showError, updateStatus } from '../ui/hud';
import { showToast } from '../ui/toast';
import {
  toggleCameraMode,
  getCameraMode,
  getCameraFollower,
  getReplayState,
} from 'gps-plus-slam-app-framework/ar/replay-scene';
import type { ReplaySceneState } from 'gps-plus-slam-app-framework/ar/replay-scene';
import type { Object3D } from 'three';
import type { CombinedRootState } from '../state/recorder-store';

// ── Helpers ────────────────────────────────────────────────────────────

function createMockSessionEntry(
  filename: string,
  date: Date | null = null
): SessionEntry {
  return {
    filename,
    fileHandle: {
      kind: 'file' as const,
      name: filename,
      getFile: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    } as unknown as FileSystemFileHandle,
    date,
  };
}

function createMockFolderHandle(
  name: string = 'TestFolder'
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;
}

// ── Test suites ────────────────────────────────────────────────────────

describe('createReplayHandlers', () => {
  let handlers: ReplayHandlers;
  let mockSetStore: ReturnType<typeof vi.fn<(store: RecorderStore) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetStore = vi.fn<(store: RecorderStore) => void>();
    handlers = createReplayHandlers({ setStore: mockSetStore });
  });

  // Why: The factory must return an object with all required handler functions
  // and state accessors, matching the contract used by main.ts.
  it('should return all handler functions and state accessors', () => {
    expect(handlers.handleReplayScenarioChange).toBeTypeOf('function');
    expect(handlers.handleReplaySessionSelect).toBeTypeOf('function');
    expect(handlers.handleStartReplay).toBeTypeOf('function');
    expect(handlers.handleReplayPlayPause).toBeTypeOf('function');
    expect(handlers.handleReplaySpeedChange).toBeTypeOf('function');
    expect(handlers.handleReplayCameraToggle).toBeTypeOf('function');
    expect(handlers.handleReplayMapToggle).toBeTypeOf('function');
    expect(handlers.handleReplayMapZoomIn).toBeTypeOf('function');
    expect(handlers.handleReplayMapZoomOut).toBeTypeOf('function');
    expect(handlers.getSessionEntries).toBeTypeOf('function');
    expect(handlers.getIsReplayMode).toBeTypeOf('function');
    expect(handlers.setIsReplayMode).toBeTypeOf('function');
    expect(handlers.setReplayZipScenariosCache).toBeTypeOf('function');
    expect(handlers.reset).toBeTypeOf('function');
  });

  // Why: Default state must match the original module-level initialization.
  it('should initialize with default state', () => {
    expect(handlers.getIsReplayMode()).toBe(false);
    expect(handlers.getSessionEntries()).toEqual([]);
  });
});

// ============================================================================
// handleReplayScenarioChange
// ============================================================================

describe('handleReplayScenarioChange', () => {
  let handlers: ReplayHandlers;
  let mockFolderHandle: FileSystemDirectoryHandle;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createReplayHandlers({ setStore: vi.fn() });

    mockFolderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
  });

  // Why: When no folder is selected, scenario change should clear the session list
  // and not crash.
  it('should clear sessions when no folder handle is available', async () => {
    vi.mocked(getReadFolderHandle).mockReturnValue(null);

    await handlers.handleReplayScenarioChange('TestScenario');

    expect(populateReplaySessions).toHaveBeenCalledWith([]);
  });

  // Why: Empty scenario name should also clear the list (guard clause).
  it('should clear sessions when scenario name is empty', async () => {
    await handlers.handleReplayScenarioChange('');

    expect(populateReplaySessions).toHaveBeenCalledWith([]);
  });

  // Why: The handler must list ZIP files from the scenario subdirectory.
  it('should list sessions from scenario subdirectory', async () => {
    const mockScenarioHandle = createMockFolderHandle('TestScenario');
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockScenarioHandle);

    const sessions = [
      createMockSessionEntry('session1.zip'),
      createMockSessionEntry('session2.zip'),
    ];
    vi.mocked(listSessionZipsInScenario).mockResolvedValue(sessions);

    await handlers.handleReplayScenarioChange('TestScenario');

    expect(mockFolderHandle.getDirectoryHandle).toHaveBeenCalledWith(
      'TestScenario'
    );
    expect(listSessionZipsInScenario).toHaveBeenCalledWith(mockScenarioHandle);
    expect(handlers.getSessionEntries()).toHaveLength(2);
  });

  // Why: When getDirectoryHandle throws NotFoundError, cache sessions should
  // still be served (metadata-only scenarios).
  it('should serve cache sessions when directory does not exist', async () => {
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

    const cachedSession = createMockSessionEntry('cached.zip');
    const cache: ScenarioSessionMap = new Map([
      ['MetadataScenario', [cachedSession]],
    ]);
    handlers.setReplayZipScenariosCache(cache);

    await handlers.handleReplayScenarioChange('MetadataScenario');

    expect(handlers.getSessionEntries()).toHaveLength(1);
    expect(handlers.getSessionEntries()[0].filename).toBe('cached.zip');
  });

  // Why: Sessions from both directory AND cache must be merged and deduplicated.
  it('should merge directory and cache sessions without duplicates', async () => {
    const mockScenarioHandle = createMockFolderHandle('Scenario');
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockScenarioHandle);

    const dirSession = createMockSessionEntry('session1.zip');
    const cacheSession = createMockSessionEntry('session1.zip'); // duplicate
    const cacheOnly = createMockSessionEntry('session2.zip');

    vi.mocked(listSessionZipsInScenario).mockResolvedValue([dirSession]);
    handlers.setReplayZipScenariosCache(
      new Map([['Scenario', [cacheSession, cacheOnly]]])
    );

    await handlers.handleReplayScenarioChange('Scenario');

    // Deduplicated: session1.zip (from dir, preferred) + session2.zip (from cache)
    expect(handlers.getSessionEntries()).toHaveLength(2);
  });

  // Why: Sessions must be sorted newest-first (reverse-alphabetical by filename,
  // since filenames contain timestamps). UX feedback 2026-03-23 Issue 3.
  it('should sort merged sessions by filename in reverse order (newest first)', async () => {
    const mockScenarioHandle = createMockFolderHandle('Scenario');
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockScenarioHandle);

    vi.mocked(listSessionZipsInScenario).mockResolvedValue([
      createMockSessionEntry('z-session.zip'),
    ]);
    handlers.setReplayZipScenariosCache(
      new Map([['Scenario', [createMockSessionEntry('a-session.zip')]]])
    );

    await handlers.handleReplayScenarioChange('Scenario');

    const entries = handlers.getSessionEntries();
    expect(entries[0].filename).toBe('z-session.zip');
    expect(entries[1].filename).toBe('a-session.zip');
  });

  // Why: Non-NotFoundError exceptions from getDirectoryHandle must be
  // re-thrown (permissions issues, bugs), not silently swallowed.
  it('should show error toast on unexpected directory error', async () => {
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error('Permission denied'));

    await handlers.handleReplayScenarioChange('TestScenario');

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list sessions'),
      expect.objectContaining({ severity: 'error' })
    );
    expect(handlers.getSessionEntries()).toEqual([]);
  });

  // Why: populateReplaySessions should receive display-friendly entries
  // (filename + date, without fileHandle).
  it('should call populateReplaySessions with display entries', async () => {
    const mockScenarioHandle = createMockFolderHandle('Scenario');
    vi.mocked(
      mockFolderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockScenarioHandle);

    const date = new Date('2026-03-01');
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([
      createMockSessionEntry('rec.zip', date),
    ]);

    await handlers.handleReplayScenarioChange('Scenario');

    expect(populateReplaySessions).toHaveBeenCalledWith([
      { filename: 'rec.zip', date },
    ]);
  });
});

// ============================================================================
// handleReplaySessionSelect
// ============================================================================

describe('handleReplaySessionSelect', () => {
  let handlers: ReplayHandlers;
  let previewMapContainer: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createReplayHandlers({ setStore: vi.fn() });

    // Create the preview map container that the handler looks up by ID
    previewMapContainer = document.createElement('div');
    previewMapContainer.id = 'replay-preview-map';
    previewMapContainer.classList.add('hidden');
    document.body.appendChild(previewMapContainer);
  });

  afterEach(() => {
    previewMapContainer.remove();
  });

  // Why: The handler stores the selected index for use by handleStartReplay.
  it('should store the selected session index', async () => {
    await handlers.handleReplaySessionSelect(2);
    expect(handlers.getSelectedSessionIndex()).toBe(2);
  });

  // Why: When a session is selected and entries exist, the handler should
  // load GPS coords from the zip and render a preview map.
  it('should load GPS path and create a preview map', async () => {
    // Populate session entries via scenario change
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    const session = createMockSessionEntry('rec.zip');
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);
    await handlers.handleReplayScenarioChange('Scenario');

    await handlers.handleReplaySessionSelect(0);

    expect(loadGpsPathFromBlob).toHaveBeenCalled();
    expect(createPreviewMap).toHaveBeenCalledWith(previewMapContainer, [
      { lat: 50, lng: 8 },
    ]);
    expect(previewMapContainer.classList.contains('hidden')).toBe(false);
  });

  // Why: When switching sessions, the previous preview map must be destroyed
  // before creating a new one to prevent Leaflet memory leaks.
  it('should destroy previous preview map when switching sessions', async () => {
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([
      createMockSessionEntry('a.zip'),
      createMockSessionEntry('b.zip'),
    ]);
    await handlers.handleReplayScenarioChange('S');

    await handlers.handleReplaySessionSelect(0);
    await handlers.handleReplaySessionSelect(1);

    expect(mockPreviewMapInstance.destroy).toHaveBeenCalledOnce();
  });

  // Why: If no session entries exist for the selected index, no GPS loading
  // or preview map creation should occur.
  it('should not load GPS path when session index is out of range', async () => {
    await handlers.handleReplaySessionSelect(99);

    expect(mockLoadGpsPathFromBlob).not.toHaveBeenCalled();
    expect(mockCreatePreviewMap).not.toHaveBeenCalled();
  });

  // Why: If GPS extraction returns no coordinates, the container should
  // remain hidden (no empty map).
  it('should hide preview map when GPS path is empty', async () => {
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([
      createMockSessionEntry('empty.zip'),
    ]);
    await handlers.handleReplayScenarioChange('S');

    mockLoadGpsPathFromBlob.mockResolvedValueOnce([]);
    mockCreatePreviewMap.mockReturnValueOnce(null);

    await handlers.handleReplaySessionSelect(0);

    expect(previewMapContainer.classList.contains('hidden')).toBe(true);
  });
});

// ============================================================================
// handleStartReplay
// ============================================================================

describe('handleStartReplay', () => {
  let handlers: ReplayHandlers;
  let mockSetStore: ReturnType<typeof vi.fn<(store: RecorderStore) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetStore = vi.fn<(store: RecorderStore) => void>();
    handlers = createReplayHandlers({ setStore: mockSetStore });

    // Create required DOM elements
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);

    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);
  });

  afterEach(() => {
    document.getElementById('app')?.remove();
    document.getElementById('setup-modal')?.remove();
  });

  // Why: Without a selected session, startReplay should show an error and abort.
  it('should show error when no session is selected', async () => {
    await handlers.handleStartReplay(1);

    expect(showError).toHaveBeenCalledWith('No session selected.');
    expect(mockStartReplayMode).not.toHaveBeenCalled();
  });

  // Why: The handler must read the zip file, call startReplayMode, and
  // set up the replay controller.
  it('should initialize replay from selected session zip', async () => {
    // Set up session entries
    const mockScenarioHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(mockScenarioHandle);
    vi.mocked(
      mockScenarioHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockScenarioHandle);

    const session = createMockSessionEntry('test.zip');
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('Scenario');
    await handlers.handleReplaySessionSelect(0);

    await handlers.handleStartReplay(2);

    expect(mockStartReplayMode).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        container: document.getElementById('app'),
      })
    );
  });

  // Why: R6 — the module-level store in main.ts must be replaced with the
  // replay store. This is the critical coupling: we verify the setStore
  // callback is called with the controller's store.
  it('should call setStore with the replay controller store', async () => {
    const session = createMockSessionEntry('test.zip');

    // Populate entries directly via scenario change
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);

    await handlers.handleStartReplay(1);

    expect(mockSetStore).toHaveBeenCalledWith(mockReplayStore);
  });

  // Why: The setup modal must be hidden and replay controls shown.
  it('should hide setup modal and show replay controls', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);

    await handlers.handleStartReplay(1);

    expect(
      document.getElementById('setup-modal')?.classList.contains('hidden')
    ).toBe(true);
    expect(showReplayControls).toHaveBeenCalled();
    expect(updatePlayPauseButton).toHaveBeenCalledWith('playing');
  });

  // Why: Playback must start at the requested speed factor.
  it('should start playback at the requested speed', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);

    await handlers.handleStartReplay(4);

    expect(mockReplayController.play).toHaveBeenCalledWith(4);
  });

  // Why: startReplayMode failure must be caught and displayed as error.
  it('should show error when startReplayMode fails', async () => {
    mockStartReplayMode.mockRejectedValueOnce(new Error('corrupt zip'));

    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);

    await handlers.handleStartReplay(1);

    expect(showError).toHaveBeenCalledWith('Failed to start replay — see logs');
  });
});

// ============================================================================
// startReplayForEntry (map-browser single-tour playback, Step 4C)
// ============================================================================

describe('startReplayForEntry', () => {
  let handlers: ReplayHandlers;
  let mockSetStore: ReturnType<typeof vi.fn<(store: RecorderStore) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetStore = vi.fn<(store: RecorderStore) => void>();
    handlers = createReplayHandlers({ setStore: mockSetStore });

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);
  });

  afterEach(() => {
    document.getElementById('app')?.remove();
    document.getElementById('setup-modal')?.remove();
    // Leave a clean mock slate: these tests start a replay (calling shared UI
    // mocks like updatePlayPauseButton), and the next describe's "no-op" test
    // asserts those mocks were not called.
    vi.clearAllMocks();
  });

  // Why: the map browser plays the tour the user picked directly, without going
  // through the scenario dropdown / session-list selection. It must start a
  // replay of exactly that entry's zip.
  it('starts a replay for the given entry without prior selection', async () => {
    const session = createMockSessionEntry('picked-on-map.zip');

    await handlers.startReplayForEntry(session, 2);

    expect(mockStartReplayMode).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ container: document.getElementById('app') })
    );
    // R6: the module store is swapped to the replay store.
    expect(mockSetStore).toHaveBeenCalledWith(mockReplayStore);
  });

  // Why: speedFactor defaults to 1 so the map browser can call it with one arg.
  it('defaults the speed factor to 1', async () => {
    const session = createMockSessionEntry('picked.zip');

    await handlers.startReplayForEntry(session);

    expect(mockReplayController.play).toHaveBeenCalledWith(1);
  });
});

// ============================================================================
// handleReplayPlayPause
// ============================================================================

describe('handleReplayPlayPause', () => {
  // Why: When no controller exists, play/pause should be a no-op.
  it('should be a no-op when no replay controller exists', () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });
    // Should not throw
    handlers.handleReplayPlayPause();
    expect(updatePlayPauseButton).not.toHaveBeenCalled();
  });

  // Why: While playing, the handler must pause and update the button state.
  it('should pause when currently playing', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    // Start a replay to get a controller
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    // Set up DOM
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);
    vi.clearAllMocks();

    // Simulate playing state
    vi.mocked(mockReplayController.getState).mockReturnValue('playing');

    handlers.handleReplayPlayPause();

    expect(mockReplayController.pause).toHaveBeenCalled();
    expect(updatePlayPauseButton).toHaveBeenCalledWith('paused');
    expect(updateStatus).toHaveBeenCalledWith('Replay paused');

    app.remove();
    modal.remove();
  });

  // Why: While paused, the handler must resume and update the button state.
  it('should resume when currently paused', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);
    vi.clearAllMocks();

    vi.mocked(mockReplayController.getState).mockReturnValue('paused');

    handlers.handleReplayPlayPause();

    expect(mockReplayController.resume).toHaveBeenCalled();
    expect(updatePlayPauseButton).toHaveBeenCalledWith('playing');
    expect(updateStatus).toHaveBeenCalledWith('Replaying...');

    app.remove();
    modal.remove();
  });
});

// ============================================================================
// handleReplaySpeedChange
// ============================================================================

describe('handleReplaySpeedChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Why: Speed changes must delegate to the replay controller.
  it('should set speed on the replay controller', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    handlers.handleReplaySpeedChange(4);

    expect(mockReplayController.setSpeed).toHaveBeenCalledWith(4);

    app.remove();
    modal.remove();
  });

  // Why: Without a controller, speed change should be a safe no-op.
  it('should be a no-op when no replay controller exists', () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });
    // Should not throw, and should not call any UI functions
    handlers.handleReplaySpeedChange(2);
    expect(mockReplayController.setSpeed).not.toHaveBeenCalled();
  });
});

// ============================================================================
// handleReplayCameraToggle
// ============================================================================

describe('handleReplayCameraToggle', () => {
  // Why: Camera toggle must delegate to the replay scene and update the UI button.
  it('should toggle camera mode and update button', () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    vi.mocked(getCameraMode).mockReturnValue('fps');

    handlers.handleReplayCameraToggle();

    expect(toggleCameraMode).toHaveBeenCalled();
    expect(updateCameraModeButton).toHaveBeenCalledWith('fps');
  });
});

// ============================================================================
// handleReplayMapToggle
// ============================================================================

describe('handleReplayMapToggle', () => {
  let handlers: ReplayHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    MockMapOverlayConstructor._constructorSpy.mockClear();
    handlers = createReplayHandlers({ setStore: vi.fn() });
  });

  // Why: Without an active replay controller, map toggle should be a no-op
  // (no scene/camera available to create the overlay).
  it('should not create MapOverlay when no replay controller exists', () => {
    handlers.handleReplayMapToggle();

    expect(MockMapOverlayConstructor._constructorSpy).not.toHaveBeenCalled();
    expect(mockMapOverlay.toggle).not.toHaveBeenCalled();
  });

  // Why: Even with a controller, if the replay scene is not initialized
  // (getReplayState returns null), the handler should warn and abort.
  it('should not create MapOverlay when replay scene state is null', async () => {
    // Start a replay to get a controller
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    // Create DOM elements for handleStartReplay
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    vi.mocked(getReplayState).mockReturnValue(null);

    handlers.handleReplayMapToggle();

    expect(MockMapOverlayConstructor._constructorSpy).not.toHaveBeenCalled();

    app.remove();
    modal.remove();
  });

  // Why: On first toggle, the handler must lazily create a MapOverlay
  // with the replay scene + camera + cameraFollower, then toggle.
  it('should lazily create MapOverlay on first toggle', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    const mockScene = {} as unknown as ReplaySceneState['scene'];
    const mockCamera = {} as unknown as ReplaySceneState['camera'];
    const mockFollower = {} as unknown as Object3D;
    vi.mocked(getReplayState).mockReturnValue({
      scene: mockScene,
      camera: mockCamera,
    } as unknown as ReplaySceneState);
    vi.mocked(getCameraFollower).mockReturnValue(mockFollower);

    handlers.handleReplayMapToggle();

    expect(
      MockMapOverlayConstructor._constructorSpy
    ).toHaveBeenCalledExactlyOnceWith(
      mockScene,
      mockCamera,
      expect.objectContaining({ mapParent: mockFollower })
    );
    expect(mockMapOverlay.toggle).toHaveBeenCalledOnce();

    app.remove();
    modal.remove();
  });

  // Why: On second toggle, the handler should reuse the existing MapOverlay
  // and not create a new one.
  it('should reuse existing MapOverlay on subsequent toggles', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    vi.mocked(getReplayState).mockReturnValue({
      scene: {},
      camera: {},
    } as unknown as ReplaySceneState);
    vi.mocked(getCameraFollower).mockReturnValue({} as unknown as Object3D);

    // First and second toggle
    handlers.handleReplayMapToggle();
    handlers.handleReplayMapToggle();

    expect(MockMapOverlayConstructor._constructorSpy).toHaveBeenCalledOnce();
    expect(mockMapOverlay.toggle).toHaveBeenCalledTimes(2);

    app.remove();
    modal.remove();
  });

  // Why: When the store has GPS data, the handler should set the initial
  // GPS position on the MapOverlay before the first toggle.
  it('should set GPS position from store state on first creation', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    // Set up store to return GPS data
    vi.mocked(mockReplayStore.getState).mockReturnValue({
      gpsData: {
        gpsEvents: {
          gpsPositions: [
            { latitude: 50.0, longitude: 8.0, coordinates: [0, 0, 0] },
          ],
        },
      },
    } as unknown as CombinedRootState);

    vi.mocked(getReplayState).mockReturnValue({
      scene: {},
      camera: {},
    } as unknown as ReplaySceneState);
    vi.mocked(getCameraFollower).mockReturnValue({} as unknown as Object3D);

    handlers.handleReplayMapToggle();

    expect(mockMapOverlay.setGpsPosition).toHaveBeenCalledWith(50.0, 8.0);
    expect(mockMapOverlay.toggle).toHaveBeenCalledOnce();

    app.remove();
    modal.remove();
  });

  // Why: The handler must call setMapOverlay on the controller so the
  // store subscriber can update the map with future GPS events.
  it('should register overlay with replay controller', async () => {
    const session = createMockSessionEntry('test.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(createMockFolderHandle());
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    const modal = document.createElement('div');
    modal.id = 'setup-modal';
    document.body.appendChild(modal);

    await handlers.handleReplayScenarioChange('S');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    vi.mocked(getReplayState).mockReturnValue({
      scene: {},
      camera: {},
    } as unknown as ReplaySceneState);
    vi.mocked(getCameraFollower).mockReturnValue({} as unknown as Object3D);

    handlers.handleReplayMapToggle();

    expect(mockReplayController.setMapOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        toggle: expect.any(Function),
        setGpsPosition: expect.any(Function),
      })
    );

    app.remove();
    modal.remove();
  });
});

// ============================================================================
// State management
// ============================================================================

describe('replay handler state management', () => {
  // Why: isReplayMode must be settable and gettable (used by main.ts init
  // and handleOpenFolder).
  it('should get/set isReplayMode', () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    expect(handlers.getIsReplayMode()).toBe(false);

    handlers.setIsReplayMode(true);
    expect(handlers.getIsReplayMode()).toBe(true);
  });

  // Why: The zip scenarios cache must be settable from handleOpenFolder
  // (which stays in main.ts) and readable by handleReplayScenarioChange.
  it('should accept and use replayZipScenariosCache', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    const session = createMockSessionEntry('cached.zip');
    const cache: ScenarioSessionMap = new Map([['CacheOnly', [session]]]);
    handlers.setReplayZipScenariosCache(cache);

    // Set up folder handle that throws NotFoundError for directory
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

    await handlers.handleReplayScenarioChange('CacheOnly');

    expect(handlers.getSessionEntries()).toHaveLength(1);
    expect(handlers.getSessionEntries()[0].filename).toBe('cached.zip');
  });

  // Why: reset() must clear all replay state for test isolation or app reset.
  it('should reset all state', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    handlers.setIsReplayMode(true);
    handlers.setReplayZipScenariosCache(
      new Map([['S', [createMockSessionEntry('x.zip')]]])
    );
    await handlers.handleReplaySessionSelect(5);

    handlers.reset();

    expect(handlers.getIsReplayMode()).toBe(false);
    expect(handlers.getSessionEntries()).toEqual([]);
    expect(handlers.getSelectedSessionIndex()).toBe(-1);
  });

  // Why (Issue #1): reset() must dispose the replayController (Three.js scene,
  // store subscriptions, ReplayEngine abort controller) and the mapOverlay
  // (Leaflet DOM nodes, tile layers). Without dispose, repeated replays leak
  // GPU memory and can cause WebGL context loss on mobile.
  it('should dispose replayController on reset (Issue #1)', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    // Start a replay to set replayController
    document.body.innerHTML =
      '<div id="app"></div><div id="setup-modal"></div>';
    const session = createMockSessionEntry('session.zip');
    handlers.setIsReplayMode(true);
    handlers.setReplayZipScenariosCache(new Map());

    // Manually set session entries by triggering scenario change
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    const scenarioHandle = createMockFolderHandle('scenario');
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(scenarioHandle);
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('TestScenario');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    expect(mockReplayController.dispose).not.toHaveBeenCalled();

    handlers.reset();

    expect(mockReplayController.dispose).toHaveBeenCalledTimes(1);
  });

  // Why (Issue #1): mapOverlay holds Leaflet map DOM nodes and tile connections.
  // Without dispose on reset, these resources leak on each replay cycle.
  it('should dispose mapOverlay on reset (Issue #1)', async () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });

    // Start a replay to set replayController
    document.body.innerHTML =
      '<div id="app"></div><div id="setup-modal"></div>';
    const session = createMockSessionEntry('session.zip');
    const folderHandle = createMockFolderHandle();
    vi.mocked(getReadFolderHandle).mockReturnValue(folderHandle);
    const scenarioHandle = createMockFolderHandle('scenario');
    vi.mocked(
      folderHandle.getDirectoryHandle as ReturnType<typeof vi.fn>
    ).mockResolvedValue(scenarioHandle);
    vi.mocked(listSessionZipsInScenario).mockResolvedValue([session]);

    await handlers.handleReplayScenarioChange('TestScenario');
    await handlers.handleReplaySessionSelect(0);
    await handlers.handleStartReplay(1);

    // Trigger map creation by toggling with scene state
    const mockScene = {} as unknown as Object3D;
    const mockCamera = {} as unknown as Object3D;
    vi.mocked(getReplayState).mockReturnValue({
      scene: mockScene,
      camera: mockCamera,
    } as ReplaySceneState);
    vi.mocked(mockReplayController.getStore().getState).mockReturnValue({
      gpsData: { gpsEvents: { gpsPositions: [] } },
    } as unknown as CombinedRootState);
    handlers.handleReplayMapToggle();

    // Now reset — mapOverlay.dispose() should be called
    handlers.reset();

    expect(mockMapOverlay.dispose).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Replay map zoom handlers
// ============================================================================

describe('handleReplayMapZoomIn / handleReplayMapZoomOut', () => {
  // Why: Zoom buttons are safe no-ops when the overlay hasn't been created yet.
  it('should not throw when map overlay has not been created', () => {
    const handlers = createReplayHandlers({ setStore: vi.fn() });
    expect(() => handlers.handleReplayMapZoomIn()).not.toThrow();
    expect(() => handlers.handleReplayMapZoomOut()).not.toThrow();
  });
});
