import { bench, describe } from 'vitest';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import { OccupancyGrid, DEFAULT_OCCUPANCY_CELL_SIZE_M } from './occupancy-grid';
import type { DepthSample, DepthPoint } from '../types/ar-types';

/**
 * Benchmark for the depth→occupancy FOLD hot path (`OccupancyGrid.addSample`
 * with carving enabled) under the production reconstruction config.
 *
 * Why this bench matters: since the 2026-07-16 tuning pass the reconstruction
 * cadence is 200 ms (was 2000 ms — a 10× duty-cycle increase) at gridSize 24
 * (576 points/sample), voxel 0.16 m, decay-guarded carving at threshold 2.
 * `addSample` is therefore the framework's highest-frequency non-render
 * compute path on-device, and NO other bench covers it with carving on (the
 * synthetic-surface builder used by the mesher benches deliberately disables
 * carving). This bench is the before/after instrument for optimizing the fold:
 * unprojection + endpoint dedupe + bresenham carve traces + cell increments.
 *
 * Workload realism (deterministic, no Math.random):
 * - Camera orbits a 2 m-radius circle at walking pace, yawing to face the
 *   orbit center — consecutive samples re-observe the same volume from
 *   shifting viewpoints, so carve rays genuinely cross previously-occupied
 *   cells (decays + deletes happen, not just no-op traces).
 * - Depth per pixel is a smooth wavy surface 1.2–4.5 m out: adjacent pixels
 *   quantize to shared endpoint cells (exercising the per-sample endpoint
 *   dedupe) at realistic carve-ray lengths (~8–28 cells at 0.16 m).
 * - Samples are pre-generated at module scope; each iteration folds them into
 *   a FRESH grid, covering both build-up (new cells) and re-observation
 *   (established cells, guard decays) phases.
 */

/** Realistic perspective projection (column-major, near 0.1 — same shape as the unproject bench). */
const PROJECTION = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0,
] as unknown as Matrix4;

/** Production reconstruction defaults (depth-sampler gridSize 24 → 576 points). */
const GRID_SIZE = 24;
const ORBIT_RADIUS_M = 2;
const CAMERA_HEIGHT_M = 1.4;
/** 200 ms cadence at ~1.4 m/s walking ⇒ ~0.28 m arc per sample ⇒ ~0.14 rad. */
const ORBIT_STEP_RAD = 0.14;

/** Quaternion for a pure yaw (rotation about +Y), [x,y,z,w]. */
function yawQuaternion(yawRad: number): Quaternion {
  return [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)];
}

/**
 * Deterministic smooth depth field: wavy surfaces 1.2–4.5 m out that shift
 * with the orbit angle, so successive samples contradict each other slightly
 * (the guard's decay path runs) while neighbouring pixels stay coherent.
 */
function depthAt(row: number, col: number, orbitRad: number): number {
  const swell =
    0.5 + 0.5 * Math.sin(0.35 * col + 0.9 * orbitRad) * Math.cos(0.22 * row);
  return 1.2 + 3.3 * swell * (0.6 + 0.4 * Math.cos(0.5 * row + orbitRad));
}

function buildSample(sampleIndex: number): DepthSample {
  const orbitRad = sampleIndex * ORBIT_STEP_RAD;
  const cameraPos: Vector3 = [
    ORBIT_RADIUS_M * Math.cos(orbitRad),
    CAMERA_HEIGHT_M,
    ORBIT_RADIUS_M * Math.sin(orbitRad),
  ];
  // Face the orbit center: camera -Z forward, yaw so forward ≈ -cameraPos.
  const yaw = Math.atan2(-cameraPos[0], -cameraPos[2]);
  const points: DepthPoint[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      points.push({
        // Same screen lattice as depth-sampler: (i+1)/(gridSize+1).
        screenX: (col + 1) / (GRID_SIZE + 1),
        screenY: (row + 1) / (GRID_SIZE + 1),
        depthM: depthAt(row, col, orbitRad),
      });
    }
  }
  return {
    timestamp: sampleIndex * 200,
    cameraPos,
    cameraRot: yawQuaternion(yaw),
    points,
    projectionMatrix: PROJECTION,
  };
}

/** 50 samples = 10 s of production-cadence reconstruction (≈ 28.8k points). */
const SAMPLES: DepthSample[] = [];
for (let i = 0; i < 50; i++) {
  SAMPLES.push(buildSample(i));
}

/** Denser depth grid (the recorder's validation-recording density): 4096 points/sample. */
const DENSE_GRID_SIZE = 64;
const DENSE_SAMPLES: DepthSample[] = [];
{
  const points = (orbitRad: number): DepthPoint[] => {
    const out: DepthPoint[] = [];
    for (let row = 0; row < DENSE_GRID_SIZE; row++) {
      for (let col = 0; col < DENSE_GRID_SIZE; col++) {
        out.push({
          screenX: (col + 1) / (DENSE_GRID_SIZE + 1),
          screenY: (row + 1) / (DENSE_GRID_SIZE + 1),
          // Scale the field's pixel frequencies so the surface SHAPE matches
          // the 24-grid workload (same waves, finer sampling).
          depthM: depthAt(
            (row * GRID_SIZE) / DENSE_GRID_SIZE,
            (col * GRID_SIZE) / DENSE_GRID_SIZE,
            orbitRad
          ),
        });
      }
    }
    return out;
  };
  for (let i = 0; i < 10; i++) {
    const base = buildSample(i);
    DENSE_SAMPLES.push({ ...base, points: points(i * ORBIT_STEP_RAD) });
  }
}

function foldAll(samples: readonly DepthSample[]): OccupancyGrid {
  const grid = new OccupancyGrid({
    cellSizeM: DEFAULT_OCCUPANCY_CELL_SIZE_M,
    carveConfidenceThreshold: 2,
  });
  for (const sample of samples) {
    grid.addSample(sample);
  }
  return grid;
}

describe('occupancy fold (addSample, carving on, production config)', () => {
  bench('50 samples × 576 pts (gridSize 24, 10 s @ 200 ms cadence)', () => {
    foldAll(SAMPLES);
  });

  bench('10 samples × 4096 pts (gridSize 64 validation density)', () => {
    foldAll(DENSE_SAMPLES);
  });
});
