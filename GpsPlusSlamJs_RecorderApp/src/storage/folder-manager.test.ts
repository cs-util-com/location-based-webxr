/**
 * Folder Manager Tests
 *
 * Tests for the folder-manager module extracted from main.ts
 * (Finding #7 — main.ts decomposition, Step 4).
 *
 * Tests the factory function `createFolderManager(deps)` which encapsulates:
 * - handleOpenFolder: folder picker + ref point import + scenario discovery
 * - handleChooseSaveLocation: save file picker
 * - handleScenarioChange: scenario dropdown change handler
 * - cachedOpfsScenarios: OPFS scenario cache
 * - currentScenarioName: current scenario name state
 *
 * Status display functions (updateFolderStatus / updateSaveStatus) are injected
 * dependencies — no jsdom environment is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFolderManager,
  type FolderManagerDeps,
  type FolderManager,
} from './folder-manager';
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
} from './recording-discovery';
import type { RecorderStore } from '../state/recorder-store';

// --- Mock all direct dependencies ---

vi.mock('./external-file-storage', () => ({
  isExternalStorageSupported: vi.fn(() => true),
  selectReadFolder: vi.fn(),
  selectSaveFile: vi.fn(),
  getReadFolderHandle: vi.fn(),
}));

// The folder/zip scan. Mocked as a module like every other direct storage
// dependency above — until 2026-07-30 these three arrived as injected
// callbacks instead, purely because the module was misfiled under `ui/` and
// dependency-cruiser forbids storage → ui. Defaults are (re)installed in
// beforeEach, individual tests override with vi.mocked(...).
vi.mock('./recording-discovery', () => ({
  listScenariosFromFolder: vi.fn(),
  extractScenarioNamesFromZips: vi.fn(),
  discoverScenariosFromZipMetadata: vi.fn(),
}));

vi.mock('./scenario-storage', () => ({
  setCurrentScenario: vi.fn(),
  ensureScenarioDirectory: vi.fn(),
  getScenarioDirectoryHandle: vi.fn(),
}));

vi.mock('../storage/ref-point-loader', () => ({
  loadAllRefPoints: vi.fn(() => []),
  flattenRefPointsToMarks: vi.fn(() => []),
  averageGpsPerRefPoint: vi.fn(() => []),
  writeRefPointDefinition: vi.fn(),
}));

vi.mock('../storage/ref-point-recovery', () => ({
  indexRefPointDefinitionsFromFolder: vi.fn(() =>
    Promise.resolve({
      definitionsByScenario: new Map(),
      zipFilesScanned: 0,
      errors: [],
    })
  ),
}));

vi.mock('../storage/ref-point-merge', () => ({
  // Passthrough spy: the merge algorithm has its own unit/property tests
  // (ref-point-merge.test.ts). Here we only pin that loadAndDisplayRefPoints
  // routes the loaded definitions THROUGH the merge and consumes its result.
  mergeSiblingRefPoints: vi.fn((defs: unknown) => defs),
}));

vi.mock('gps-plus-slam-app-framework/geo/h3-proximity', () => ({
  // Defaults: every id counts as H3, cells match only on equality. Individual
  // tests override h3CellsMatch to simulate gridDisk neighbor overlap.
  isH3Index: vi.fn(() => true),
  h3CellsMatch: vi.fn((a: string, b: string) => a === b),
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Now import mocked modules for assertion
import {
  isExternalStorageSupported,
  selectReadFolder,
  selectSaveFile,
  getReadFolderHandle,
} from './external-file-storage';
import {
  setCurrentScenario,
  ensureScenarioDirectory,
  getScenarioDirectoryHandle,
} from './scenario-storage';
import { indexRefPointDefinitionsFromFolder } from '../storage/ref-point-recovery';
import {
  loadAllRefPoints,
  flattenRefPointsToMarks,
  averageGpsPerRefPoint,
  writeRefPointDefinition,
  type RefPointDefinition,
} from '../storage/ref-point-loader';
import { h3CellsMatch } from 'gps-plus-slam-app-framework/geo/h3-proximity';

// ============================================================================
// Helpers
// ============================================================================

const mockFolderHandle = {
  kind: 'directory',
  name: 'TestFolder',
} as unknown as FileSystemDirectoryHandle;

/**
 * Creates a minimal mock RecorderStore that handles scenario/setCurrentScenarioName
 * actions, backing them with a simple in-memory state.
 */
function createMockStore(): RecorderStore {
  const state = {
    recording: {
      isRecording: false,
      sessionMetadata: null,
      actionCount: 0,
      failedWriteCount: 0,
    },
    scenario: {
      currentScenarioName: '',
    },
    refPoints: {
      entries: [],
    },
    gpsData: null,
  };
  return {
    getState: () => state,
    dispatch: vi.fn((action: { type: string; payload?: unknown }) => {
      if (action.type === 'scenario/setCurrentScenarioName') {
        state.scenario.currentScenarioName = action.payload as string;
      }
    }),
    subscribe: () => () => {},
  } as unknown as RecorderStore;
}

function createDefaultDeps(
  overrides: Partial<FolderManagerDeps> = {}
): FolderManagerDeps {
  const mockStore = overrides.getStore?.() ?? createMockStore();
  return {
    getStore: () => mockStore,
    getIsReplayMode: vi.fn(() => false),
    setReplayZipScenariosCache: vi.fn(),
    showError: vi.fn(),
    updateStatus: vi.fn(),
    populateScenarios: vi.fn(),
    setSaveLocationSelected: vi.fn(),
    setFolderImportExpanded: vi.fn(),
    validateEnterButton: vi.fn(),
    populateReplayScenarios: vi.fn(),
    updateFolderStatus: vi.fn(),
    updateSaveStatus: vi.fn(),
    ...overrides,
  };
}

function createFolderManagerWithDefaults(
  overrides: Partial<FolderManagerDeps> = {}
): { manager: FolderManager; deps: FolderManagerDeps; store: RecorderStore } {
  const deps = createDefaultDeps(overrides);
  const manager = createFolderManager(deps);
  return { manager, deps, store: deps.getStore() };
}

// ============================================================================
// Tests
// ============================================================================

describe('createFolderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mockReturnValue for isExternalStorageSupported
    // (vi.clearAllMocks does NOT reset mockReturnValue/mockResolvedValue)
    vi.mocked(isExternalStorageSupported).mockReturnValue(true);

    // Empty-folder defaults for the scan, for the same reason: a scan that
    // resolved to `undefined` would blow up in the Promise.all destructuring
    // of every test that does not care about scenario discovery.
    vi.mocked(listScenariosFromFolder).mockResolvedValue([]);
    vi.mocked(extractScenarioNamesFromZips).mockResolvedValue([]);
    vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
      scenarioSessions: new Map(),
      scenarioNames: [],
    });
  });

  // ========================================================================
  // State management
  // ========================================================================

  describe('scenario name state', () => {
    it('should initialize currentScenarioName as empty string', () => {
      // Why: Default state must be empty so handleStartRecording knows no scenario was selected
      const { manager } = createFolderManagerWithDefaults();
      expect(manager.getCurrentScenarioName()).toBe('');
    });

    it('should update currentScenarioName via setter', () => {
      // Why: Scenario dropdown changes must be reflected in state
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');
      expect(manager.getCurrentScenarioName()).toBe('Paris');
    });

    it('should persist the last selected scenario name', () => {
      // Why: Multiple changes should always reflect the most recent selection
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('A');
      manager.setCurrentScenarioName('B');
      expect(manager.getCurrentScenarioName()).toBe('B');
    });
  });

  describe('OPFS scenario cache', () => {
    it('should initialize cachedOpfsScenarios as empty array', () => {
      // Why: Default state must be empty before OPFS is initialized
      const { manager } = createFolderManagerWithDefaults();
      expect(manager.getCachedOpfsScenarios()).toEqual([]);
    });

    it('should update cachedOpfsScenarios via setter', () => {
      // Why: OPFS initialization provides scenario names that must be cached
      const { manager } = createFolderManagerWithDefaults();
      manager.setCachedOpfsScenarios(['Paris', 'Berlin']);
      expect(manager.getCachedOpfsScenarios()).toEqual(['Paris', 'Berlin']);
    });
  });

  describe('reset', () => {
    it('should reset all state to defaults', () => {
      // Why: Test isolation requires full state reset between tests
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');
      manager.setCachedOpfsScenarios(['Berlin']);
      manager.reset();
      expect(manager.getCurrentScenarioName()).toBe('');
      expect(manager.getCachedOpfsScenarios()).toEqual([]);
    });
  });

  // ========================================================================
  // handleOpenFolder — recording mode
  // ========================================================================

  describe('handleOpenFolder — recording mode', () => {
    beforeEach(() => {
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: true,
        folderName: 'TestFolder',
      } as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    });

    it('should return early when external storage is not supported', async () => {
      // Why: Must guard against missing File System Access API
      vi.mocked(isExternalStorageSupported).mockReturnValue(false);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).toHaveBeenCalledWith(
        'External file access is not supported in this browser.'
      );
      expect(selectReadFolder).not.toHaveBeenCalled();
    });

    it('should not launch the map browser in recording mode', async () => {
      // Why: the map-centric browser is a replay-mode selector only (Step 4C).
      const onReplayFolderScanned =
        vi.fn<NonNullable<FolderManagerDeps['onReplayFolderScanned']>>();
      const { manager } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => false),
        onReplayFolderScanned,
      });

      await manager.handleOpenFolder();

      expect(onReplayFolderScanned).not.toHaveBeenCalled();
    });

    it('should return early when user cancels folder picker', async () => {
      // Why: User cancellation is not an error — no side effects expected
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: false,
        reason: 'cancelled',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when folder picker fails', async () => {
      // Why: Non-cancellation failures should inform the user
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: false,
        reason: 'error',
        error: 'Access denied',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).toHaveBeenCalledWith('Access denied');
    });

    it('should show error when folder handle is not available', async () => {
      // Why: Edge case where selectReadFolder succeeds but getReadFolderHandle returns null
      vi.mocked(getReadFolderHandle).mockReturnValue(null);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Failed to access folder'
      );
    });

    it('should call listScenariosFromFolder with the folder handle', async () => {
      // Why: Must scan for scenario subdirectories
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(listScenariosFromFolder).toHaveBeenCalledWith(mockFolderHandle);
    });

    it('should call extractScenarioNamesFromZips', async () => {
      // Why: Top-level ZIPs with scenario prefixes must also contribute
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(extractScenarioNamesFromZips).toHaveBeenCalledWith(
        mockFolderHandle
      );
    });

    it('should merge OPFS, folder, and zip scenarios — deduplicated and sorted', async () => {
      // Why: Dropdown must show unified, sorted, deduplicated scenario list
      vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris', 'Munich']);
      vi.mocked(extractScenarioNamesFromZips).mockResolvedValue(['Tokyo']);
      const { manager, deps } = createFolderManagerWithDefaults();
      manager.setCachedOpfsScenarios(['Paris', 'Berlin']);

      await manager.handleOpenFolder();

      expect(deps.populateScenarios).toHaveBeenCalledWith([
        'Berlin',
        'Munich',
        'Paris',
        'Tokyo',
      ]);
    });

    it('should update folder status with scenario count', async () => {
      // Why: User needs feedback on what was found
      vi.mocked(listScenariosFromFolder).mockResolvedValue(['Paris', 'Munich']);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      const statusCall =
        vi.mocked(deps.updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
      expect(statusCall).toContain('2 scenario');
    });

    it('should set folder selected and validate enter button', async () => {
      // Why: Successful folder open enables the Enter AR button
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.validateEnterButton).toHaveBeenCalled();
    });

    it('should handle unexpected errors during folder scan', async () => {
      // Why: Must not crash on unexpected exceptions
      vi.mocked(listScenariosFromFolder).mockRejectedValue(
        new Error('Network error')
      );
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Folder scan error - see logs'
      );
    });
  });

  // ========================================================================
  // handleOpenFolder — replay mode
  // ========================================================================

  describe('handleOpenFolder — replay mode', () => {
    beforeEach(() => {
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: true,
        folderName: 'TestFolder',
      } as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    });

    it('should discover scenarios from both directories and zip metadata', async () => {
      // Why: Replay mode must discover scenarios from both sources
      const { manager } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(listScenariosFromFolder).toHaveBeenCalledWith(mockFolderHandle);
      expect(discoverScenariosFromZipMetadata).toHaveBeenCalledWith(
        mockFolderHandle
      );
    });

    it('should hand the folder to onReplayFolderScanned (map browser launch)', async () => {
      // Why: Step 4C — after a successful replay-mode scan, the folder is handed
      // to the map-centric browser so it can build its coverage index and become
      // the primary replay selector.
      const onReplayFolderScanned =
        vi.fn<NonNullable<FolderManagerDeps['onReplayFolderScanned']>>();
      const { manager } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        onReplayFolderScanned,
      });

      await manager.handleOpenFolder();

      expect(onReplayFolderScanned).toHaveBeenCalledWith(mockFolderHandle);
    });

    it('should not break the scan when onReplayFolderScanned throws', async () => {
      // Why: a map-browser launch failure must not abort the modal flow.
      const onReplayFolderScanned = vi
        .fn<NonNullable<FolderManagerDeps['onReplayFolderScanned']>>()
        .mockRejectedValue(new Error('boom'));
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        onReplayFolderScanned,
      });

      await expect(manager.handleOpenFolder()).resolves.toBeUndefined();
      expect(deps.populateReplayScenarios).toHaveBeenCalled();
    });

    it('should cache zip scenario mapping via deps', async () => {
      // Why: Cached mapping is used when user selects a metadata-only scenario
      const scenarioSessions = new Map([
        [
          'ParkWalk',
          [
            {
              filename: 'rec.zip',
              fileHandle: {} as FileSystemFileHandle,
              date: null,
            },
          ],
        ],
      ]);
      vi.mocked(discoverScenariosFromZipMetadata).mockResolvedValue({
        scenarioSessions,
        scenarioNames: ['ParkWalk'],
      });
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(deps.setReplayZipScenariosCache).toHaveBeenCalledWith(
        scenarioSessions
      );
    });

    it('should merge and deduplicate scenarios from directories and zips', async () => {
      // Why: Both discovery mechanisms must contribute without duplicates
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
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(deps.populateReplayScenarios).toHaveBeenCalledWith([
        'DirScenario',
        'ZipScenario',
      ]);
    });

    it('should update folder status with scenario count', async () => {
      // Why: User needs to see what was found in the folder
      vi.mocked(listScenariosFromFolder).mockResolvedValue(['A', 'B']);
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      const statusCall =
        vi.mocked(deps.updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
      expect(statusCall).toContain('2 scenarios');
    });

    it('should handle replay mode folder scan errors gracefully', async () => {
      // Why: Must not crash on scan failure
      vi.mocked(listScenariosFromFolder).mockRejectedValue(
        new Error('Permission denied')
      );
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Failed to read scenarios'
      );
    });
  });

  // ========================================================================
  // handleChooseSaveLocation
  // ========================================================================

  describe('handleChooseSaveLocation', () => {
    it('should return early when external storage is not supported', async () => {
      // Why: Must guard against missing File System Access API
      vi.mocked(isExternalStorageSupported).mockReturnValue(false);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).toHaveBeenCalledWith(
        'External file access is not supported in this browser.'
      );
      expect(selectSaveFile).not.toHaveBeenCalled();
    });

    it('should return early when user cancels', async () => {
      // Why: User cancellation is not an error
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: false,
        reason: 'cancelled',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when save picker fails', async () => {
      // Why: Failure should inform the user
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: false,
        reason: 'error',
        error: 'Disk full',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).toHaveBeenCalledWith('Disk full');
    });

    it('should update save status and enable button on success', async () => {
      // Why: Successful save location must update UI state
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: true,
        fileName: 'recording.zip',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.updateSaveStatus).toHaveBeenCalledWith('✅ recording.zip');
      expect(deps.setSaveLocationSelected).toHaveBeenCalledWith(true);
      expect(deps.validateEnterButton).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // handleScenarioChange
  // ========================================================================

  describe('handleScenarioChange', () => {
    it('should update currentScenarioName', async () => {
      // Why: Scenario change must update internal state
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('New Scenario');

      expect(manager.getCurrentScenarioName()).toBe('New Scenario');
    });

    it('should call setCurrentScenario to update storage', async () => {
      // Why: Storage layer must know which scenario is active
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(setCurrentScenario).toHaveBeenCalledWith('Paris');
    });

    it('should load and display ref points when scenario handle is returned', async () => {
      // Why: Changing scenario must load its ref points for the AR view
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(loadAllRefPoints).toHaveBeenCalledWith(mockFolderHandle);
    });

    it('should update status with ref point info', async () => {
      // Why: User needs feedback on what ref points are in this scenario
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { name: 'pt1', observations: [] },
        { name: 'pt2', observations: [] },
      ] as never);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([
        { lat: 0, lng: 0, name: 'pt1' },
        { lat: 1, lng: 1, name: 'pt2' },
        { lat: 2, lng: 2, name: 'pt2' },
      ] as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(deps.updateStatus).toHaveBeenCalledWith(
        'Scenario: Paris | 2 ref points (3 observations)'
      );
    });

    it('auto-expands the folder-import section when the scenario has no OPFS ref points and no read folder (D5)', async () => {
      // Why: F5-C — a scenario with zero saved reference points and no folder
      // open should surface the optional import/recovery step with a hint.
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('FreshScenario');

      expect(deps.setFolderImportExpanded).toHaveBeenCalledWith(
        true,
        expect.stringContaining('FreshScenario')
      );
    });

    it('keeps the folder-import section collapsed when the scenario already has OPFS ref points (D5)', async () => {
      // Why: F5-C — when the scenario already has reference points, the import
      // step stays collapsed (typical flow: pick scenario → save → enter).
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { name: 'pt1', observations: [] },
      ] as never);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([
        { lat: 0, lng: 0, name: 'pt1' },
      ] as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('KnownScenario');

      expect(deps.setFolderImportExpanded).toHaveBeenCalledWith(false);
    });

    it('should show error when scenario handle is null', async () => {
      // Why: Failed scenario load must inform the user
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('BadScenario');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: BadScenario'
      );
    });

    it('should handle errors in scenario loading', async () => {
      // Why: Must not crash on storage errors
      vi.mocked(setCurrentScenario).mockRejectedValue(new Error('OPFS error'));
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('BrokenScenario');

      expect(deps.showError).toHaveBeenCalledWith(
        'Error loading scenario: BrokenScenario'
      );
    });
  });

  // ========================================================================
  // loadAndDisplayRefPoints
  // ========================================================================

  describe('loadAndDisplayRefPoints', () => {
    it('should load and flatten ref points from a scenario handle', async () => {
      // Why: loadAllRefPoints + flattenRefPointsToMarks are the entry
      // points for sidecar-imported ref points. The result counts must
      // reflect both the number of definitions and the total observation
      // count.
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      const mockDefs = [
        { name: 'pt1', observations: [{ lat: 0, lng: 0, name: 'pt1' }] },
      ] as never;
      const mockMarks = [{ lat: 0, lng: 0, name: 'pt1' }] as never;
      vi.mocked(loadAllRefPoints).mockResolvedValue(mockDefs);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue(mockMarks);
      const { manager } = createFolderManagerWithDefaults();

      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(loadAllRefPoints).toHaveBeenCalledWith(mockFolderHandle);
      expect(flattenRefPointsToMarks).toHaveBeenCalledWith(mockDefs);
      expect(result).toEqual({ refPointCount: 1, observationCount: 1 });
    });

    it('routes loaded definitions through the sibling merge and consumes its result (D6a)', async () => {
      // Why: durable neighbor-cell twins and legacy-id duplicates must be
      // collapsed BEFORE display/averaging/matcher dispatch — existing
      // stores heal in memory without any file rewrite. This pins the seam:
      // loaded defs go in, everything downstream consumes the merge OUTPUT.
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      const { mergeSiblingRefPoints } =
        await import('../storage/ref-point-merge');
      const loadedDefs = [
        { id: 'twin-a', name: 'Door', createdAt: 1, observations: [] },
        { id: 'twin-b', name: 'Door', createdAt: 2, observations: [] },
      ] as never;
      const mergedDefs = [
        { id: 'twin-a', name: 'Door', createdAt: 1, observations: [] },
      ] as never;
      vi.mocked(loadAllRefPoints).mockResolvedValue(loadedDefs);
      // Once — clearAllMocks does NOT reset implementations, so a sticky
      // override would leak the merged result into every later test.
      vi.mocked(mergeSiblingRefPoints).mockReturnValueOnce(mergedDefs);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([]);
      const { manager } = createFolderManagerWithDefaults();

      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(mergeSiblingRefPoints).toHaveBeenCalledWith(loadedDefs);
      expect(flattenRefPointsToMarks).toHaveBeenCalledWith(mergedDefs);
      expect(result.refPointCount).toBe(1);
    });

    it('should dispatch setImportedRefPointEntries into refPoints (Step 5.5)', async () => {
      // Why: post-Step-5.5 the OPFS sidecar fast-path populates the new flat
      // `refPoints` slice via `setImportedRefPointEntries`. The matcher
      // (`selectKnownAnchorsByCell`) reads from there since Step 5.4. Each
      // averaged ref point becomes a single `RefPointEntry` carrying the
      // human-readable `name` and a `rawGpsPoint` synthesised from the
      // averaged lat/lon/alt (timestamp 0 — sidecar entries are not
      // live observations).
      const { loadAllRefPoints, averageGpsPerRefPoint } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { id: 'p1', name: 'P1', createdAt: 1000, observations: [] },
        { id: 'p2', name: 'P2', createdAt: 2000, observations: [] },
      ] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([
        { id: 'p1', name: 'P1', lat: 50.0, lon: 8.0, alt: 100 },
        { id: 'p2', name: 'P2', lat: 51.0, lon: 9.0 },
      ]);
      const { manager, store } = createFolderManagerWithDefaults();

      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refPoints/setImportedRefPointEntries',
          payload: [
            expect.objectContaining({
              id: 'p1',
              name: 'P1',
              timestamp: 0,
              rawGpsPoint: expect.objectContaining({
                latitude: 50.0,
                longitude: 8.0,
                altitude: 100,
              }),
            }),
            expect.objectContaining({
              id: 'p2',
              name: 'P2',
              timestamp: 0,
              rawGpsPoint: expect.objectContaining({
                latitude: 51.0,
                longitude: 9.0,
              }),
            }),
          ],
        })
      );
    });

    // NOTE (2026-07-05 live-map feedback): the direct mapOverlay
    // addPriorMarkers/clearPriorMarkers dep was removed — it was dead code
    // (it ran at scenario-selection time, before the lazily created AR
    // minimap ever existed). The minimap now renders ref points from the
    // store via wireRefPointMapMarkers, fed by the
    // setImportedRefPointEntries dispatch asserted above.

    it('should recover ONLY the current scenario bucket from ZIPs when OPFS is empty (strict routing, D4a)', async () => {
      // Why: Problem 2 fix + D4a (2026-07-05): when OPFS is cleared, ref
      // points are recovered from the read folder's ZIPs via the shared
      // indexing pass — but only the CURRENT scenario's bucket is written.
      // Definitions belonging to other scenarios must NOT bleed into this
      // scenario's store (the eager folder-pick pass covers them).
      const recoveredDef = {
        id: 'h3-cell-a',
        name: 'Bench',
        createdAt: 1000,
        observations: [
          {
            sessionId: 'session-1',
            timestamp: 1000,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: { latitude: 50.1, longitude: 8.1 },
          },
        ],
      } as unknown as RefPointDefinition;
      const foreignDef = {
        id: 'h3-cell-z',
        name: 'Other scenario point',
        createdAt: 2000,
        observations: [],
      } as unknown as RefPointDefinition;

      // 1st call: OPFS-empty check. 2nd: gap-fill accepted-list. 3rd (after
      // the write): re-load with data.
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([recoveredDef]);
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue({
        definitionsByScenario: new Map([
          ['Paris', [recoveredDef]],
          ['Berlin', [foreignDef]],
        ]),
        zipFilesScanned: 2,
        errors: [],
      });
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      // Recovery ran via the shared indexing pass over the read folder.
      expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalledWith(
        mockFolderHandle
      );
      // Only the current scenario's bucket was written — no bleed.
      const writtenIds = vi
        .mocked(writeRefPointDefinition)
        .mock.calls.map(([, def]) => def.id);
      expect(writtenIds).toEqual(['h3-cell-a']);
      // After recovery, ref points are loaded and displayed.
      expect(result.refPointCount).toBe(1);
    });

    it('lazy recovery resolves the scenario via the recording contextTag after the store swap (regression pin, round-3 feedback)', async () => {
      // Why: same store-swap hazard as the post-indexing refresh — during a
      // recording the fresh store's scenario slice is empty and the selection
      // lives only in sessionMetadata.contextTag. Without the shared
      // resolver, the lazy recovery looked up the '' bucket and recovered
      // nothing.
      const def: RefPointDefinition = {
        id: 'cell-a',
        name: 'cell-a',
        createdAt: 1,
        observations: [],
      };
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue({
        definitionsByScenario: new Map([['Paris', [def]]]),
        zipFilesScanned: 1,
        errors: [],
      });
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([]) // empty-store check
        .mockResolvedValueOnce([]) // gap-fill accepted list
        .mockResolvedValue([def]); // re-load after write
      const { flattenRefPointsToMarks, averageGpsPerRefPoint } =
        await import('../storage/ref-point-loader');
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([]);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const recordingStore = {
        getState: () => ({
          recording: {
            isRecording: true,
            sessionMetadata: { contextTag: 'Paris', startTime: 123 },
            actionCount: 0,
            failedWriteCount: 0,
          },
          scenario: { currentScenarioName: '' },
          refPoints: { entries: [] },
          gpsData: null,
        }),
        dispatch: vi.fn(),
        subscribe: () => () => {},
      } as unknown as RecorderStore;
      const { manager } = createFolderManagerWithDefaults({
        getStore: () => recordingStore,
      });

      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(writeRefPointDefinition).toHaveBeenCalledWith(
        mockFolderHandle,
        def
      );
      expect(result.refPointCount).toBe(1);
    });

    it('should NOT attempt recovery when OPFS has data', async () => {
      // Why: Recovery should only run when OPFS is empty — unnecessary
      // ZIP scanning would slow down normal scenario changes.
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');

      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { id: 'p1', name: 'existing', createdAt: 1, observations: [] },
      ] as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(indexRefPointDefinitionsFromFolder).not.toHaveBeenCalled();
    });

    it('should NOT attempt recovery when no read folder is available', async () => {
      // Why: Without a read folder, there are no ZIPs to recover from.
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');

      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      // Earlier tests set non-empty return values; mockReturnValue persists
      // across clearAllMocks, so re-assert the empty defaults explicitly.
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([]);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);

      const { manager } = createFolderManagerWithDefaults();
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(indexRefPointDefinitionsFromFolder).not.toHaveBeenCalled();
      expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
    });

    it('should handle recovery errors gracefully', async () => {
      // Why: Recovery failures should not crash scenario selection —
      // user can still record, just without prior ref points.
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');

      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([]);
      vi.mocked(indexRefPointDefinitionsFromFolder).mockRejectedValue(
        new Error('ZIP read failure')
      );
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      // Should not throw
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);
      expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
    });
  });

  // ========================================================================
  // handleScenarioChange — OPFS recovery (Problem 2)
  // ========================================================================

  describe('handleScenarioChange — OPFS recovery', () => {
    it('should create scenario directory and proceed when OPFS scenario is missing but read folder available', async () => {
      // Why: After browser data clear, the scenario directory is gone.
      // When a read folder with ZIPs is available, we should create
      // the directory so recovery can populate it.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(ensureScenarioDirectory).mockResolvedValue(mockFolderHandle);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
      const { loadAllRefPoints } = await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Aachen');

      expect(ensureScenarioDirectory).toHaveBeenCalledWith('Aachen');
      // Should not show error since recovery path was taken
      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when OPFS scenario missing and no read folder', async () => {
      // Why: Without a read folder, cannot create and recover — show error.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Unknown');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: Unknown'
      );
    });

    it('should show error when ensureScenarioDirectory also fails', async () => {
      // Why: If even creating the directory fails (e.g., OPFS not initialized),
      // must inform the user.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(ensureScenarioDirectory).mockResolvedValue(null);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Broken');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: Broken'
      );
    });
  });

  // ==========================================================================
  // Eager ref-point indexing on folder pick (2026-07-05 plan, Slice 2 —
  // decisions D1 / D4a / D4b / D4b-ii)
  // ==========================================================================
  describe('eager ref-point indexing on folder pick', () => {
    /** Minimal RefPointDefinition fixture (observations irrelevant here). */
    function mkDef(id: string, name: string = id): RefPointDefinition {
      return { id, name, createdAt: 1, observations: [] };
    }

    /** Per-scenario-name directory-handle stubs, capturable by name. */
    function stubScenarioHandles(): Map<string, FileSystemDirectoryHandle> {
      const handles = new Map<string, FileSystemDirectoryHandle>();
      vi.mocked(getScenarioDirectoryHandle).mockImplementation(
        (name: string) => {
          let handle = handles.get(name);
          if (!handle) {
            handle = {
              kind: 'directory',
              name,
            } as unknown as FileSystemDirectoryHandle;
            handles.set(name, handle);
          }
          return Promise.resolve(handle);
        }
      );
      return handles;
    }

    function indexResult(
      buckets: Array<[string, RefPointDefinition[]]>,
      zipFilesScanned = buckets.length
    ) {
      return {
        definitionsByScenario: new Map(buckets),
        zipFilesScanned,
        errors: [] as string[],
      };
    }

    beforeEach(() => {
      // Re-assert defaults: vi.clearAllMocks (outer beforeEach) clears calls
      // but keeps implementations, and earlier tests may have overridden them.
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: true,
        folderName: 'TestFolder',
      });
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([])
      );
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      // Earlier tests set non-empty values; mockReturnValue persists across
      // clearAllMocks, so re-assert the empty defaults for this describe.
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([]);
      vi.mocked(h3CellsMatch).mockImplementation(
        (a: string, b: string) => a === b
      );
      stubScenarioHandles();
    });

    /**
     * Why this test matters:
     * D1 — the whole point of this slice: picking the folder must start the
     * indexing pass immediately, while Enter AR validation
     * (validateEnterButton) happens FIRST so the pass never delays the gate
     * (non-blocking constraint, 2026-06-05 D5).
     */
    it('starts indexing immediately on folder pick, after Enter AR validation, forwarding progress', async () => {
      let resolveIndex!: (v: ReturnType<typeof indexResult>) => void;
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        () =>
          new Promise((res) => {
            resolveIndex = res;
          })
      );
      const onIndexingProgress = vi.fn();
      const { manager, deps } = createFolderManagerWithDefaults({
        onIndexingProgress,
      });

      const openPromise = manager.handleOpenFolder();
      await vi.waitFor(() =>
        expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalledTimes(1)
      );

      // Enter AR gate was validated before the pass settled.
      expect(deps.validateEnterButton).toHaveBeenCalled();

      const [handleArg, optsArg] = vi.mocked(indexRefPointDefinitionsFromFolder)
        .mock.calls[0]!;
      expect(handleArg).toBe(mockFolderHandle);
      expect(optsArg?.signal).toBeInstanceOf(AbortSignal);

      // Progress events are forwarded to the injected UI callback.
      optsArg!.onProgress!({ done: 1, total: 3 });
      expect(onIndexingProgress).toHaveBeenCalledWith({ done: 1, total: 3 });

      resolveIndex(indexResult([]));
      await openPromise;
    });

    /**
     * Why this test matters:
     * D4a — strict per-scenario routing: each bucket lands in ITS scenario's
     * OPFS directory; nothing is written into other scenarios' stores.
     */
    it('persists each scenario bucket into its own scenario directory', async () => {
      const defA = mkDef('cell-a');
      const defB = mkDef('cell-b');
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([
          ['Paris', [defA]],
          ['Berlin', [defB]],
        ])
      );
      const handles = stubScenarioHandles();
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(getScenarioDirectoryHandle).toHaveBeenCalledWith('Paris', {
        create: true,
      });
      expect(getScenarioDirectoryHandle).toHaveBeenCalledWith('Berlin', {
        create: true,
      });
      expect(vi.mocked(writeRefPointDefinition).mock.calls).toEqual(
        expect.arrayContaining([
          [handles.get('Paris'), defA],
          [handles.get('Berlin'), defB],
        ])
      );
      expect(writeRefPointDefinition).toHaveBeenCalledTimes(2);
    });

    /**
     * Why this test matters:
     * D4b — gap-fill: existing entries are never rewritten; only definitions
     * whose H3 cell is not yet covered (exact or neighbor match) are added.
     */
    it('gap-fills only uncovered cells and never rewrites existing entries', async () => {
      vi.mocked(loadAllRefPoints).mockResolvedValue([mkDef('cell-a')]);
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([
          ['Paris', [mkDef('cell-a', 'Reimported A'), mkDef('cell-c')]],
        ])
      );
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      const written = vi
        .mocked(writeRefPointDefinition)
        .mock.calls.map(([, def]) => def.id);
      expect(written).toEqual(['cell-c']);
    });

    it('skips definitions whose cell neighbor-matches an existing entry', async () => {
      vi.mocked(loadAllRefPoints).mockResolvedValue([mkDef('cell-a')]);
      vi.mocked(h3CellsMatch).mockImplementation(
        (a: string, b: string) =>
          a === b ||
          (a === 'cell-a' && b === 'cell-b') ||
          (a === 'cell-b' && b === 'cell-a')
      );
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([['Paris', [mkDef('cell-b')]]])
      );
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(writeRefPointDefinition).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * D4b-ii — within one pass, the NEWEST definition wins a neighbor-matched
     * cluster. Buckets arrive newest-first from the indexing pass; the
     * acceptance loop must be first-accepted-wins.
     */
    it('writes only the newest definition of a neighbor-matched cluster', async () => {
      vi.mocked(h3CellsMatch).mockImplementation(
        (a: string, b: string) =>
          a === b ||
          (a === 'cell-n1' && b === 'cell-n2') ||
          (a === 'cell-n2' && b === 'cell-n1')
      );
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        // Bucket order is newest-first (pinned by the Slice-1 tests).
        indexResult([
          ['Paris', [mkDef('cell-n1', 'Newest'), mkDef('cell-n2', 'Older')]],
        ])
      );
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      const written = vi
        .mocked(writeRefPointDefinition)
        .mock.calls.map(([, def]) => def.id);
      expect(written).toEqual(['cell-n1']);
    });

    /**
     * Why this test matters:
     * The hint that triggered the import promised "open the recordings folder
     * to recover them" — when the selected scenario gains points, the app must
     * show them right away (store dispatch + status line) and collapse the
     * fulfilled import hint.
     */
    it('refreshes the selected scenario when it gained definitions', async () => {
      const def = mkDef('cell-a');
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([['Paris', [def]]])
      );
      // First call: gap-fill check (empty store). Later calls: the refresh
      // re-load sees the freshly written definition.
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([])
        .mockResolvedValue([def]);
      const scenarioHandle = {
        kind: 'directory',
        name: 'Paris',
      } as unknown as FileSystemDirectoryHandle;
      vi.mocked(setCurrentScenario).mockResolvedValue(scenarioHandle);

      const { manager, deps, store } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');

      await manager.handleOpenFolder();

      expect(setCurrentScenario).toHaveBeenCalledWith('Paris');
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refPoints/setImportedRefPointEntries',
        })
      );
      expect(deps.updateStatus).toHaveBeenCalledWith(
        'Scenario: Paris | 1 ref points (0 observations)'
      );
      expect(deps.setFolderImportExpanded).toHaveBeenCalledWith(false);
    });

    /**
     * Why this test matters:
     * Round-3 option 2 (2026-07-05): the active scenario's points must become
     * visible as soon as ITS bucket is durable — not after every other
     * scenario's bucket has been persisted too. The pass persists the active
     * scenario first and publishes (store dispatch + status + hint collapse)
     * before touching the remaining buckets, and must not refresh a second
     * time at the end of the pass.
     */
    it('publishes the active scenario before persisting the other buckets (early publish)', async () => {
      const defParis = mkDef('cell-p');
      const defBerlin = mkDef('cell-b');
      // Berlin arrives FIRST in the map — the pass must reorder.
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([
          ['Berlin', [defBerlin]],
          ['Paris', [defParis]],
        ])
      );
      // loadAllRefPoints sequence: Paris gap-check (empty) → refresh re-load
      // (has the new def) → Berlin gap-check (empty).
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([defParis])
        .mockResolvedValue([]);
      const scenarioHandle = {
        kind: 'directory',
        name: 'Paris',
      } as unknown as FileSystemDirectoryHandle;
      vi.mocked(setCurrentScenario).mockResolvedValue(scenarioHandle);

      const { manager, store } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');

      await manager.handleOpenFolder();

      // The publish dispatch happened BEFORE Berlin's bucket was written.
      const dispatchMock = store.dispatch as unknown as {
        mock: {
          calls: Array<[{ type?: string }]>;
          invocationCallOrder: number[];
        };
      };
      const publishIdx = dispatchMock.mock.calls.findIndex(
        ([action]) => action?.type === 'refPoints/setImportedRefPointEntries'
      );
      expect(publishIdx).toBeGreaterThanOrEqual(0);
      const publishOrder = dispatchMock.mock.invocationCallOrder[publishIdx]!;

      const writeMock = vi.mocked(writeRefPointDefinition).mock;
      const berlinIdx = writeMock.calls.findIndex(
        ([, def]) => def.id === 'cell-b'
      );
      expect(berlinIdx).toBeGreaterThanOrEqual(0);
      const berlinOrder = writeMock.invocationCallOrder[berlinIdx]!;

      expect(publishOrder).toBeLessThan(berlinOrder);

      // No duplicate refresh at the end of the pass.
      expect(setCurrentScenario).toHaveBeenCalledTimes(1);
    });

    it('does not refresh when the selected scenario gained nothing', async () => {
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([['Paris', [mkDef('cell-a')]]])
      );
      const { manager, deps } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Berlin');

      await manager.handleOpenFolder();

      expect(setCurrentScenario).not.toHaveBeenCalled();
      expect(deps.setFolderImportExpanded).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * Round-3 field report (2026-07-05): the user started a RECORDING while
     * the indexing pass was still running and no ref points ever appeared —
     * despite the "Recovered N…" toast. Root cause: handleStartRecording
     * swaps in a FRESH store whose `scenario` slice is empty (the selection
     * travels only via the session metadata's `contextTag`, Issue #12), so a
     * refresh that reads `scenario.currentScenarioName` from the CURRENT
     * store silently early-returns after the swap. The refresh must fall
     * back to the recording metadata's `contextTag`.
     */
    it('refreshes via the recording metadata contextTag after a mid-pass store swap (recording started while indexing)', async () => {
      const def = mkDef('cell-a');
      let resolveIndex!: (v: ReturnType<typeof indexResult>) => void;
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        () =>
          new Promise((res) => {
            resolveIndex = res;
          })
      );
      // Gap-fill check sees an empty store; the refresh re-load sees the
      // freshly written definition.
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([])
        .mockResolvedValue([def]);
      const scenarioHandle = {
        kind: 'directory',
        name: 'Paris',
      } as unknown as FileSystemDirectoryHandle;
      vi.mocked(setCurrentScenario).mockResolvedValue(scenarioHandle);

      // Boot store: dropdown selection 'Paris' lives in its scenario slice.
      const bootStore = createMockStore();
      let activeStore = bootStore;
      const { manager, deps } = createFolderManagerWithDefaults({
        getStore: () => activeStore,
      });
      manager.setCurrentScenarioName('Paris');

      const openPromise = manager.handleOpenFolder();
      await vi.waitFor(() =>
        expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalled()
      );

      // Recording starts mid-pass: fresh store, EMPTY scenario slice, the
      // scenario carried only in recording.sessionMetadata.contextTag.
      const recordingStore = {
        getState: () => ({
          recording: {
            isRecording: true,
            sessionMetadata: { contextTag: 'Paris', startTime: 123 },
            actionCount: 0,
            failedWriteCount: 0,
          },
          scenario: { currentScenarioName: '' },
          refPoints: { entries: [] },
          gpsData: null,
        }),
        dispatch: vi.fn(),
        subscribe: () => () => {},
      } as unknown as RecorderStore;
      activeStore = recordingStore;

      resolveIndex(indexResult([['Paris', [def]]]));
      await openPromise;

      // The refresh must reach the RECORDING store: entries dispatched, the
      // status line updated, and the fulfilled import hint collapsed.
      expect(setCurrentScenario).toHaveBeenCalledWith('Paris');
      expect(recordingStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refPoints/setImportedRefPointEntries',
        })
      );
      expect(deps.setFolderImportExpanded).toHaveBeenCalledWith(false);
    });

    /**
     * Why this test matters:
     * Single-flight (plan §3.3): a new folder pick replaces the running pass —
     * the old signal must abort (settling as 'aborted', never as an error).
     */
    it('aborts the previous pass when a new folder is picked', async () => {
      const signals: AbortSignal[] = [];
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        (_handle, opts) => {
          signals.push(opts!.signal!);
          return new Promise((res, rej) => {
            opts!.signal!.addEventListener('abort', () =>
              rej(new DOMException('Aborted', 'AbortError'))
            );
            if (signals.length === 2) {
              res(indexResult([]));
            }
          });
        }
      );
      const onIndexingSettled = vi.fn();
      const { manager, deps } = createFolderManagerWithDefaults({
        onIndexingSettled,
      });

      const first = manager.handleOpenFolder();
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      const second = manager.handleOpenFolder();
      await Promise.all([first, second]);

      expect(signals[0]!.aborted).toBe(true);
      expect(onIndexingSettled).toHaveBeenCalledWith({ status: 'aborted' });
      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('surfaces a non-abort failure via showError and the settled callback', async () => {
      vi.mocked(indexRefPointDefinitionsFromFolder).mockRejectedValue(
        new Error('boom')
      );
      const onIndexingSettled = vi.fn();
      const { manager, deps } = createFolderManagerWithDefaults({
        onIndexingSettled,
      });

      await manager.handleOpenFolder();

      expect(deps.showError).toHaveBeenCalledWith(
        expect.stringContaining('boom')
      );
      expect(onIndexingSettled).toHaveBeenCalledWith({
        status: 'error',
        message: 'boom',
      });
    });

    it('reports a success outcome with written count and scan stats', async () => {
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        (_handle, opts) => {
          opts?.onProgress?.({ done: 0, total: 2 });
          opts?.onProgress?.({ done: 2, total: 2 });
          return Promise.resolve(
            indexResult([['Paris', [mkDef('cell-a')]]], 2)
          );
        }
      );
      const onIndexingSettled = vi.fn();
      const { manager } = createFolderManagerWithDefaults({
        onIndexingSettled,
      });

      await manager.handleOpenFolder();

      expect(onIndexingSettled).toHaveBeenCalledWith({
        status: 'success',
        refPointsWritten: 1,
        zipFilesScanned: 2,
        zipFilesTotal: 2,
        errors: [],
      });
    });

    /**
     * Why this test matters:
     * The lazy scenario-change recovery stays as a safety net but must NOT
     * race the eager pass (double-scan, double-write). While a pass is live it
     * no-ops; afterwards it works again.
     */
    it('lazy recovery no-ops while a pass is active and works again afterwards', async () => {
      let resolveIndex!: (v: ReturnType<typeof indexResult>) => void;
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        () =>
          new Promise((res) => {
            resolveIndex = res;
          })
      );
      const scenarioHandle = {
        kind: 'directory',
        name: 'X',
      } as unknown as FileSystemDirectoryHandle;
      vi.mocked(setCurrentScenario).mockResolvedValue(scenarioHandle);

      const { manager } = createFolderManagerWithDefaults();

      const openPromise = manager.handleOpenFolder();
      await vi.waitFor(() =>
        expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalled()
      );

      // Empty OPFS + read folder available would normally trigger the lazy
      // recovery (which itself runs the indexer) — while the eager pass is
      // live it must no-op, so the indexer has run exactly once (the pass).
      await manager.handleScenarioChange('X');
      expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalledTimes(1);

      resolveIndex(indexResult([]));
      await openPromise;

      // …and the lazy safety net works again once the pass has settled.
      vi.mocked(indexRefPointDefinitionsFromFolder).mockResolvedValue(
        indexResult([])
      );
      await manager.handleScenarioChange('X');
      expect(indexRefPointDefinitionsFromFolder).toHaveBeenCalledTimes(2);
    });

    it('reset() aborts an active pass', async () => {
      let signal: AbortSignal | undefined;
      vi.mocked(indexRefPointDefinitionsFromFolder).mockImplementation(
        (_handle, opts) => {
          signal = opts!.signal;
          return new Promise((_res, rej) => {
            opts!.signal!.addEventListener('abort', () =>
              rej(new DOMException('Aborted', 'AbortError'))
            );
          });
        }
      );
      const { manager } = createFolderManagerWithDefaults();

      const openPromise = manager.handleOpenFolder();
      await vi.waitFor(() => expect(signal).toBeDefined());

      manager.reset();

      expect(signal!.aborted).toBe(true);
      await openPromise;
    });
  });
});
