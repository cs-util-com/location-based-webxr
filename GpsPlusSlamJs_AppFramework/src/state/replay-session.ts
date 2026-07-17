/**
 * Replay session — the framework-level composer that lets ANY consumer app
 * replay a recorded session on the desktop (no phone, no WebXR) with live mesh
 * reconstruction, in a handful of lines.
 *
 * It wires together the pieces that already exist so a consumer does not have to
 * copy the RecorderApp's `replay/replay-mode.ts` orchestrator:
 *   - a store (a fresh framework store by default, or one the caller injects),
 *   - the non-WebXR desktop scene (`initReplayScene`),
 *   - the shared state→visuals bridge (`wireStoreSubscribers`: alignment lerp +
 *     GPS event markers + the recorded camera trajectory driving `arpose`),
 *   - the occupancy grid → cube visualizer + occlusion mesh path, fed by the
 *     replayed `recordDepthSample` stream (`subscribeReplayOccupancy`),
 *   - a {@link ReplayEngine} driving the recorded action list.
 *
 * The consumer supplies an already-loaded `RecordedAction[]` (the loader stays a
 * consumer concern — the framework does not migrate old-era recordings). For a
 * current-era zip, `loadActionsFromZip` (storage/zip-reader) turns it into the
 * action list with zero recorder-side code.
 *
 * Recorder-specific visualizers (frame tiles, ref-point spheres/markers, stats
 * overlay) are NOT wired here — the RecorderApp injects those into its own
 * orchestrator. This composer ships only the generally-useful defaults every
 * replay consumer wants.
 *
 * @see replay-session.ts.md for the full API and examples.
 * @see 2026-07-15 replay-as-dev-harness Part A design.
 */

import * as THREE from 'three';
import {
  createSlamAppStore,
  type SlamAppStore,
} from './create-slam-app-store.js';
import { NullStorageBackend } from '../storage/null-storage-backend.js';
import {
  ReplayEngine,
  type ReplayAction,
  type ReplayState,
} from './replay-engine.js';
import {
  initReplayScene,
  disposeReplayScene,
  updateOrbitTarget,
  getAlignmentLerper,
} from '../ar/replay-scene.js';
import { wireStoreSubscribers } from './store-subscribers.js';
import { gpsEventVisualizer } from '../visualization/gps-event-markers.js';
import { OccupancyGrid } from '../ar/occupancy-grid.js';
import { OccupancyCubesVisualizer } from '../visualization/occupancy-cubes-visualizer.js';
import { OcclusionMesh } from '../visualization/occlusion-mesh.js';
import { subscribeReplayOccupancy } from './replay-occupancy-subscriber.js';
import {
  nuePositionToWebXR,
  nueQuaternionToWebXR,
} from '../ar/webxr-session.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ReplaySession');

/** Occupancy-reconstruction options for a replay session. */
export interface ReplayOccupancyConfig {
  /** Build the occupancy grid + visualizers at all. Default `true`. */
  readonly enabled?: boolean;
  /** Voxel edge length in metres. Default 0.15. */
  readonly cellSizeM?: number;
  /** Minimum observations before a cell is drawn (noise filter). Default 1. */
  readonly minObservations?: number;
  /** Show the instanced debug cubes. Default `true`. */
  readonly showCubes?: boolean;
  /**
   * Build the depth-only occlusion mesh (detailed style). Default `true`. Its
   * visible skin starts `off` (invisible depth-only); a consumer flips it via
   * {@link ReplaySessionController.getOcclusionMesh}`.setDebugStyle(...)`.
   */
  readonly showOcclusionMesh?: boolean;
  /** Minimum delay between two visualizer refreshes (ms). Default 250. */
  readonly refreshIntervalMs?: number;
}

export interface StartReplaySessionOptions {
  /** The already-loaded recorded action list to replay. */
  readonly actions: ReplayAction[];
  /** DOM element that receives the desktop replay canvas. */
  readonly container: HTMLElement;
  /**
   * Store to replay into. Defaults to a fresh framework store with no
   * persistence (`NullStorageBackend`). Inject one only to add app-specific
   * slices; it MUST carry the framework recording slice.
   */
  readonly store?: SlamAppStore;
  /** Occupancy reconstruction config (see {@link ReplayOccupancyConfig}). */
  readonly occupancy?: ReplayOccupancyConfig;
  /** Called after each action dispatch: (current, total). */
  readonly onProgress?: (current: number, total: number) => void;
  /** Called when all actions have been dispatched. */
  readonly onComplete?: () => void;
  /** Called when a dispatch throws: (actionIndex, error). */
  readonly onError?: (actionIndex: number, error: Error) => void;
}

/** Handles to the replay scene graph (for adding consumer content). */
export interface ReplaySceneHandles {
  readonly scene: THREE.Scene;
  readonly arWorldGroup: THREE.Group;
  readonly arpose: THREE.Object3D;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
}

export interface ReplaySessionController {
  /** Start dispatching actions at the given speed factor (default 1). */
  play(speedFactor?: number): Promise<void>;
  /** Pause the replay. */
  pause(): void;
  /** Resume from where we paused. */
  resume(): Promise<void>;
  /** Change playback speed (takes effect on the next delay). */
  setSpeed(factor: number): void;
  /** Current engine state. */
  getState(): ReplayState;
  /** The replay store (same instance the subscribers observe). */
  getStore(): SlamAppStore;
  /** The replay scene graph handles. */
  getScene(): ReplaySceneHandles;
  /** The reconstructed occupancy grid, or `null` when occupancy is disabled. */
  getOccupancyGrid(): OccupancyGrid | null;
  /** The cube visualizer, or `null` when disabled/not built (for a live mesh-view toggle). */
  getCubesVisualizer(): OccupancyCubesVisualizer | null;
  /** The occlusion mesh, or `null` when disabled/not built. */
  getOcclusionMesh(): OcclusionMesh | null;
  /** Total number of loaded actions. */
  getActionCount(): number;
  /** Tear down engine, subscribers, visualizers and the scene. */
  dispose(): void;
}

/**
 * Compose and start a desktop replay session. Synchronous — the caller drives
 * playback via the returned controller.
 */
export function startReplaySession(
  options: StartReplaySessionOptions
): ReplaySessionController {
  const { actions, container } = options;
  const occupancyConfig = options.occupancy ?? {};
  const occupancyEnabled = occupancyConfig.enabled ?? true;

  const store =
    options.store ??
    createSlamAppStore({
      storageBackend: new NullStorageBackend(),
      // High-throughput replay: skip RTK's expensive dev-only checks.
      enableDevChecks: false,
    });

  const scene = initReplayScene(container);
  log.info('Replay scene initialized');

  // Point the framework's GPS-event marker singleton at the replay scene (it is
  // scene-source-driven, like the RecorderApp's replay path); dispose() restores
  // the live default so a later AR session parents markers correctly again.
  gpsEventVisualizer.setSceneSource({
    getScene: () => scene.scene,
    getArWorldGroup: () => scene.arWorldGroup,
  });

  const alignmentLerper = getAlignmentLerper();

  // Shared state→visuals bridge. Alignment lerps smoothly; the recorded odom
  // pose drives `arpose` so the orbit camera follows the recorded trajectory;
  // alignment snapshots recentre the orbit target.
  const snapshotPos = new THREE.Vector3();
  const unsubscribeStore = wireStoreSubscribers(store, {
    applyAlignmentMatrix: (matrix) => alignmentLerper?.setTarget(matrix),
    gpsEventVisualizer,
    onNewOdomPose: (odomPosition, odomRotation) => {
      const webxrPos = nuePositionToWebXR(odomPosition);
      scene.arpose.position.fromArray(webxrPos);
      const webxrRot = nueQuaternionToWebXR(odomRotation);
      scene.arpose.quaternion.fromArray(webxrRot);
    },
    onAlignmentSnapshot: (nuePosition) => {
      snapshotPos.fromArray(nuePosition);
      updateOrbitTarget(snapshotPos);
    },
  });

  // Occupancy reconstruction (grid → cubes + occlusion mesh) is a self-contained
  // unit so this composer stays flat; see setupOccupancyReconstruction below.
  const occupancy = occupancyEnabled
    ? setupOccupancyReconstruction(store, scene.arWorldGroup, occupancyConfig)
    : null;

  const engine = new ReplayEngine();
  if (options.onProgress) engine.onProgress(options.onProgress);
  if (options.onComplete) engine.onComplete(options.onComplete);
  if (options.onError) engine.onError(options.onError);

  let disposed = false;

  return {
    play(speedFactor = 1): Promise<void> {
      if (disposed) return Promise.resolve();
      return engine.play(actions, store, speedFactor);
    },
    pause(): void {
      engine.pause();
    },
    resume(): Promise<void> {
      if (disposed) return Promise.resolve();
      return engine.resume();
    },
    setSpeed(factor: number): void {
      engine.setSpeed(factor);
    },
    getState(): ReplayState {
      return engine.getState();
    },
    getStore(): SlamAppStore {
      return store;
    },
    getScene(): ReplaySceneHandles {
      return scene;
    },
    getOccupancyGrid(): OccupancyGrid | null {
      return occupancy?.grid ?? null;
    },
    getCubesVisualizer(): OccupancyCubesVisualizer | null {
      return occupancy?.cubes ?? null;
    },
    getOcclusionMesh(): OcclusionMesh | null {
      return occupancy?.occlusionMesh ?? null;
    },
    getActionCount(): number {
      return actions.length;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      engine.dispose();
      unsubscribeStore();
      occupancy?.dispose();
      // Restore the live-session scene source BEFORE tearing the scene down so a
      // later AR session gets the default marker wiring back.
      gpsEventVisualizer.setSceneSource(null);
      disposeReplayScene();
      log.info('Replay session disposed');
    },
  };
}

/** The occupancy grid + its visualizers + their combined teardown. */
interface OccupancyReconstruction {
  readonly grid: OccupancyGrid;
  readonly cubes: OccupancyCubesVisualizer | null;
  readonly occlusionMesh: OcclusionMesh | null;
  dispose(): void;
}

/**
 * Build the occupancy grid, the (optional) cube visualizer + occlusion mesh, and
 * the depth-sample subscription that refreshes them. Kept out of the main
 * composer so its branches don't inflate that function's complexity.
 */
function setupOccupancyReconstruction(
  store: SlamAppStore,
  arWorldGroup: THREE.Object3D,
  config: ReplayOccupancyConfig
): OccupancyReconstruction {
  const cellSizeM = config.cellSizeM ?? 0.15;
  const minObservations = config.minObservations ?? 1;
  const grid = new OccupancyGrid({ cellSizeM });
  const cubes =
    (config.showCubes ?? true)
      ? new OccupancyCubesVisualizer(arWorldGroup, { minObservations })
      : null;
  const occlusionMesh =
    (config.showOcclusionMesh ?? true) ? new OcclusionMesh(arWorldGroup) : null;

  const unsubscribe = subscribeReplayOccupancy({
    store,
    grid,
    refreshIntervalMs: config.refreshIntervalMs,
    onRefresh: (viewerPose) => {
      cubes?.refresh(grid, viewerPose);
      occlusionMesh?.update(
        grid.getOccupiedCells(minObservations),
        cellSizeM,
        (cell) => grid.getCellPoint(cell)
      );
    },
    onError: (err) => log.warn('Occupancy refresh failed during replay', err),
  });

  return {
    grid,
    cubes,
    occlusionMesh,
    dispose(): void {
      unsubscribe();
      cubes?.dispose();
      occlusionMesh?.dispose();
    },
  };
}
