/**
 * Replay Mode Orchestrator
 *
 * Wires together all replay building blocks from Iterations 1-5 into
 * a single entry point. Creates the store, scene, subscribers, and
 * engine, then returns a controller for UI integration.
 *
 * Key risks addressed:
 * - R6: Store identity — the same store is passed to wireStoreSubscribers
 *   and the ReplayEngine so dispatched actions trigger visualization updates.
 * - R7: Error handling — onError callback is wired from config to the engine.
 * - R8: Data flow — zip bytes → loadActionsFromZip → actions → engine.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md Iteration 6
 */

import {
  createRecorderStore,
  type RecorderStore,
} from '../state/recorder-store';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  ReplayEngine,
  type ReplayAction,
  type ReplayState,
} from 'gps-plus-slam-app-framework/state/replay-engine';
import {
  initReplayScene,
  disposeReplayScene,
  updateOrbitTarget,
  getAlignmentLerper,
} from 'gps-plus-slam-app-framework/ar/replay-scene';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';
import { wireRefPointSubscribers } from '../state/ref-point-subscribers';
import { wireRefPointMapMarkers } from '../ui/ref-point-map-markers';
import type { Map as LeafletMap } from 'leaflet';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import {
  nueToWebXR,
  nueQuaternionToWebXR,
} from 'gps-plus-slam-app-framework/ar/nue-webxr-conversions';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { loadRecording } from '../storage/recording-loader.js';
import { createStoreRef } from '../state/store-ref';
import { loadRecordingOptions } from '../state/recording-options';
import { createZipFrameBlobSource } from '../storage/zip-frame-blob-source';
import { wireFrameTileStack } from '../visualization/frame-tile-stack';
import {
  wireOccupancyStack,
  type OccupancyStackHandle,
} from '../visualization/occupancy-stack';
import {
  createPerfStatsOverlay,
  type PerfStatsOverlayHandle,
} from 'gps-plus-slam-app-framework/visualization/perf-stats-overlay';
import * as THREE from 'three';

const log = createLogger('ReplayMode');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplayModeConfig {
  /** DOM container for the Three.js canvas */
  container: HTMLElement;
  /** Called after each action dispatch: (current, total) */
  onProgress: (current: number, total: number) => void;
  /** Called when all actions have been dispatched */
  onComplete: () => void;
  /** Called when a dispatch error occurs: (message) */
  onError: (actionIndex: number, error: Error) => void;
}

/**
 * Subset of the recorder's `LeafletMapOverlay` API that replay mode forwards
 * GPS updates to. Declared structurally (instead of importing the concrete
 * type) so replay mode stays decoupled from the live recorder map.
 * `getLeafletMap` hands the underlying Leaflet map to the store-driven
 * ref-point marker wirer (2026-07-05 live-map feedback).
 */
interface ReplayMapOverlay {
  setGpsPosition: (lat: number, lon: number) => void;
  render?: (data: MapData) => void;
  getLeafletMap?: () => LeafletMap | null;
}

export interface ReplayModeController {
  /** Start dispatching actions at the given speed factor */
  play(speedFactor: number): Promise<void>;
  /** Pause the replay */
  pause(): void;
  /** Resume from where we paused */
  resume(): Promise<void>;
  /** Change playback speed (takes effect on next delay) */
  setSpeed(factor: number): void;
  /** Get the current engine state */
  getState(): ReplayState;
  /** Get the underlying ReplayEngine */
  getEngine(): ReplayEngine;
  /** Get the replay store (R6: same instance used by subscribers) */
  getStore(): RecorderStore;
  /** Get the total number of loaded actions */
  getActionCount(): number;
  /** Set or clear the map overlay for GPS position updates via store subscribers */
  setMapOverlay(overlay: ReplayMapOverlay | null): void;
  /** Dispose all resources (scene, engine, subscribers) */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize replay mode: load actions from zip, create store + scene +
 * subscribers + engine, and return a controller.
 *
 * @param zipData - Raw zip file bytes
 * @param config - UI callbacks and container element
 * @returns Controller for driving replay from the UI
 */
export async function startReplayMode(
  zipData: Uint8Array,
  config: ReplayModeConfig
): Promise<ReplayModeController> {
  log.info('Starting replay mode...');

  // R8: Load + migrate the recording through the canonical version-transparent
  // loader. `loadRecording` parses session metadata, migrates actions to the
  // current schema, and exposes a memoised final state — replay only needs
  // the migrated action list, which it forwards to the ReplayEngine.
  const recording = await loadRecording(zipData);
  const actions: ReplayAction[] = recording.actions.map((e) => e.action);
  log.info(`Loaded ${actions.length} actions from zip`);

  // Create store with NullStorageBackend (no persistence side effects).
  //
  // Compass opt-ins are DISABLED for replay: the framework would otherwise
  // re-derive them from its defaults (cold-start override defaults ON) and
  // auto-dispatch `setColdStartOverrideEnabled(true)` on the first replayed
  // `setZeroPos`, enabling an override a §6a calibration capture was recorded
  // WITHOUT. Replay's source of truth is the recorded action stream alone: a
  // session recorded WITH the override on carries the
  // `setColdStartOverrideEnabled(true)` action, which replay re-applies AFTER the
  // `false` below (the framework's opt-in fires on the first `setZeroPos`, the
  // recorded action comes later in the stream), so both cases replay faithfully.
  //
  // The `false` is load-bearing and must stay explicit. Since gps-plus-slam-js
  // 1.16.0 the LIBRARY default is `true`, so "pass nothing" no longer means off —
  // and until 2026-07-26 the framework only dispatched on `true`, which made this
  // `false` a silent no-op that replayed old captures WITH an override they never
  // had. The framework now dispatches the value explicitly; see the invariant in
  // `create-slam-app-store.ts.md`.
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
    enableCompassColdStartOverride: false,
    enableCompassRotationPrior: false,
    enableCompassWebXRConsistency: false,
  });

  // Initialize Three.js replay scene (no WebXR)
  const replaySceneState = initReplayScene(config.container);
  log.info('Replay scene initialized');

  // The replay scene OWNS its scene graph (surface-reduction step 2 — the
  // old webxr-session setScene/setArWorldGroup injection is gone), so the
  // scene-reading singleton visualizers wired below must be pointed at the
  // replay references explicitly. dispose() restores the live-session
  // defaults so a later AR session parents markers correctly again.
  gpsEventVisualizer.setSceneSource({
    getScene: () => replaySceneState.scene,
    getArWorldGroup: () => replaySceneState.arWorldGroup,
  });
  refPointVisualizer.setSceneSource(() => replaySceneState.scene);

  // F3.5 — frame tiles for add2dImage actions, so the 2D camera frames
  // recorded during the original session reappear as textured planes in the
  // replay scene (visualization/frame-tile-stack.ts — the same stack as
  // live). Failure here (e.g. zip lacks a frames/ subdir) must not crash
  // replay, so the wire-up is best-effort. No tile cap in replay (full-path
  // coverage, Step 4); the display divisor is re-read per replay so an old
  // recording renders at the current setting (D7-resolution).
  let disposeFrameTiles: (() => void) | null = null;
  try {
    disposeFrameTiles = wireFrameTileStack({
      arWorldGroup: replaySceneState.arWorldGroup,
      storeRef: createStoreRef(store),
      blobSource: await createZipFrameBlobSource(zipData),
      divisor: loadRecordingOptions().frameTileDisplay.divisor,
    });
  } catch (err) {
    log.warn(
      'Frame tile visualizer wiring skipped; replay continues without frame tiles',
      err
    );
  }

  // Occupancy stack — recordDepthSample actions re-dispatched during replay
  // rebuild the voxel grid in the replay scene (port plan Iter 5), through
  // the same stack as live (visualization/occupancy-stack.ts), at the user's
  // CURRENT settings: re-quantizable per replay without re-capturing
  // (2026-06-13 occupancy-grid-settings review, item 1; the depth cadence
  // likewise, 2026-06-22 plan §2). Recordings made before intrinsics capture
  // carry no projectionMatrix, so their samples are skipped and the grid
  // simply stays empty. Live occlusion is live-AR-only (replay has no depth
  // stream); the stack honours only the persistent flag. Best-effort like the
  // frame tiles above — `loadRecordingOptions` is self-defending (validated
  // default on any storage error).
  let occupancyStack: OccupancyStackHandle | null = null;
  try {
    const replayOptions = loadRecordingOptions();
    occupancyStack = wireOccupancyStack({
      arWorldGroup: replaySceneState.arWorldGroup,
      storeRef: createStoreRef(store),
      occupancy: replayOptions.occupancy,
      depthIntervalMs: replayOptions.depth.intervalMs,
      showCubes: true,
      logContext: 'during replay',
    });
  } catch (err) {
    log.warn(
      'Occupancy grid wiring skipped; replay continues without depth cubes',
      err
    );
  }

  // Perf stats overlay (visualization.statsOverlay — Step 0 of the 2026-07-03
  // long-session fps plan; the one visualization toggle that ALSO applies to
  // replay, since replay frame time matters for the same investigation). The
  // replay scene's render loop is module-private in the framework, so the
  // panels are advanced by their own rAF loop — rAF fires once per browser
  // frame, so the measured cadence equals the replay render cadence.
  // Best-effort like the visualizers above.
  let statsOverlay: PerfStatsOverlayHandle | null = null;
  let statsRafId: number | null = null;
  try {
    if (loadRecordingOptions().visualization.statsOverlay) {
      statsOverlay = createPerfStatsOverlay(config.container);
      const statsTick = (): void => {
        statsOverlay?.update();
        statsRafId = requestAnimationFrame(statsTick);
      };
      statsRafId = requestAnimationFrame(statsTick);
    }
  } catch (err) {
    log.warn('Stats overlay skipped; replay continues without it', err);
  }

  // Get the alignment lerper (Issue 4) — store subscribers route alignment
  // updates through the lerper for smooth interpolation instead of snapping.
  const alignmentLerper = getAlignmentLerper();

  // Map overlay proxy — delegates to a late-bound real overlay so the
  // store subscriber can update the map even though it is created later.
  let mapOverlayTarget: ReplayMapOverlay | null = null;
  const mapOverlayProxy = {
    setGpsPosition(lat: number, lon: number): void {
      mapOverlayTarget?.setGpsPosition(lat, lon);
    },
    render(data: MapData): void {
      mapOverlayTarget?.render?.(data);
    },
  };

  // R6: Wire store subscribers with THE SAME store the engine will dispatch to.
  // This ensures dispatched replay actions trigger visualization updates.
  //
  // NOTE: onNewGpsPosition is intentionally omitted. The onNewOdomPose
  // callback updates arpose with the recorded trajectory pose, but it no
  // longer drives the orbit target. Instead, onAlignmentSnapshot (Issue #3)
  // updates the orbit target only when alignment snapshots are created,
  // centering the orbit camera on the system's best-estimate GPS position.
  const unsubscribe = wireStoreSubscribers(store, {
    applyAlignmentMatrix: (matrix) => alignmentLerper?.setTarget(matrix),
    gpsEventVisualizer,
    mapOverlay: mapOverlayProxy, // Proxy delegates to real overlay once set via setMapOverlay()
    // 6.2: Update arpose Object3D with recorded odom pose during replay.
    // The arpose node sits between arWorldGroup and camera; writing the
    // recorded pose here makes the camera follow the recorded trajectory
    // while user controls only affect the camera's local offset. The node is
    // the replay scene's OWN arpose (initReplayScene return) — webxr-session's
    // getArPose was deleted with the rest of the replay injection surface.
    onNewOdomPose: (odomPosition, odomRotation) => {
      const arpose = replaySceneState.arpose;
      // Convert NUE→WebXR so (alignment × W2N) × WebXR_pos = alignment × NUE_pos
      const webxrPos = nueToWebXR(odomPosition);
      arpose.position.fromArray(webxrPos);
      // Rotation is now NUE in state — convert back to WebXR for arpose
      // (arpose sits below basisChangeNode in WebXR-local space)
      const webxrRot = nueQuaternionToWebXR(odomRotation);
      arpose.quaternion.fromArray(webxrRot);
    },
    // Issue #3: Update orbit target when alignment snapshots are created.
    // The snapshot NUE position is in scene-root space (A_k × p_k), so it
    // can be passed directly to updateOrbitTarget.
    onAlignmentSnapshot: (() => {
      const snapshotPos = new THREE.Vector3();
      return (nuePosition: readonly number[]) => {
        snapshotPos.fromArray(nuePosition);
        updateOrbitTarget(snapshotPos);
      };
    })(),
  });
  const unsubscribeRefPoints = wireRefPointSubscribers(
    store,
    refPointVisualizer
  );
  // 2026-07-05 live-map feedback: replay's minimap renders the refPoints
  // state through the SAME shared renderer as the live and summary maps.
  // Late binding — the overlay attaches via setMapOverlay (which refreshes);
  // the replayed startSession action carries the ORIGINAL session's start
  // time, so its captures render red and imported sidecar points green.
  const refPointMapMarkers = wireRefPointMapMarkers(store, {
    getMap: () => mapOverlayTarget?.getLeafletMap?.() ?? null,
    getStartTime: () =>
      store.getState().recording.sessionMetadata?.startTime ??
      Number.MAX_SAFE_INTEGER,
    // F5-A (2026-06-05): in-AR map markers are enlarged for readability.
    dotSizePx: 20,
  });

  // Create and configure the replay engine
  const engine = new ReplayEngine();
  engine.onProgress(config.onProgress);
  engine.onComplete(config.onComplete);
  engine.onError(config.onError);

  let disposed = false;

  const controller: ReplayModeController = {
    play(speedFactor: number): Promise<void> {
      if (disposed) {
        return Promise.resolve();
      }
      return engine.play(actions, store, speedFactor);
    },

    pause(): void {
      engine.pause();
    },

    resume(): Promise<void> {
      return engine.resume();
    },

    setSpeed(factor: number): void {
      engine.setSpeed(factor);
    },

    getState(): ReplayState {
      return engine.getState();
    },

    getEngine(): ReplayEngine {
      return engine;
    },

    getStore(): RecorderStore {
      return store;
    },

    getActionCount(): number {
      return actions.length;
    },

    setMapOverlay(overlay: ReplayMapOverlay | null): void {
      mapOverlayTarget = overlay;
      // Late binding: render the current refPoints state onto the
      // just-attached map (or clear the markers when detaching).
      refPointMapMarkers.refresh();
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;

      engine.dispose();
      unsubscribe();
      unsubscribeRefPoints();
      refPointMapMarkers.unsubscribe();
      disposeFrameTiles?.();
      occupancyStack?.dispose();
      occupancyStack = null;
      if (statsRafId !== null) {
        cancelAnimationFrame(statsRafId);
        statsRafId = null;
      }
      statsOverlay?.dispose();
      // Restore the live-session scene sources BEFORE the replay scene is
      // torn down so no visualizer can parent a marker into a disposed scene,
      // and a later live AR session gets the default wiring back.
      gpsEventVisualizer.setSceneSource(null);
      refPointVisualizer.setSceneSource(null);
      disposeReplayScene();
      log.info('Replay mode disposed');
    },
  };

  return controller;
}
