/**
 * Depth Prior Provider Tests
 *
 * Tests for the depth-prior provider (Component 2 of the Measurement Points
 * feature). Covers:
 *   - computeDepthWeight: quartic decay model
 *   - findDepthPointsInRadius: screen-space neighbourhood selection
 *   - computeEdgePenalty: quadratic edge-variance penalty
 *   - sampleDepthPrior: integration (null cases + valid observation)
 *
 * Unprojection and camera-to-world transforms are NOT tested here — they are
 * covered by the framework's own test suites (depth-unprojection.test.ts,
 * qr-size-depth-context.test.ts). This module tests only the composition.
 */

import { describe, it, expect } from 'vitest';
import type {
  DepthPoint,
  DepthSample,
} from 'gps-plus-slam-app-framework/types/ar-types';
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-app-framework/core';
import {
  computeDepthWeight,
  computeEdgePenalty,
  findDepthPointsInRadius,
  sampleDepthPrior,
} from './depth-prior-provider';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a DepthPoint at the given screen position with the given depth. */
function dp(screenX: number, screenY: number, depthM: number): DepthPoint {
  return { screenX, screenY, depthM };
}

/**
 * Build a standard symmetric projection matrix (column-major) where:
 *   p[0] = fx, p[5] = fy, p[8] = 0, p[9] = 0 (centred principal point).
 * The exact values mimic a realistic WebXR FOV.
 */
function centredProjectionMatrix(fx = 1.7, fy = 1.7): Matrix4 {
  // Column-major: [col0] [col1] [col2] [col3]
  return [
    fx,
    0,
    0,
    0, // col 0
    0,
    fy,
    0,
    0, // col 1
    0,
    0,
    -1.0002,
    -1, // col 2 (near/far encode)
    0,
    0,
    -0.020002,
    0, // col 3
  ] as unknown as Matrix4;
}

/** Identity quaternion (no rotation) — [x, y, z, w]. */
const IDENTITY_QUAT: Quaternion = [0, 0, 0, 1] as unknown as Quaternion;

/** Origin position. */
const ORIGIN: Vector3 = [0, 0, 0] as unknown as Vector3;

/**
 * Build a uniform 4×4 depth grid (gridSize = 4) with all points at the given
 * depth. Grid positions follow the sampler convention: `(col+1)/(g+1)`.
 * For g=4: positions at 0.2, 0.4, 0.6, 0.8 in both axes.
 */
function uniformGrid(depthM: number, gridSize = 4): DepthPoint[] {
  const points: DepthPoint[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const screenX = (col + 1) / (gridSize + 1);
      const screenY = (row + 1) / (gridSize + 1);
      points.push(dp(screenX, screenY, depthM));
    }
  }
  return points;
}

/**
 * Build a minimal DepthSample with the given points and a centred projection.
 */
function makeSample(
  points: DepthPoint[],
  opts?: {
    cameraPos?: Vector3;
    cameraRot?: Quaternion;
    projectionMatrix?: Matrix4;
  }
): DepthSample {
  return {
    timestamp: 1000,
    cameraPos: opts?.cameraPos ?? ORIGIN,
    cameraRot: opts?.cameraRot ?? IDENTITY_QUAT,
    points,
    projectionMatrix: opts?.projectionMatrix ?? centredProjectionMatrix(),
  };
}

// ---------------------------------------------------------------------------
// computeDepthWeight
// ---------------------------------------------------------------------------

describe('computeDepthWeight', () => {
  const REF = 2.0;

  it('returns ≈ 1.0 at 0 m', () => {
    expect(computeDepthWeight(0, REF)).toBeCloseTo(1.0, 10);
  });

  it('returns exactly 0.5 at referenceRangeM', () => {
    expect(computeDepthWeight(REF, REF)).toBeCloseTo(0.5, 10);
  });

  it('decays toward 0 rapidly at long range (quartic drop-off)', () => {
    const w5 = computeDepthWeight(5, REF);
    const w10 = computeDepthWeight(10, REF);
    expect(w5).toBeLessThan(0.05); // ≈ 0.025
    expect(w10).toBeLessThan(0.005); // ≈ 0.0016
  });

  it('is strictly monotonically decreasing with distance', () => {
    const distances = [0, 0.5, 1, 1.5, 2, 3, 5, 10];
    for (let i = 0; i < distances.length - 1; i++) {
      const wCurr = computeDepthWeight(distances[i], REF);
      const wNext = computeDepthWeight(distances[i + 1], REF);
      expect(wCurr).toBeGreaterThan(wNext);
    }
  });

  it('returns 0 for negative depthM', () => {
    expect(computeDepthWeight(-1, REF)).toBe(0);
  });

  it('returns 0 for NaN depthM', () => {
    expect(computeDepthWeight(NaN, REF)).toBe(0);
  });

  it('returns 0 for Infinity depthM', () => {
    expect(computeDepthWeight(Infinity, REF)).toBe(0);
  });

  it('returns 0 for non-positive referenceRangeM', () => {
    expect(computeDepthWeight(1, 0)).toBe(0);
    expect(computeDepthWeight(1, -1)).toBe(0);
  });

  it('always produces a value in [0, 1]', () => {
    const depths = [0, 0.001, 0.1, 0.5, 1, 2, 5, 10, 100, 1000];
    for (const d of depths) {
      const w = computeDepthWeight(d, REF);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// findDepthPointsInRadius
// ---------------------------------------------------------------------------

describe('findDepthPointsInRadius', () => {
  it('returns empty array if points is empty', () => {
    expect(findDepthPointsInRadius([], 0.5, 0.5, 0.1)).toEqual([]);
  });

  it('returns all points within Euclidean distance maxDist', () => {
    const points = [
      dp(0.5, 0.5, 2), // distance = 0 (exactly at centre)
      dp(0.55, 0.5, 2), // distance = 0.05
      dp(0.6, 0.5, 2), // distance = 0.10 (on boundary)
    ];
    const result = findDepthPointsInRadius(points, 0.5, 0.5, 0.1);
    expect(result).toHaveLength(3); // boundary is inclusive (<=)
  });

  it('excludes points outside screen-space radius', () => {
    const points = [
      dp(0.5, 0.5, 2), // in
      dp(0.8, 0.8, 2), // out — distance ≈ 0.424
    ];
    const result = findDepthPointsInRadius(points, 0.5, 0.5, 0.1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(points[0]);
  });

  it('uses Euclidean distance (not Manhattan)', () => {
    // Point at (0.57, 0.57) from centre (0.5, 0.5): Manhattan = 0.14, Euclidean ≈ 0.099
    const points = [dp(0.57, 0.57, 2)];
    // Should be included at maxDist = 0.1 (Euclidean ≈ 0.099)
    const result = findDepthPointsInRadius(points, 0.5, 0.5, 0.1);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeEdgePenalty
// ---------------------------------------------------------------------------

describe('computeEdgePenalty', () => {
  const MAX_STD_DEV = 0.5;

  it('returns 1.0 for single point (no variance)', () => {
    expect(computeEdgePenalty([dp(0.5, 0.5, 2)], MAX_STD_DEV)).toBe(1.0);
  });

  it('returns 1.0 for multiple points with identical depths (flat surface)', () => {
    const points = [dp(0.4, 0.4, 2), dp(0.5, 0.5, 2), dp(0.6, 0.6, 2)];
    expect(computeEdgePenalty(points, MAX_STD_DEV)).toBe(1.0);
  });

  it('returns 0.0 if standard deviation matches maxAllowedDepthStdDevM', () => {
    // Two points: 1.5 and 2.5 → mean = 2.0, stdDev = 0.5
    const points = [dp(0.4, 0.4, 1.5), dp(0.6, 0.6, 2.5)];
    expect(computeEdgePenalty(points, MAX_STD_DEV)).toBe(0.0);
  });

  it('returns 0.0 if standard deviation exceeds maxAllowedDepthStdDevM', () => {
    // Two points: 1.0 and 3.0 → mean = 2.0, stdDev = 1.0
    const points = [dp(0.4, 0.4, 1.0), dp(0.6, 0.6, 3.0)];
    expect(computeEdgePenalty(points, MAX_STD_DEV)).toBe(0.0);
  });

  it('returns a quadratic gradient factor: 1 − (σ/σ_max)²', () => {
    // Three points: [2.0, 2.0, 2.3] → mean = 2.1, variance ≈ 0.02, stdDev ≈ 0.1414
    // ratio = 0.1414 / 0.5 = 0.2828, penalty = 1 - 0.2828² = 1 - 0.08 ≈ 0.92
    const points = [dp(0.4, 0.4, 2.0), dp(0.5, 0.5, 2.0), dp(0.6, 0.6, 2.3)];
    const penalty = computeEdgePenalty(points, MAX_STD_DEV);
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(1);

    // Verify it's quadratic: manually compute
    const mean = (2.0 + 2.0 + 2.3) / 3;
    const variance =
      ((2.0 - mean) ** 2 + (2.0 - mean) ** 2 + (2.3 - mean) ** 2) / 3;
    const stdDev = Math.sqrt(variance);
    const ratio = stdDev / MAX_STD_DEV;
    const expected = 1 - ratio * ratio;
    expect(penalty).toBeCloseTo(expected, 10);
  });

  it('quadratic: gentle for small variance, hard drop near threshold', () => {
    // Small variance: stdDev = 0.1 → ratio = 0.2 → penalty = 1 - 0.04 = 0.96
    // (linear would be 0.80 — quadratic trusts more at low variance)
    const smallVar = [dp(0.4, 0.4, 1.9), dp(0.6, 0.6, 2.1)]; // stdDev = 0.1
    const pSmall = computeEdgePenalty(smallVar, MAX_STD_DEV);
    expect(pSmall).toBeGreaterThan(0.9);

    // Large variance near threshold: stdDev = 0.45 → ratio = 0.9 → penalty = 1 - 0.81 = 0.19
    // (linear would be 0.10 — quadratic still gives a bit more trust to genuinely sloped surfaces)
    const largeVar = [dp(0.4, 0.4, 1.55), dp(0.6, 0.6, 2.45)]; // stdDev = 0.45
    const pLarge = computeEdgePenalty(largeVar, MAX_STD_DEV);
    expect(pLarge).toBeGreaterThan(0);
    expect(pLarge).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// sampleDepthPrior (integration)
// ---------------------------------------------------------------------------

describe('sampleDepthPrior', () => {
  it('returns null for null sample', () => {
    expect(sampleDepthPrior(null, 0.5, 0.5)).toBeNull();
  });

  it('returns null for undefined sample', () => {
    expect(sampleDepthPrior(undefined, 0.5, 0.5)).toBeNull();
  });

  it('returns null when projectionMatrix is absent', () => {
    const sample: DepthSample = {
      timestamp: 1000,
      cameraPos: ORIGIN,
      cameraRot: IDENTITY_QUAT,
      points: uniformGrid(2),
      // projectionMatrix intentionally omitted
    };
    expect(sampleDepthPrior(sample, 0.5, 0.5)).toBeNull();
  });

  it('returns null when bilinear depth interpolation returns null (aimed outside grid)', () => {
    // Aim at (0.01, 0.01) which is outside the grid node bounding box
    // for a 4×4 grid (first node at 0.2, 0.2).
    const sample = makeSample(uniformGrid(2, 4));
    expect(sampleDepthPrior(sample, 0.01, 0.01)).toBeNull();
  });

  it('returns null when no depth point within maxScreenDist of aimed pixel', () => {
    // Build a grid but aim far from any points with a very small radius
    const sample = makeSample(uniformGrid(2, 4));
    const result = sampleDepthPrior(sample, 0.5, 0.5, { maxScreenDist: 0.001 });
    // The bilinear lookup might still find a valid depth, but the edge check
    // radius is so small no raw grid points fall within it → null
    expect(result).toBeNull();
  });

  it('returns null if edge penalty drops to 0 due to high standard deviation', () => {
    // Create a grid where the aimed area has extreme depth variance
    const points: DepthPoint[] = [];
    const gridSize = 4;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const screenX = (col + 1) / (gridSize + 1);
        const screenY = (row + 1) / (gridSize + 1);
        // Alternate between 1m and 10m depth to create extreme variance
        const depth = (row + col) % 2 === 0 ? 1 : 10;
        points.push(dp(screenX, screenY, depth));
      }
    }
    const sample = makeSample(points);
    // Aim at centre with a large radius that captures the mixed depths
    const result = sampleDepthPrior(sample, 0.5, 0.5, {
      maxScreenDist: 0.5,
      maxAllowedDepthStdDevM: 0.5,
    });
    expect(result).toBeNull();
  });

  it('returns valid observation for flat-grid crosshair at 2 m (quartic knee)', () => {
    // Uniform depth = 2.0 m, identity pose, centred projection
    const sample = makeSample(uniformGrid(2.0, 4));
    // Aim at a point that lies on a grid node (0.4 = (1+1)/(4+1))
    const result = sampleDepthPrior(sample, 0.4, 0.4, { maxScreenDist: 0.25 });

    expect(result).not.toBeNull();
    // Weight at 2m = 0.5 (quartic knee), edge penalty = 1.0 (flat) → 0.5
    expect(result!.weight).toBeCloseTo(0.5, 2);
    expect(result!.depthM).toBeCloseTo(2.0, 5);
    // Point should be a valid 3D coordinate (exact value depends on projection)
    expect(result!.point).toHaveLength(3);
    expect(Number.isFinite(result!.point[0])).toBe(true);
    expect(Number.isFinite(result!.point[1])).toBe(true);
    expect(Number.isFinite(result!.point[2])).toBe(true);
  });

  it('weight is close to 1.0 for very near depth in flat neighbourhood', () => {
    const sample = makeSample(uniformGrid(0.5, 4)); // 0.5m depth
    const result = sampleDepthPrior(sample, 0.4, 0.4, { maxScreenDist: 0.25 });

    expect(result).not.toBeNull();
    // Weight at 0.5m ≈ 1 / (1 + (0.25)^4) ≈ 0.997
    expect(result!.weight).toBeGreaterThan(0.95);
  });

  it('weight collapses to near 0 for far target', () => {
    const sample = makeSample(uniformGrid(10, 4)); // 10m depth
    const result = sampleDepthPrior(sample, 0.4, 0.4, { maxScreenDist: 0.25 });

    expect(result).not.toBeNull();
    // Weight at 10m ≈ 0.0016 — very small
    expect(result!.weight).toBeLessThan(0.01);
  });

  it('uses bilinear interpolation (via createDepthGridLookup) not nearest-point snapping', () => {
    // Create a grid with a depth gradient: row 0 = 1m, row 1 = 3m
    const gridSize = 4;
    const points: DepthPoint[] = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const screenX = (col + 1) / (gridSize + 1);
        const screenY = (row + 1) / (gridSize + 1);
        // Linear gradient from 1m at row 0 to ~3m at row 3
        const depth = 1 + row * 0.6;
        points.push(dp(screenX, screenY, depth));
      }
    }
    const sample = makeSample(points);

    // Aim between row 0 (screenY = 0.2) and row 1 (screenY = 0.4)
    // at screenY = 0.3 → bilinear should give ~1.3m (not 1.0 or 1.6)
    const result = sampleDepthPrior(sample, 0.4, 0.3, {
      maxScreenDist: 0.25,
      maxAllowedDepthStdDevM: 2, // Allow the gradient
    });

    expect(result).not.toBeNull();
    // Bilinear interpolation: depth should be between the two row depths
    expect(result!.depthM).toBeGreaterThan(1.0);
    expect(result!.depthM).toBeLessThan(1.6);
  });

  it('returns null when depth at aimed pixel is zero', () => {
    const sample = makeSample(uniformGrid(0, 4)); // all depth = 0
    expect(
      sampleDepthPrior(sample, 0.4, 0.4, { maxScreenDist: 0.25 })
    ).toBeNull();
  });

  it('custom referenceRangeM shifts the quartic knee', () => {
    const sample = makeSample(uniformGrid(5, 4)); // 5m depth
    // With referenceRangeM = 5, weight at 5m should be 0.5
    const result = sampleDepthPrior(sample, 0.4, 0.4, {
      maxScreenDist: 0.25,
      referenceRangeM: 5,
    });
    expect(result).not.toBeNull();
    expect(result!.weight).toBeCloseTo(0.5, 2);
  });
});
