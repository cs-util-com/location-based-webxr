/**
 * Replay Handlers
 *
 * Encapsulates all replay-mode state and event handlers, extracted from
 * main.ts (Finding #7 — main.ts decomposition, replay controller extraction).
 *
 * The factory pattern allows main.ts to inject the `setStore` callback,
 * which is the single cross-cutting dependency: when replay starts,
 * the module-level store in main.ts must be replaced with the replay store
 * (R6 from replay-mode design doc).
 *
 * All other dependencies (UI, file system, replay-mode orchestrator) are
 * imported directly — the same modules they were imported from in main.ts.
 */

import { startReplayMode, type ReplayModeController } from './replay-mode.js';
import {
  listSessionZipsInScenario,
  type SessionEntry,
  type ScenarioSessionMap,
} from '../storage/recording-discovery.js';
import {
  populateReplaySessions,
  updateReplayProgress,
  showReplayControls,
  updatePlayPauseButton,
  updateCameraModeButton,
} from '../ui/replay-ui.js';
import { showError, updateStatus } from '../ui/hud.js';
import { showToast, TOAST_DURATION_ERROR } from '../ui/toast.js';
import { getReadFolderHandle } from '../storage/external-file-storage.js';
import {
  toggleCameraMode,
  getCameraMode,
  getCameraFollower,
  getReplayState,
} from 'gps-plus-slam-app-framework/ar/replay-scene';
import { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import { loadGpsPathFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  createPreviewMap,
  type PreviewMapInstance,
} from '../ui/preview-map.js';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('ReplayHandlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplayHandlersDeps {
  /** Called when replay starts and the module-level store must be replaced (R6). */
  setStore: (store: RecorderStore) => void;
}

export interface ReplayHandlers {
  // Event handlers
  handleReplayScenarioChange(scenarioName: string): Promise<void>;
  handleReplaySessionSelect(index: number): Promise<void>;
  handleStartReplay(speedFactor: number): Promise<void>;
  /** Replay a specific recording directly (map-browser single-tour playback). */
  startReplayForEntry(entry: SessionEntry, speedFactor?: number): Promise<void>;
  handleReplayPlayPause(): void;
  handleReplaySpeedChange(speed: number): void;
  handleReplayCameraToggle(): void;
  handleReplayMapToggle(): void;
  handleReplayMapZoomIn(): void;
  handleReplayMapZoomOut(): void;

  // State accessors
  getSessionEntries(): SessionEntry[];
  getSelectedSessionIndex(): number;
  getIsReplayMode(): boolean;
  setIsReplayMode(value: boolean): void;
  setReplayZipScenariosCache(cache: ScenarioSessionMap): void;

  // Lifecycle
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createReplayHandlers(deps: ReplayHandlersDeps): ReplayHandlers {
  // --- State ---
  let isReplayMode = false;
  let replayController: ReplayModeController | null = null;
  let replaySessionEntries: SessionEntry[] = [];
  let selectedReplaySessionIndex = -1;
  let replayZipScenariosCache: ScenarioSessionMap = new Map();
  let mapOverlay: LeafletMapOverlay | null = null;
  let previewMap: PreviewMapInstance | null = null;

  // --- Handlers ---

  async function handleReplayScenarioChange(
    scenarioName: string
  ): Promise<void> {
    const folderHandle = getReadFolderHandle();
    if (!folderHandle || !scenarioName) {
      populateReplaySessions([]);
      return;
    }

    try {
      // Try directory-based session listing (existing two-level hierarchy)
      let dirSessions: SessionEntry[] = [];
      try {
        const scenarioHandle =
          await folderHandle.getDirectoryHandle(scenarioName);
        dirSessions = await listSessionZipsInScenario(scenarioHandle);
      } catch (err) {
        // Expected: directory doesn't exist for metadata-only scenarios.
        // Re-throw unexpected errors (permission issues, bugs in listing logic).
        const isNotFound =
          err instanceof DOMException && err.name === 'NotFoundError';
        if (!isNotFound) {
          throw err;
        }
      }

      // Get metadata-discovered sessions from cache
      const cacheSessions = replayZipScenariosCache.get(scenarioName) ?? [];

      // Merge and deduplicate by filename
      const seenFilenames = new Set<string>();
      const allSessions: SessionEntry[] = [];
      for (const s of [...dirSessions, ...cacheSessions]) {
        if (!seenFilenames.has(s.filename)) {
          seenFilenames.add(s.filename);
          allSessions.push(s);
        }
      }
      allSessions.sort((a, b) => b.filename.localeCompare(a.filename));

      replaySessionEntries = allSessions;
      populateReplaySessions(
        allSessions.map((s) => ({ filename: s.filename, date: s.date }))
      );
      log.info(
        `Found ${allSessions.length} session(s) in scenario "${scenarioName}"`
      );
    } catch (err) {
      log.error('Failed to list sessions:', err);
      replaySessionEntries = [];
      populateReplaySessions([]);
      showToast('Failed to list sessions — see logs', { severity: 'error' });
    }
  }

  async function handleReplaySessionSelect(index: number): Promise<void> {
    selectedReplaySessionIndex = index;

    // Load GPS path and show preview map (Issue #1, 2026-03-23)
    const session = replaySessionEntries[index];
    if (!session) {
      return;
    }

    try {
      const file = await session.fileHandle.getFile();
      const gpsPath = await loadGpsPathFromBlob(file);

      // Destroy previous preview map before creating a new one
      if (previewMap) {
        previewMap.destroy();
        previewMap = null;
      }

      const container = document.getElementById('replay-preview-map');
      if (gpsPath.length > 0 && container) {
        previewMap = createPreviewMap(container, gpsPath);
        if (previewMap) {
          container.classList.remove('hidden');
        }
      } else if (container) {
        container.classList.add('hidden');
      }
    } catch (err) {
      log.warn('Failed to load GPS preview:', err);
    }
  }

  async function handleStartReplay(speedFactor: number): Promise<void> {
    const session = replaySessionEntries[selectedReplaySessionIndex];
    if (!session) {
      showError('No session selected.');
      return;
    }
    await startReplayOfSession(session, speedFactor);
  }

  /**
   * Start a replay of a specific recording, bypassing the dropdown/list
   * selection. Used by the map-centric browser (D3 single-tour playback) to
   * play the tour the user picked on the map directly.
   */
  async function startReplayForEntry(
    entry: SessionEntry,
    speedFactor = 1
  ): Promise<void> {
    await startReplayOfSession(entry, speedFactor);
  }

  async function startReplayOfSession(
    session: SessionEntry,
    speedFactor: number
  ): Promise<void> {
    log.info(`Starting replay of "${session.filename}" at ${speedFactor}x...`);
    updateStatus('Loading session...');

    try {
      // Read zip bytes from file handle
      const file = await session.fileHandle.getFile();
      const zipData = new Uint8Array(await file.arrayBuffer());

      // Get the app container for the Three.js canvas
      const container = document.getElementById('app')!;

      // Hide setup modal
      document.getElementById('setup-modal')?.classList.add('hidden');

      // Initialize replay via orchestrator (R6, R7, R8)
      replayController = await startReplayMode(zipData, {
        container,
        onProgress: (current: number, total: number) => {
          updateReplayProgress(current, total);
        },
        onComplete: () => {
          updatePlayPauseButton('completed');
          updateStatus('Replay complete');
          showToast('✅ Replay complete', { severity: 'info' });
          log.info('Replay complete');
        },
        onError: (actionIndex: number, error: Error) => {
          showToast(`Action ${actionIndex} failed: ${error.message}`, {
            severity: 'error',
            duration: TOAST_DURATION_ERROR,
          });
        },
      });

      // R6: Replace module-level store via injected callback
      deps.setStore(replayController.getStore());

      // Show playback controls and start replay
      showReplayControls();
      updatePlayPauseButton('playing');
      updateReplayProgress(0, replayController.getActionCount());
      updateStatus(`Replaying: ${session.filename}`);

      // Start playback (don't await — UI controls need to be responsive)
      void replayController.play(speedFactor);
    } catch (err) {
      log.error('Failed to start replay:', err);
      showError('Failed to start replay — see logs');
    }
  }

  function handleReplayPlayPause(): void {
    if (!replayController) {
      return;
    }

    const state = replayController.getState();
    if (state === 'playing') {
      replayController.pause();
      updatePlayPauseButton('paused');
      updateStatus('Replay paused');
    } else if (state === 'paused') {
      void replayController.resume();
      updatePlayPauseButton('playing');
      updateStatus('Replaying...');
    }
  }

  function handleReplaySpeedChange(speed: number): void {
    replayController?.setSpeed(speed);
    log.info(`Replay speed changed to ${speed}x`);
  }

  function handleReplayCameraToggle(): void {
    toggleCameraMode();
    updateCameraModeButton(getCameraMode());
  }

  function handleReplayMapToggle(): void {
    if (!replayController) {
      return;
    }

    // Lazily create the map overlay on first toggle
    if (!mapOverlay) {
      const sceneState = getReplayState();
      if (!sceneState) {
        log.warn('Cannot create map overlay — replay scene not initialized');
        return;
      }

      const follower = getCameraFollower();
      mapOverlay = new LeafletMapOverlay(sceneState.scene, sceneState.camera, {
        mapParent: follower ?? undefined,
      });

      // Set initial GPS position from store state
      const state = replayController.getStore().getState();
      const lastGpsPoint =
        state.gpsData?.gpsEvents?.gpsPositions?.at(-1) ?? null;
      if (lastGpsPoint) {
        mapOverlay.setGpsPosition(
          lastGpsPoint.latitude,
          lastGpsPoint.longitude
        );
      }

      // Register with controller so store subscribers can update the map
      replayController.setMapOverlay(mapOverlay);
      log.info('Map overlay created lazily for replay mode');
    }

    mapOverlay.toggle();
    log.info(
      `Replay map overlay ${mapOverlay.isVisible() ? 'shown' : 'hidden'}`
    );
  }

  function handleReplayMapZoomIn(): void {
    mapOverlay?.zoomIn();
  }

  function handleReplayMapZoomOut(): void {
    mapOverlay?.zoomOut();
  }

  // --- State accessors ---

  function getSessionEntries(): SessionEntry[] {
    return replaySessionEntries;
  }

  function getSelectedSessionIndex(): number {
    return selectedReplaySessionIndex;
  }

  function getIsReplayMode(): boolean {
    return isReplayMode;
  }

  function setIsReplayMode(value: boolean): void {
    isReplayMode = value;
  }

  function setReplayZipScenariosCache(cache: ScenarioSessionMap): void {
    replayZipScenariosCache = cache;
  }

  function reset(): void {
    isReplayMode = false;
    if (replayController) {
      replayController.dispose();
      replayController = null;
    }
    replaySessionEntries = [];
    selectedReplaySessionIndex = -1;
    replayZipScenariosCache = new Map();
    if (previewMap) {
      previewMap.destroy();
      previewMap = null;
    }
    if (mapOverlay) {
      mapOverlay.dispose();
      mapOverlay = null;
    }
  }

  return {
    handleReplayScenarioChange,
    handleReplaySessionSelect,
    handleStartReplay,
    startReplayForEntry,
    handleReplayPlayPause,
    handleReplaySpeedChange,
    handleReplayCameraToggle,
    handleReplayMapToggle,
    handleReplayMapZoomIn,
    handleReplayMapZoomOut,
    getSessionEntries,
    getSelectedSessionIndex,
    getIsReplayMode,
    setIsReplayMode,
    setReplayZipScenariosCache,
    reset,
  };
}
