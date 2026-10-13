/**
 * The ONE persistent-occluder wiring: the RecorderApp's live AR and replay
 * and the Tour Viewer's mesh cursor. Extracted 2026-07-04 in the RecorderApp
 * (code-health plan step 5) from two structurally identical ~40-line blocks;
 * lifted into the framework 2026-10-13 (Tour Viewer polish round M5a,
 * DEC-H3) with plain options in place of the recorder's option group and the
 * worker supplied by the app (a `new Worker(new URL(...))` resolves against
 * the app's own source).
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
 * - Camera-local window (Step 2): when `radiusM > 0` and the pose is
 *   usable, each re-mesh reads only the cells within the radius; unbounded
 *   fallback otherwise (a tracking-glitch pose must degrade gracefully, never
 *   blank the occluder).
 * - getCellPoint is read only by the surface-hugging modes (cube modes ignore it).
 *
 * @see occluder-sink.ts.md
 */

import type { Object3D } from 'three';

import type { OccupancyGrid } from '../ar/occupancy-grid';
import type { MeshMode } from '../ar/occupancy-mesher';
import { OcclusionMesh, type OccluderDebugStyle } from './occlusion-mesh';
import type { OccluderMeshDriver } from './occluder-mesh-driver';
import type { ViewerPose } from './occupancy-cubes-visualizer';

/** How the occluder is meshed and drawn. */
export interface OccluderSinkOptions {
  /** The mesher's style (`meshOccupiedCells`). */
  readonly meshMode: MeshMode;
  /** A visible debug skin, or `'off'` (no effect on occlusion). */
  readonly debugStyle: OccluderDebugStyle;
  /** Mesh only the cells within this radius of the camera; 0: all. */
  readonly radiusM: number;
  /** The confidence floor a cell needs to be meshed. */
  readonly minConfidence: number;
  /** Write depth, hiding what is behind the surfaces (default true); false
   *  keeps the mesh only as a hidden pick target (the Tour Viewer's mesh
   *  cursor, polish round M5) - the raycaster hits a hidden mesh too. */
  readonly occlude?: boolean;
}

/** The off-thread mesher (`createOccluderMeshWorker`). */
export interface OccluderMeshWorker {
  readonly driver: Pick<OccluderMeshDriver, 'request'>;
  dispose(): void;
}

/** The grid-facing half: what `wireOccupancyGridSubscribers` drives. */
export interface OccluderSink {
  refresh(grid: OccupancyGrid, pose?: ViewerPose): void;
  clear(): void;
}

/** The lifecycle half: what the session teardown calls. */
export interface OccluderSinkHandle {
  readonly sink: OccluderSink;
  /** The occluder's mesh, for a raycast (the Tour Viewer's mesh cursor,
   *  polish round M5c). Depth-only, but the raycaster still hits it. */
  mesh(): Object3D;
  /**
   * Dispose the mesh + worker and turn the sink callbacks into no-ops.
   * Idempotent — safe from any teardown path.
   */
  dispose(): void;
}

/** The constructors. The worker is the app's: it owns the worker file's URL
 *  (`createOccluderMeshWorker(() => new Worker(new URL(...)))`). */
export interface OccluderSinkDeps {
  readonly createMesh?: (
    parent: Object3D,
    opts: { mode: MeshMode }
  ) => OcclusionMesh;
  readonly createWorker: () => OccluderMeshWorker;
}

/**
 * Build the persistent-occluder resources for one session. The caller
 * decides WHETHER; this factory owns HOW, from the mesher style, debug
 * style, radius and confidence floor in `options`.
 */
export function createOccluderSink(
  parent: Object3D,
  options: OccluderSinkOptions,
  deps: OccluderSinkDeps
): OccluderSinkHandle {
  const mode = options.meshMode;
  const minConfidence = options.minConfidence;
  const radiusM = options.radiusM;

  const mesh = (deps.createMesh ?? ((p, o) => new OcclusionMesh(p, o)))(
    parent,
    { mode }
  );
  // Debug style: visible debug skin(s) — matcap / depth-shaded / wireframe —
  // so the mesh's shape can be judged on-device/on-replay. No effect on
  // occlusion (additive skins).
  mesh.setDebugStyle(options.debugStyle);
  // After the debug style, which re-adds its skins as visible.
  if (options.occlude === false) mesh.setVisible(false);
  // Mesh off the main thread so a large-grid re-mesh (100s of ms at hundreds
  // of metres) never stalls rendering; coalesces to the latest snapshot while
  // busy, synchronous fallback if a worker can't be created.
  const worker = deps.createWorker();

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
    mesh: () => mesh.getMesh(),
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
