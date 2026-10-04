/**
 * Occupancy view — the demo's single reconstructed mesh, used for BOTH the visual
 * occlusion AND the physics collider (user feedback: same framework building
 * block). Owns an `OccupancyGrid` fed by the store's `recordDepthSample` stream
 * (via the framework's `subscribeReplayOccupancy`) driving ONE `OcclusionMesh`.
 *
 * Matches the RecorderApp's mesh UI:
 * - **mesh mode** (`MeshMode`) — Surface nets (default) / Cubes blocky / Corner-fit —
 *   is a CONSTRUCTION option of `OcclusionMesh` (no live setter), so `setMeshMode`
 *   recreates the occluder and re-meshes from the (persisted) grid.
 * - **debug style** (`OccluderDebugStyle`) — the visible skin — is live via
 *   `setDebugStyle`; default `depth-shaded-wireframe` (the combined shader). The
 *   depth-only occluder always writes depth, so occlusion is on in every style.
 *
 * `getMesh()` returns the CURRENT occluder's `THREE.Mesh` (a stable indirection
 * across `setMeshMode` recreation), so the physics runtime always reads the live
 * geometry for its trimesh collider.
 */

import type { Mesh, Object3D } from "three";
import {
  OccupancyGrid,
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from "gps-plus-slam-app-framework/ar/occupancy-grid";
import {
  OcclusionMesh,
  type OccluderDebugStyle,
} from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import type { MeshMode } from "gps-plus-slam-app-framework/ar/occupancy-mesher";
import {
  subscribeReplayOccupancy,
  type DepthSampleStore,
} from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";

export interface OccupancyViewOptions {
  /** Voxel edge (m). Default `DEFAULT_OCCUPANCY_CELL_SIZE_M` (0.16 — framework reconstruction tuning). */
  readonly cellSizeM?: number;
  /** Noise floor (min observations). Default `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS` (2 — framework default; the decay carve guard keeps phantom colliders low at this floor). */
  readonly minObservations?: number;
  /** Mesher mode. Default `'smooth'` (Surface nets — the RecorderApp default). */
  readonly meshMode?: MeshMode;
  /** Visible debug skin. Default `'depth-shaded-wireframe'` (combined shader). */
  readonly debugStyle?: OccluderDebugStyle;
  /** The clock that stamps depth samples (ms). Default `performance.now`. */
  readonly now?: () => number;
}

/** The depth stream as the grid saw it, for the status line. */
interface DepthStats {
  /** Depth samples folded into the grid so far. */
  readonly samples: number;
  /** When the last one arrived (the view's clock), or null before the first. */
  readonly lastSampleAtMs: number | null;
}

export interface OccupancyView {
  /** The current occluder `THREE.Mesh` (its trimesh feeds the physics collider). */
  getMesh(): Mesh;
  /** The current occluder itself (the AR shadows give it their receiver). */
  getOcclusionMesh(): OcclusionMesh;
  /** Recreate the occluder with a new mesher mode and re-mesh from the grid. */
  setMeshMode(mode: MeshMode): void;
  /**
   * Recreate the occluder in the CURRENT mode, exactly as a mode change
   * does (a new occluder, so the shadows give it a new receiver), and
   * re-mesh it from the grid: the first-visit rebuild (r753 report).
   */
  rebuild(): void;
  /** Change the visible debug skin (live). */
  setDebugStyle(style: OccluderDebugStyle): void;
  /**
   * Re-mesh the current occluder from the grid now, as every depth refresh
   * does. The paused replay has no depth stream, so the shadow probe calls
   * this to reach the state a phone reaches on its next refresh.
   */
  remesh(): void;
  /** The depth samples folded in so far (status-line diagnostics). */
  depthStats(): DepthStats;
  dispose(): void;
}

export function createOccupancyView(
  arWorldGroup: Object3D,
  store: DepthSampleStore,
  options: OccupancyViewOptions = {},
): OccupancyView {
  const cellSizeM = options.cellSizeM ?? DEFAULT_OCCUPANCY_CELL_SIZE_M;
  const minObservations =
    options.minObservations ?? DEFAULT_OCCUPANCY_MIN_OBSERVATIONS;
  let debugStyle: OccluderDebugStyle =
    options.debugStyle ?? "depth-shaded-wireframe";
  let meshMode: MeshMode = options.meshMode ?? "smooth";

  // Confidence-guarded carving at the noise floor (2026-07-16 synthetic-scene
  // investigation): any cell solid enough to be meshed (≥ minObservations) can
  // no longer be erased by a single deeper reading — eliminates silhouette
  // churn and occluded-background destruction; the collider stays stable.
  const grid = new OccupancyGrid({
    cellSizeM,
    carveConfidenceThreshold: minObservations,
  });

  const buildOccluder = (mode: MeshMode): OcclusionMesh => {
    const mesh = new OcclusionMesh(arWorldGroup, { mode });
    mesh.setDebugStyle(debugStyle);
    return mesh;
  };
  let occluder = buildOccluder(meshMode);

  const remesh = (): void => {
    occluder.update(grid.getOccupiedCells(minObservations), cellSizeM, (cell) =>
      grid.getCellPoint(cell),
    );
  };

  // Counts what reaches the grid: the status line's depth diagnostics.
  const now = options.now ?? (() => performance.now());
  let samples = 0;
  let lastSampleAtMs: number | null = null;
  /** The Mesh dropdown's path: a new occluder (and receiver), same grid. */
  const rebuild = (): void => {
    occluder.dispose();
    occluder = buildOccluder(meshMode);
    remesh(); // re-mesh from the persisted grid so it is not momentarily empty
  };

  const unsubscribe = subscribeReplayOccupancy({
    store,
    grid: {
      addSample(sample) {
        samples += 1;
        lastSampleAtMs = now();
        return grid.addSample(sample);
      },
      clear: () => grid.clear(),
    },
    onRefresh: () => remesh(),
  });

  return {
    getMesh: () => occluder.getMesh(),
    getOcclusionMesh: () => occluder,
    setMeshMode(mode: MeshMode): void {
      if (mode === meshMode) return;
      meshMode = mode;
      rebuild();
    },
    rebuild,
    setDebugStyle(style: OccluderDebugStyle): void {
      debugStyle = style;
      occluder.setDebugStyle(style);
    },
    remesh,
    depthStats: () => ({ samples, lastSampleAtMs }),
    dispose(): void {
      unsubscribe();
      occluder.dispose();
    },
  };
}
