/**
 * Robust Triangulation Tests.
 *
 * Tests for the MSAC fusion module (Component 3 of the Measurement Points
 * feature). Covers:
 *   - createSeededRng: determinism and seed independence
 *   - computeAdaptiveThreshold: range scaling
 *   - evaluateObservation: decoupled scoring and inlier classification
 *   - solveRobustTriangulation: early exits, outlier rejection,
 *     degenerate pair avoidance, tri-state baseline, determinism,
 *     and depth-prior fading
 */

import { describe, it, expect, test, beforeEach } from 'vitest';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import {
  createSeededRng,
  computeAdaptiveThreshold,
  evaluateObservation,
  solveRobustTriangulation,
  type MeasurementRayObservation,
} from './robust-triangulation';
import {
  perpendicularDistanceToRay,
  type Observation,
} from './ray-triangulation-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const v3 = (x: number, y: number, z: number): Vector3 =>
  [x, y, z] as unknown as Vector3;

let idCounter = 0;
function makeObs(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  rayWeight = 1,
  depthPoint?: Vector3,
  depthWeight?: number
): MeasurementRayObservation {
  return {
    id: `obs-${idCounter++}`,
    timestamp: Date.now(),
    rayOrigin,
    rayDirection,
    rayWeight,
    depthPoint,
    depthWeight,
  };
}

// Reset counter between describe blocks
function resetIds() {
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// createSeededRng
// ---------------------------------------------------------------------------

describe('createSeededRng', () => {
  it('produces deterministic sequences for the same seed', () => {
    const rng1 = createSeededRng(12345);
    const rng2 = createSeededRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = createSeededRng(12345);
    const rng2 = createSeededRng(67890);
    let allSame = true;
    for (let i = 0; i < 20; i++) {
      if (rng1() !== rng2()) allSame = false;
    }
    expect(allSame).toBe(false);
  });

  it('produces values in [0, 1)', () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('handles seed = 0 without stalling', () => {
    const rng = createSeededRng(0);
    const values = new Set<number>();
    for (let i = 0; i < 10; i++) values.add(rng());
    expect(values.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// computeAdaptiveThreshold
// ---------------------------------------------------------------------------

describe('computeAdaptiveThreshold', () => {
  it('returns base tolerance when no camera origins', () => {
    expect(computeAdaptiveThreshold(v3(0, 0, 0), [], 0.5, 0.01)).toBe(0.5);
  });

  it('scales with range — far targets get larger threshold', () => {
    const nearPt = v3(2, 0, 0);
    const farPt = v3(100, 0, 0);
    const origins = [v3(0, 0, 0)];

    const nearThr = computeAdaptiveThreshold(nearPt, origins, 0.5, 0.01);
    const farThr = computeAdaptiveThreshold(farPt, origins, 0.5, 0.01);

    expect(farThr).toBeGreaterThan(nearThr);
  });

  it('at zero range, equals the base tolerance', () => {
    const origins = [v3(0, 0, 0)];
    const thr = computeAdaptiveThreshold(v3(0, 0, 0), origins, 0.5, 0.01);
    expect(thr).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// evaluateObservation
// ---------------------------------------------------------------------------

describe('evaluateObservation', () => {
  it('classifies a point on the ray as inlier', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
    };
    // Point lies exactly on the ray
    const { isInlier } = evaluateObservation(v3(5, 0, 0), obs, 0.5);
    expect(isInlier).toBe(true);
  });

  it('classifies a point far from the ray as outlier', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
    };
    // Point is 3m from the ray (threshold is 0.5)
    const { isInlier } = evaluateObservation(v3(0, 3, 0), obs, 0.5);
    expect(isInlier).toBe(false);
  });

  it('MSAC score is capped at thresh² for outliers', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
    };
    const threshold = 0.5;
    const { msacScore } = evaluateObservation(v3(0, 10, 0), obs, threshold);
    // Score should be rayWeight × thresh² = 1 × 0.25 = 0.25
    expect(msacScore).toBeCloseTo(threshold * threshold, 5);
  });

  it('MSAC score reflects actual distance for inliers', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
    };
    // Point 0.2m from ray (within threshold 0.5)
    const { msacScore } = evaluateObservation(v3(0, 0.2, 0), obs, 0.5);
    expect(msacScore).toBeCloseTo(0.04, 3); // 1 × 0.2² = 0.04
  });

  it('decoupled scoring: low-weight garbage does NOT hide bad geometry', () => {
    // An observation with very low weight and terrible ray distance
    // should still be classified as outlier based on pure geometry
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 0.001, // very low weight
    };
    // Point is 5m from ray — clearly an outlier geometrically
    const { isInlier } = evaluateObservation(v3(0, 5, 0), obs, 0.5);
    expect(isInlier).toBe(false);
  });

  it('rejects observation if depth error exceeds threshold', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
      depthPoint: v3(5, 0, 0),
      depthWeight: 1,
    };
    // Point on ray but far from depth point along-ray
    // depth point at 5, hypothesis at 1 → along-ray error = 4
    const { isInlier } = evaluateObservation(v3(1, 0, 0), obs, 0.5);
    expect(isInlier).toBe(false);
  });

  it('accepts observation when both ray and depth errors are below threshold', () => {
    const obs: Observation = {
      ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
      rayWeight: 1,
      depthPoint: v3(5, 0, 0),
      depthWeight: 1,
    };
    // Point very close to depth point and on the ray
    const { isInlier } = evaluateObservation(v3(5, 0, 0), obs, 0.5);
    expect(isInlier).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// perpendicularDistanceToRay (standalone, imported from core)
// ---------------------------------------------------------------------------

describe('perpendicularDistanceToRay (from core)', () => {
  it('diagonal distance is correct', () => {
    // Ray along +X from origin. Point at (3, 4, 0).
    // Perpendicular distance = 4 (the Y component)
    const dist = perpendicularDistanceToRay(
      v3(3, 4, 0),
      v3(0, 0, 0),
      v3(1, 0, 0)
    );
    expect(dist).toBeCloseTo(4, 10);
  });

  it('3D perpendicular distance is correct', () => {
    // Ray along +Z from origin. Point at (3, 4, 7).
    // Perpendicular distance = sqrt(3² + 4²) = 5
    const dist = perpendicularDistanceToRay(
      v3(3, 4, 7),
      v3(0, 0, 0),
      v3(0, 0, 1)
    );
    expect(dist).toBeCloseTo(5, 10);
  });
});

// ---------------------------------------------------------------------------
// solveRobustTriangulation
// ---------------------------------------------------------------------------

describe('solveRobustTriangulation', () => {
  beforeEach(resetIds);

  // ─── Edge cases ────────────────────────────────────────────────────────

  it('returns null for empty observations', () => {
    expect(solveRobustTriangulation([])).toBeNull();
  });

  it('returns null for 1 observation without depth', () => {
    const obs = [makeObs(v3(0, 0, 0), v3(1, 0, 0), 1)];
    expect(solveRobustTriangulation(obs)).toBeNull();
  });

  // ─── 1 observation with depth (early exit) ─────────────────────────────

  it('1 observation with depth: direct solve, hasSufficientBaseline = false', () => {
    const obs = [makeObs(v3(0, 0, 0), v3(1, 0, 0), 1, v3(5, 0, 0), 10)];
    const result = solveRobustTriangulation(obs);

    expect(result).not.toBeNull();
    expect(result!.hasSufficientBaseline).toBe(false);
    expect(result!.point[0]).toBeCloseTo(5, 1);
    expect(result!.inlierIds).toHaveLength(1);
    expect(result!.outlierIds).toHaveLength(0);
  });

  // ─── 2 observations (early exit) ───────────────────────────────────────

  it('2 observations: direct solve, baseline computed', () => {
    const obs = [
      makeObs(v3(-1, 0, 0), v3(1, 0, 0), 1),
      makeObs(v3(0, -1, 0), v3(0, 1, 0), 1),
    ];
    const result = solveRobustTriangulation(obs, { minBaselineM: 0.5 });

    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(0, 3);
    expect(result!.point[1]).toBeCloseTo(0, 3);
    expect(result!.point[2]).toBeCloseTo(0, 3);
    expect(result!.hasSufficientBaseline).toBe(true);
    expect(result!.inlierIds).toHaveLength(2);
  });

  it('2 observations: insufficient baseline when origins are too close', () => {
    const obs = [
      makeObs(v3(-0.01, 0, 0), v3(1, 0.5, 0), 1),
      makeObs(v3(0.01, 0, 0), v3(1, -0.5, 0), 1),
    ];
    const result = solveRobustTriangulation(obs, { minBaselineM: 0.5 });

    expect(result).not.toBeNull();
    expect(result!.hasSufficientBaseline).toBe(false);
  });

  // ─── ≥ 3 observations: convergence ────────────────────────────────────

  test('clean multi-ray set converges to known point', () => {
    // 4 rays converging at (3, 0, 2) from different origins
    const target = v3(3, 0, 2);
    const origins = [v3(0, 0, 0), v3(6, 0, 0), v3(3, 0, -2), v3(3, 3, 2)];
    const obs = origins.map((o) => {
      const d = v3(target[0] - o[0], target[1] - o[1], target[2] - o[2]);
      return makeObs(o, d, 1);
    });

    const result = solveRobustTriangulation(obs, { seed: 42 });
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(3, 1);
    expect(result!.point[1]).toBeCloseTo(0, 1);
    expect(result!.point[2]).toBeCloseTo(2, 1);
    expect(result!.inlierIds).toHaveLength(4);
    expect(result!.outlierIds).toHaveLength(0);
  });

  // ─── Outlier rejection ─────────────────────────────────────────────────

  test('injected outlier ray is rejected and does not move the result', () => {
    const target = v3(3, 0, 2);
    const origins = [v3(0, 0, 0), v3(6, 0, 0), v3(3, 0, -2), v3(3, 3, 2)];
    const obs = origins.map((o) => {
      const d = v3(target[0] - o[0], target[1] - o[1], target[2] - o[2]);
      return makeObs(o, d, 1);
    });

    // Add a deliberately bad ray pointing in the wrong direction
    const badObs = makeObs(v3(0, 0, 0), v3(-1, -1, -1), 1);
    obs.push(badObs);

    const result = solveRobustTriangulation(obs, {
      seed: 42,
      iterations: 200,
      baseDistanceThreshold: 0.5,
    });

    expect(result).not.toBeNull();
    // Point should still be near (3, 0, 2)
    expect(result!.point[0]).toBeCloseTo(3, 0);
    expect(result!.point[1]).toBeCloseTo(0, 0);
    expect(result!.point[2]).toBeCloseTo(2, 0);
    // Bad ray should be in the outlier list
    expect(result!.outlierIds).toContain(badObs.id);
  });

  // ─── Degenerate pair avoidance ─────────────────────────────────────────

  test('near-parallel rays do not poison the result', () => {
    // 3 good rays + 1 near-parallel pair
    const target = v3(5, 0, 0);
    const obs = [
      makeObs(v3(0, -2, 0), v3(5, 2, 0), 1),
      makeObs(v3(0, 2, 0), v3(5, -2, 0), 1),
      makeObs(v3(0, 0, -2), v3(5, 0, 2), 1),
      // This ray is nearly parallel to the first one
      makeObs(v3(0.01, -2.01, 0), v3(5, 2, 0), 1),
    ];

    const result = solveRobustTriangulation(obs, { seed: 42, iterations: 200 });
    expect(result).not.toBeNull();
    // Should still converge reasonably near target
    expect(result!.point[0]).toBeCloseTo(target[0], 0);
  });

  // ─── Determinism ───────────────────────────────────────────────────────

  test('same seed produces identical result', () => {
    const target = v3(3, 0, 2);
    const origins = [v3(0, 0, 0), v3(6, 0, 0), v3(3, 0, -2), v3(3, 3, 2)];

    const makeObsSet = () => {
      resetIds();
      return origins.map((o) => {
        const d = v3(target[0] - o[0], target[1] - o[1], target[2] - o[2]);
        return makeObs(o, d, 1);
      });
    };

    const r1 = solveRobustTriangulation(makeObsSet(), { seed: 42 });
    const r2 = solveRobustTriangulation(makeObsSet(), { seed: 42 });

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.point[0]).toBe(r2!.point[0]);
    expect(r1!.point[1]).toBe(r2!.point[1]);
    expect(r1!.point[2]).toBe(r2!.point[2]);
    expect(r1!.msacScore).toBe(r2!.msacScore);
  });

  // ─── Depth prior fading ────────────────────────────────────────────────

  test('with 1 ray, depth prior dominates; as rays accumulate, solution moves toward triangulated point', () => {
    // Single ray with depth pointing at (5, 0, 0)
    resetIds();
    const depthObs = makeObs(v3(0, 0, 0), v3(1, 0, 0), 1, v3(5, 0, 0), 10);
    const singleResult = solveRobustTriangulation([depthObs]);
    expect(singleResult).not.toBeNull();
    expect(singleResult!.point[0]).toBeCloseTo(5, 1);

    // Now add multiple rays converging at (3, 0, 0) — not the depth point
    resetIds();
    const realTarget = v3(3, 0, 0);
    const multiObs = [
      makeObs(v3(0, 0, 0), v3(1, 0, 0), 1, v3(5, 0, 0), 0.1), // weak depth
      makeObs(v3(0, -2, 0), v3(3, 2, 0), 1),
      makeObs(v3(0, 2, 0), v3(3, -2, 0), 1),
      makeObs(v3(0, 0, -2), v3(3, 0, 2), 1),
    ];
    const multiResult = solveRobustTriangulation(multiObs, {
      seed: 42,
      iterations: 200,
    });
    expect(multiResult).not.toBeNull();
    // Solution should be closer to the triangulated target (3,0,0) than the depth point (5,0,0)
    const distToTriangulated = Math.abs(multiResult!.point[0] - realTarget[0]);
    const distToDepth = Math.abs(multiResult!.point[0] - 5);
    expect(distToTriangulated).toBeLessThan(distToDepth);
  });

  // ─── Tri-state baseline flag ───────────────────────────────────────────

  test('hasSufficientBaseline is true when origins are spread', () => {
    resetIds();
    const obs = [
      makeObs(v3(-5, 0, 0), v3(1, 0, 0), 1),
      makeObs(v3(0, -5, 0), v3(0, 1, 0), 1),
      makeObs(v3(5, 0, 0), v3(-1, 0, 0), 1),
    ];
    const result = solveRobustTriangulation(obs, { minBaselineM: 1 });
    expect(result).not.toBeNull();
    expect(result!.hasSufficientBaseline).toBe(true);
  });

  test('hasSufficientBaseline is false when origins are clustered', () => {
    resetIds();
    const obs = [
      makeObs(v3(0, 0, 0), v3(1, 0.5, 0), 1),
      makeObs(v3(0.01, 0, 0), v3(1, -0.5, 0), 1),
      makeObs(v3(0, 0.01, 0), v3(1, 0, 0.5), 1),
    ];
    const result = solveRobustTriangulation(obs, { minBaselineM: 1 });
    expect(result).not.toBeNull();
    expect(result!.hasSufficientBaseline).toBe(false);
  });
});
