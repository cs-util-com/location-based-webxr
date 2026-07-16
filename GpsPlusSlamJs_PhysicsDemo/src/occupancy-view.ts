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
  /** Voxel edge (m). Default `DEFAULT_OCCUPANCY_CELL_SIZE_M` (0.18 — framework FAST-reconstruction). */
  readonly cellSizeM?: number;
  /** Noise floor (min observations). Default `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS` (3 — framework default; keeps phantom colliders low). */
  readonly minObservations?: number;
  /** Mesher mode. Default `'smooth'` (Surface nets — the RecorderApp default). */
  readonly meshMode?: MeshMode;
  /** Visible debug skin. Default `'depth-shaded-wireframe'` (combined shader). */
  readonly debugStyle?: OccluderDebugStyle;
}

export interface OccupancyView {
  /** The current occluder `THREE.Mesh` (its trimesh feeds the physics collider). */
  getMesh(): Mesh;
  /** Recreate the occluder with a new mesher mode and re-mesh from the grid. */
  setMeshMode(mode: MeshMode): void;
  /** Change the visible debug skin (live). */
  setDebugStyle(style: OccluderDebugStyle): void;
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

  const unsubscribe = subscribeReplayOccupancy({
    store,
    grid,
    onRefresh: () => remesh(),
  });

  return {
    getMesh: () => occluder.getMesh(),
    setMeshMode(mode: MeshMode): void {
      if (mode === meshMode) return;
      meshMode = mode;
      occluder.dispose();
      occluder = buildOccluder(mode);
      remesh(); // re-mesh from the persisted grid so it is not momentarily empty
    },
    setDebugStyle(style: OccluderDebugStyle): void {
      debugStyle = style;
      occluder.setDebugStyle(style);
    },
    dispose(): void {
      unsubscribe();
      occluder.dispose();
    },
  };
}
