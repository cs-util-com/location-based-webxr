/**
 * The ONE persistent-occluder wiring shared by live AR (`main.ts`) and replay
 * (`replay-mode.ts`) — extracted 2026-07-04 (code-health plan step 5) from two
 * structurally identical ~40-line blocks that had to be edited in lockstep.
 *
 * Owns the trio of resources the occluder needs — the depth-only
 * {@link OcclusionMesh} under the caller's scene group, the off-thread mesh
 * worker, and the grid-facing sink — and their teardown: `dispose()` releases
 * mesh + worker and turns the sink callbacks into no-ops, replacing the old
 * per-site "null two module variables and hope every path does it" pattern
 * (the source of several review findings).
 *
 * Meshing policy (unchanged from the two originals):
 * - Flat snapshot (Step 1.3, 2026-07-03 fps plan): cells go to the pack path
 *   as the transferable Int32Array it ships anyway — no tuple intermediate.
 *   Snapshot + getCellPoint stay main-thread; only meshOccupiedCells runs in
 *   the worker, its geometry applied back here.
 * - Camera-local window (Step 2): when `occluderRadiusM > 0` and the pose is
 *   usable, each re-mesh reads only the cells within the radius; unbounded
 *   fallback otherwise (a tracking-glitch pose must degrade gracefully, never
 *   blank the occluder).
 * - getCellPoint is read only by the surface-hugging modes (cube modes ignore it).
 *
 * @see occluder-sink.ts.md for detailed documentation
 */

import type { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import type { OccupancyOptions } from '../state/recording-options';
import { OcclusionMesh } from 'gps-plus-slam-app-framework/visualization';
import type { Object3D } from 'three';
import { createOccluderMeshWorker } from './occluder-mesh-worker-client';
import type { ViewerPose } from 'gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer';

/** The grid-facing half: what `wireOccupancyGridSubscribers` drives. */
export interface OccluderSink {
  refresh(grid: OccupancyGrid, pose?: ViewerPose): void;
  clear(): void;
}

/** The lifecycle half: what the session teardown calls. */
export interface OccluderSinkHandle {
  readonly sink: OccluderSink;
  /**
   * Dispose the mesh + worker and turn the sink callbacks into no-ops.
   * Idempotent — safe from any teardown path.
   */
  dispose(): void;
}

/** Injectable constructors (tests only — production uses the real ones). */
export interface OccluderSinkDeps {
  readonly createMesh?: (
    parent: Object3D,
    opts: { mode: OccupancyOptions['occluderMeshMode'] }
  ) => OcclusionMesh;
  readonly createWorker?: typeof createOccluderMeshWorker;
}

/**
 * Build the persistent-occluder resources for one AR/replay session. The
 * caller decides WHETHER (the `occupancy.persistentOcclusion` flag); this
 * factory owns HOW. Reads the mesher style, debug style, radius and
 * min-confidence floor from the validated `occupancy` options group so live
 * and replay can never silently diverge again.
 */
export function createOccluderSink(
  parent: Object3D,
  occupancy: OccupancyOptions,
  deps: OccluderSinkDeps = {}
): OccluderSinkHandle {
  const mode = occupancy.occluderMeshMode;
  const minConfidence = occupancy.minConfidence;
  const radiusM = occupancy.occluderRadiusM;

  const mesh = (deps.createMesh ?? ((p, o) => new OcclusionMesh(p, o)))(
    parent,
    { mode }
  );
  // Debug style: visible debug skin(s) — matcap / depth-shaded / wireframe —
  // so the mesh's shape can be judged on-device/on-replay. No effect on
  // occlusion (additive skins).
  mesh.setDebugStyle(occupancy.occluderDebugStyle);
  // Mesh off the main thread so a large-grid re-mesh (100s of ms at hundreds
  // of metres) never stalls rendering; coalesces to the latest snapshot while
  // busy, synchronous fallback if a worker can't be created.
  const worker = (deps.createWorker ?? createOccluderMeshWorker)();

  // Teardown safety: the sink callbacks run asynchronously (throttled
  // refreshes, worker responses) and must no-op after dispose — the flag
  // replaces the old module-variable `?.` re-read pattern.
  let disposed = false;

  const sink: OccluderSink = {
    refresh: (g: OccupancyGrid, pose?: ViewerPose): void => {
      if (disposed) {
        return;
      }
      worker.driver.request(
        radiusM > 0 && pose && pose.cameraPos.every(Number.isFinite)
          ? g.getOccupiedCellsWithinFlat(
              [pose.cameraPos[0], pose.cameraPos[1], pose.cameraPos[2]],
              radiusM,
              minConfidence
            )
          : g.getOccupiedCellsFlat(minConfidence),
        g.cellSizeM,
        mode,
        (cell) => g.getCellPoint(cell),
        (positions, indices) => {
          if (!disposed) {
            mesh.applyMeshData(positions, indices);
          }
        }
      );
    },
    clear: (): void => {
      if (!disposed) {
        mesh.clear();
      }
    },
  };

  return {
    sink,
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      worker.dispose();
      mesh.dispose();
    },
  };
}
