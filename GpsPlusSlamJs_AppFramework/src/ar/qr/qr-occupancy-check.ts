/**
 * QR pose/size plausibility self-check — Phase 4 of the QR-code detection &
 * tracking plan (§7).
 *
 * The encoded physical QR size scales `tvec` linearly (proved in
 * `qr-pose.property.test.ts`), so a WRONG size puts the solved QR center off the
 * real surface: floating in mid-air, or *behind* a wall. The occupancy grid
 * (built from depth samples, raw-WebXR space) is therefore a cheap, geometry-
 * grounded oracle for the otherwise-unverifiable size: a correctly-sized QR sits
 * on a poster/wall (≈ one voxel from an occupied surface, empty space toward the
 * camera). This is a pure function over the grid + the solved pose — no THREE,
 * no DOM — so it is fully unit/property testable with synthetic grids.
 *
 * It is an ENHANCEMENT, not a hard dependency: when the grid is empty (depth
 * sensing off / not yet populated) the verdict is `no-grid` and `ok` is true, so
 * detection is never blocked just because there is nothing to check against.
 *
 * @see qr-pose.ts for the pose the QR center comes from.
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { GridCell } from '../bresenham3d.js';

/**
 * The slice of `OccupancyGrid` this check needs. Declared structurally so the
 * real grid satisfies it and tests can pass a tiny synthetic stand-in.
 */
export interface OccupancySurface {
  readonly cellSizeM: number;
  getOccupiedCells(minObservations?: number): readonly GridCell[];
  getCellCenter(cell: GridCell): Vector3;
}

export type QrPlausibilityVerdict =
  'plausible' | 'floating' | 'behind-surface' | 'no-grid';

export interface QrPlausibility {
  verdict: QrPlausibilityVerdict;
  /** `false` only for an implausible pose (`floating` / `behind-surface`). */
  ok: boolean;
  /** Distance from the QR center to the nearest occupied voxel; `Infinity` when the grid is empty. */
  nearestSurfaceDistanceM: number;
}

export interface QrPlausibilityOptions {
  /**
   * How far (in `cellSizeM` units) the QR may sit from the nearest occupied
   * voxel before it counts as "floating". Default 1.5.
   */
  surfaceToleranceCells?: number;
  /** Minimum observation count for a voxel to count as occupied. Default 1. */
  minObservations?: number;
  /**
   * Perpendicular distance (in `cellSizeM` units) within which an occupied
   * voxel counts as lying ON the camera→QR ray. Default 1.
   */
  rayCorridorCells?: number;
  /**
   * Margin (in `cellSizeM` units) subtracted from the camera→QR distance so the
   * QR's own wall voxel is not mistaken for an occluder. Default 2.
   */
  occlusionMarginCells?: number;
}

const DEFAULTS = {
  surfaceToleranceCells: 1.5,
  minObservations: 1,
  rayCorridorCells: 1,
  occlusionMarginCells: 2,
} as const;

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Classify a solved QR center against the occupancy grid.
 *
 * - `no-grid` (ok): the grid has no occupied voxels — nothing to check against.
 * - `floating` (not ok): nearest occupied voxel is farther than the tolerance.
 * - `behind-surface` (not ok): an occupied voxel lies on the camera→QR ray
 *   clearly in front of the QR (the QR is inside / beyond geometry).
 * - `plausible` (ok): on a surface with empty space toward the camera.
 *
 * All positions are raw-WebXR/odom space (the same frame as `qrPoseWorld`).
 */
export function checkQrPlausibility(
  qrCenterWorld: Vector3,
  cameraPosWorld: Vector3,
  grid: OccupancySurface,
  options: QrPlausibilityOptions = {}
): QrPlausibility {
  const surfaceToleranceCells =
    options.surfaceToleranceCells ?? DEFAULTS.surfaceToleranceCells;
  const minObservations = options.minObservations ?? DEFAULTS.minObservations;
  const rayCorridorCells =
    options.rayCorridorCells ?? DEFAULTS.rayCorridorCells;
  const occlusionMarginCells =
    options.occlusionMarginCells ?? DEFAULTS.occlusionMarginCells;

  const cells = grid.getOccupiedCells(minObservations);
  if (cells.length === 0) {
    return { verdict: 'no-grid', ok: true, nearestSurfaceDistanceM: Infinity };
  }

  const cellSizeM = grid.cellSizeM;
  const centers = cells.map((c) => grid.getCellCenter(c));

  // 1) Nearest occupied voxel to the QR center.
  let nearest = Infinity;
  for (const center of centers) {
    const d = distance(center, qrCenterWorld);
    if (d < nearest) nearest = d;
  }
  if (nearest > surfaceToleranceCells * cellSizeM) {
    return { verdict: 'floating', ok: false, nearestSurfaceDistanceM: nearest };
  }

  // 2) Occlusion: does an occupied voxel sit on the camera→QR ray, clearly in
  //    front of the QR? Skip when the camera and QR are essentially coincident.
  const dir: Vector3 = [
    qrCenterWorld[0] - cameraPosWorld[0],
    qrCenterWorld[1] - cameraPosWorld[1],
    qrCenterWorld[2] - cameraPosWorld[2],
  ];
  const rayLength = Math.hypot(dir[0], dir[1], dir[2]);
  if (rayLength > cellSizeM) {
    const nx = dir[0] / rayLength;
    const ny = dir[1] / rayLength;
    const nz = dir[2] / rayLength;
    const corridor = rayCorridorCells * cellSizeM;
    const tMax = rayLength - occlusionMarginCells * cellSizeM;
    for (const center of centers) {
      const ox = center[0] - cameraPosWorld[0];
      const oy = center[1] - cameraPosWorld[1];
      const oz = center[2] - cameraPosWorld[2];
      const t = ox * nx + oy * ny + oz * nz; // projection along the ray
      if (t <= cellSizeM || t >= tMax) continue; // behind camera, or near the QR
      // Perpendicular distance from the voxel center to the ray.
      const perp = Math.hypot(ox - t * nx, oy - t * ny, oz - t * nz);
      if (perp < corridor) {
        return {
          verdict: 'behind-surface',
          ok: false,
          nearestSurfaceDistanceM: nearest,
        };
      }
    }
  }

  return { verdict: 'plausible', ok: true, nearestSurfaceDistanceM: nearest };
}
