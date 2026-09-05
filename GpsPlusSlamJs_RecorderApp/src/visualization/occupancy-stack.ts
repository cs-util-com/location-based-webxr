/**
 * The occupancy stack - grid + optional debug cubes + optional persistent
 * occluder + the store wiring that feeds them - built ONCE for the live AR
 * scene (`ar/wire-ar-scene.ts`) and for the replay scene
 * (`replay/replay-mode.ts`).
 *
 * Until 2026-09-04 the two call sites each built this inline, and the replay
 * copy kept parity with the live one through four "parity with main.ts"
 * comments that pointed at a file the live wiring had already left. The two
 * sites differ in exactly two inputs, and those are parameters here: whether
 * the debug cubes render (live: the `occupancyCubes` toggle; replay: always,
 * so a recording can be inspected), and the log context. Everything else -
 * the carve threshold, the cube noise floor, the occluder factory, the
 * refresh throttle tied to the depth cadence and the camera-move epsilon - is
 * one expression now, so it cannot drift.
 *
 * Two things deliberately stay at the call sites: WHERE the options come
 * from (live snapshots them at Enter-AR; replay re-reads them per replay so
 * an old recording re-quantizes at the current setting), and publishing the
 * grid to non-visualizer consumers via `occupancy-grid-provider` (only the
 * LIVE grid feeds the COLMAP export, and the provider is a module-level
 * singleton the replay must not clobber).
 *
 * See `occupancy-stack.ts.md`.
 */

import type * as THREE from 'three';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { OccupancyCubesVisualizer } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import type { RecordingOptions } from '../state/recording-options';
import {
  createOccluderSink,
  type OccluderSink,
  type OccluderSinkHandle,
} from './occluder-sink';
import { wireOccupancyGridSubscribers } from './wire-occupancy-grid-subscribers';

const log = createLogger('Recorder');

/**
 * Chunk edge in cells: with any camera-relative window active, a settled grid
 * must still re-render when the camera moves this far (2.4 m at the 0.15 m
 * default). See the wirer's revision-guard docs (Step 2 correctness detail).
 */
const CAMERA_MOVE_EPSILON_CELLS = 16;

export interface OccupancyStackDeps {
  /** The alignment-riding parent (NOT the scene root): cells are raw WebXR. */
  readonly arWorldGroup: THREE.Group;
  readonly storeRef: StoreRef<RecorderStore>;
  /** The occupancy options group, as the call site sourced it. */
  readonly occupancy: RecordingOptions['occupancy'];
  /** `depth.intervalMs` - the cube-refresh throttle follows the sample cadence. */
  readonly depthIntervalMs: number;
  /**
   * Render the debug cubes? The grid is always built and fed either way,
   * because non-visualizer consumers read it; OFF wires a no-op sink so no
   * InstancedMesh is allocated.
   */
  readonly showCubes: boolean;
  /** Appended to the grid-update error log, e.g. `'during replay'`. */
  readonly logContext?: string;
}

export interface OccupancyStackHandle {
  /** The live grid, for the call site to publish or export. */
  readonly grid: OccupancyGrid;
  /** Stops the feed, then releases the visualizer and the occluder it fed. */
  dispose(): void;
}

/** A visualizer-shaped sink that renders nothing (cubes toggle OFF). */
const NO_CUBES = { refresh: (): void => {}, clear: (): void => {} };

export function wireOccupancyStack({
  arWorldGroup,
  storeRef,
  occupancy,
  depthIntervalMs,
  showCubes,
  logContext,
}: OccupancyStackDeps): OccupancyStackHandle {
  // Confidence-guarded carving is tied to the SAME noise floor the renderers
  // use (minConfidence, clamped 1-10): any voxel solid enough to be shown can
  // no longer be erased by one deeper reading (2026-07-16 synthetic-scene
  // investigation - eliminates silhouette churn and occluded-background
  // destruction).
  const grid = new OccupancyGrid({
    cellSizeM: occupancy.cellSizeM,
    carveConfidenceThreshold: occupancy.minConfidence,
  });

  // Noise filter: only render voxels seen >= minConfidence times.
  const cubes = showCubes
    ? new OccupancyCubesVisualizer(arWorldGroup, {
        minObservations: occupancy.minConfidence,
      })
    : null;

  // Persistent depth-only occluder (ON by default): re-meshes the grid on the
  // same throttle as the cubes and writes depth (no colour) under arWorldGroup
  // so real geometry hides virtual content placed behind it. The shared
  // factory snapshots the SAME minConfidence floor the cubes use.
  let occluderHandle: OccluderSinkHandle | null = null;
  let occluder: OccluderSink | undefined;

  const anyWindowedConsumer =
    showCubes ||
    (occupancy.persistentOcclusion && occupancy.occluderRadiusM > 0);
  const suffix = logContext ? ` ${logContext}` : '';
  let unsubscribe: () => void;
  // Both call sites treat a throw from here as best-effort (log and go on)
  // and never receive the handle — so whatever was constructed before the
  // throw must be released HERE, or the cubes already attached to
  // `arWorldGroup` and the occluder's mesh + Web Worker leak per attempt.
  // The pre-extraction replay code held them in outer-scope variables its
  // teardown still reached; the extraction dropped that (PR #413 review).
  // Same guard as `wireFrameTileStack`.
  try {
    if (occupancy.persistentOcclusion) {
      occluderHandle = createOccluderSink(arWorldGroup, occupancy);
      occluder = occluderHandle.sink;
    }
    unsubscribe = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: cubes ?? NO_CUBES,
      occluder,
      refreshOnCameraMoveM: anyWindowedConsumer
        ? CAMERA_MOVE_EPSILON_CELLS * occupancy.cellSizeM
        : undefined,
      // Tie the cube-refresh throttle to the depth-sample cadence so a
      // faster `depth.intervalMs` is not capped at a hardcoded 1 Hz
      // (2026-06-22 cube cadence/locality plan §2).
      refreshIntervalMs: depthIntervalMs,
      onError: (err) => {
        log.warn(`Occupancy grid update failed${suffix}`, err);
      },
      // Cells-over-time telemetry (Step 0 of the 2026-07-03 long-session fps
      // plan): one line per ~30 s so a log export correlates grid growth
      // with the stats overlay's fps trend.
      onGridSize: (cells) => {
        log.info(`[OccupancyGrid] ${cells} cells`);
      },
    });
  } catch (err) {
    cubes?.dispose();
    occluderHandle?.dispose();
    throw err;
  }

  return {
    grid,
    dispose(): void {
      // Stop feeding the grid before releasing what it feeds.
      unsubscribe();
      cubes?.dispose();
      occluderHandle?.dispose();
    },
  };
}
