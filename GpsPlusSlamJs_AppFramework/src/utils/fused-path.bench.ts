import { describe, test } from 'vitest';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import { computeFusedPath, type FusedPathInput } from './fused-path';

/**
 * Smoke benchmark for computeFusedPath — proves the framework's `pnpm bench`
 * harness on a real code path (see the 2026-07-09 bench-infra plan).
 *
 * computeFusedPath transforms the full odometry trajectory through the
 * alignment matrix and converts every point to GPS lat/lng for the summary
 * map. It runs over the whole trajectory each time the summary is built, so
 * its cost scales with recording length — the two sizes below measure that
 * scaling (≈1.5 min and ≈15 min of 10 Hz odometry).
 *
 * The function is pure (fresh output array per call, inputs untouched), so no
 * per-iteration setup is needed. Inputs are deterministic.
 */

/** Yaw ≈20° about the up axis plus a small translation — a realistic alignment matrix (column-major). */
const COS = Math.cos(0.35);
const SIN = Math.sin(0.35);
const ALIGNMENT_MAT4: Matrix4 = [
  COS,
  0,
  -SIN,
  0,
  0,
  1,
  0,
  0,
  SIN,
  0,
  COS,
  0,
  12.5,
  -0.75,
  -8.25,
  1,
];

const ZERO_REF = { lat: 50.0, lon: 8.0 } as const;

/** Deterministic walking-pace path with slight vertical drift. */
function buildOdometryPositions(count: number): Vector3[] {
  const positions: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    positions.push([
      i * 0.12,
      Math.sin(i * 0.01) * 0.3,
      Math.cos(i * 0.005) * 2,
    ]);
  }
  return positions;
}

function buildInput(count: number): FusedPathInput {
  return {
    odometryPositions: buildOdometryPositions(count),
    alignmentMatrix: ALIGNMENT_MAT4,
    zeroRef: ZERO_REF,
  };
}

describe('computeFusedPath (summary-map trajectory fusion)', () => {
  // Inputs are built once at module scope; each iteration only measures the
  // matrix transform + ENU→GPS conversion over the trajectory.
  const input1k = buildInput(1_000);
  const input10k = buildInput(10_000);

  test('1k odometry positions (~1.5 min recording)', async ({ bench }) => {
    await bench('1k odometry positions (~1.5 min recording)', () => {
      computeFusedPath(input1k);
    }).run();
  });

  test('10k odometry positions (~15 min recording)', async ({ bench }) => {
    await bench('10k odometry positions (~15 min recording)', () => {
      computeFusedPath(input10k);
    }).run();
  });
});
