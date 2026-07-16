import { bench, describe } from 'vitest';
import { OccupancyGrid } from './occupancy-grid';
import { packMeshRequest, runMeshRequest } from './occlusion-mesh-worker';
import type { Matrix4, Vector3, Quaternion } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';

/**
 * Benchmark for the PRODUCTION occluder re-mesh path: the worker-side
 * `runMeshRequest` in the default `'smooth'` (surface nets) mode.
 *
 * Why this bench matters (2026-07-17 perf loop, iteration 2): every occluder
 * refresh at the 200 ms reconstruction cadence ships a cell snapshot +
 * packed centroids to the mesh worker, and `runMeshRequest` is the worker's
 * entire CPU cost — at the ~100k-cell corpus regime (87k–124k real cells
 * after a ~5-minute walk, 2026-07-02 measurement) it is the single largest
 * compute block in the whole reconstruction pipeline. This is the
 * before/after instrument for mesher optimizations; `meshOccupiedCells`
 * micro-numbers alone miss the wrapper costs (AABB construction, tuple
 * unpacking, centroid lookup plumbing) that are part of every real re-mesh.
 *
 * The grid is a deterministic 320×320 single-cell-thick slab built through
 * the real `addSample` path (identity-projection closed form, carving
 * disabled — same technique as `synthetic-occupancy-grid.ts`), with measured
 * centroids offset from the cell centres so the smooth mesher's
 * centroid-consuming path is genuinely exercised.
 */

const IDENTITY_PROJECTION = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as unknown as Matrix4;
const CAMERA_AT_ORIGIN: Vector3 = [0, 0, 0];
const IDENTITY_ROTATION: Quaternion = [0, 0, 0, 1];
const CELL_SIZE_M = 0.15;
const MIN_CONFIDENCE = 5;

/** Build the slab grid via the real addSample path (see file header). */
function buildSlabGrid(edge: number): OccupancyGrid {
  const kBase = -(edge + 1 + edge + 16);
  const grid = new OccupancyGrid({
    cellSizeM: CELL_SIZE_M,
    carveStopCells: 1_000_000,
  });
  const off = [CELL_SIZE_M * 0.2, -CELL_SIZE_M * 0.1, CELL_SIZE_M * 0.15];
  const points: DepthPoint[] = [];
  for (let i = 0; i < edge; i++) {
    for (let k = 0; k < edge; k++) {
      const px = i * CELL_SIZE_M + off[0]!;
      const py = off[1]!;
      const pz = (kBase + k) * CELL_SIZE_M + off[2]!;
      const depthM = -pz;
      const screenX = (px / depthM + 1) / 2;
      const screenY = (1 - py / depthM) / 2;
      for (let o = 0; o < MIN_CONFIDENCE; o++) {
        points.push({ screenX, screenY, depthM });
      }
    }
  }
  grid.addSample({
    timestamp: 0,
    cameraPos: CAMERA_AT_ORIGIN,
    cameraRot: IDENTITY_ROTATION,
    points,
    projectionMatrix: IDENTITY_PROJECTION,
  });
  return grid;
}

/** One full production re-mesh: flat snapshot → pack → worker-side run. */
function remesh(grid: OccupancyGrid): void {
  const flat = grid.getOccupiedCellsFlat(MIN_CONFIDENCE);
  const { request } = packMeshRequest(1, flat, CELL_SIZE_M, 'smooth', (cell) =>
    grid.getCellPoint(cell)
  );
  runMeshRequest(request);
}

describe('occluder re-mesh (runMeshRequest, smooth, production path)', () => {
  const grid100k = buildSlabGrid(320); // 102,400 cells — long-walk regime
  const grid25k = buildSlabGrid(160); // 25,600 cells — mid-session regime

  bench('100k cells (long-walk corpus regime)', () => {
    remesh(grid100k);
  });

  bench('25k cells (mid-session regime)', () => {
    remesh(grid25k);
  });
});
