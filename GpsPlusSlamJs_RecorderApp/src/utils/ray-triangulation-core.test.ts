import { describe, expect, test } from 'vitest';
import {
  solveClosestPointOfApproach,
  perpendicularDistanceToRay,
  type Observation,
} from './ray-triangulation-core';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';

const INV_SQRT2 = 1 / Math.sqrt(2);

// ---------------------------------------------------------------------------
// Helper — shorthand for Vector3 tuples
// ---------------------------------------------------------------------------
const v3 = (x: number, y: number, z: number): Vector3 =>
  [x, y, z] as unknown as Vector3;

// ---------------------------------------------------------------------------
// perpendicularDistanceToRay
// ---------------------------------------------------------------------------

describe('perpendicularDistanceToRay', () => {
  test('point on the ray returns distance 0', () => {
    // Point (3,0,0) lies on ray from origin along +X
    expect(
      perpendicularDistanceToRay(v3(3, 0, 0), v3(0, 0, 0), v3(1, 0, 0))
    ).toBeCloseTo(0, 10);
  });

  test('point 1 m away from a ray returns distance 1', () => {
    // Point (0,1,0) is 1 m from the +X ray through origin
    expect(
      perpendicularDistanceToRay(v3(0, 1, 0), v3(0, 0, 0), v3(1, 0, 0))
    ).toBeCloseTo(1, 10);
  });

  test('handles un-normalized direction', () => {
    expect(
      perpendicularDistanceToRay(v3(0, 1, 0), v3(0, 0, 0), v3(5, 0, 0))
    ).toBeCloseTo(1, 10);
  });

  test('returns Infinity for zero-length direction', () => {
    expect(
      perpendicularDistanceToRay(v3(1, 1, 1), v3(0, 0, 0), v3(0, 0, 0))
    ).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// solveClosestPointOfApproach
// ---------------------------------------------------------------------------

describe('solveClosestPointOfApproach', () => {
  // ─── Edge cases ────────────────────────────────────────────────────────────

  test('returns null for empty observation array', () => {
    expect(solveClosestPointOfApproach([])).toBeNull();
  });

  test('returns null for a single ray with no depth prior (under-determined)', () => {
    const obs: Observation[] = [
      {
        ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
    ];
    expect(solveClosestPointOfApproach(obs)).toBeNull();
  });

  // ─── Two-ray intersection ──────────────────────────────────────────────────

  test('two exactly intersecting perpendicular rays return the intersection with ~zero rmsError', () => {
    // Ray 1 travels along +X from (-1, 0, 0).
    // Ray 2 travels along +Y from ( 0,-1, 0).
    // They meet at the origin (0, 0, 0).
    const obs: Observation[] = [
      {
        ray: { origin: v3(-1, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(0, 5);
    expect(result!.point[1]).toBeCloseTo(0, 5);
    expect(result!.point[2]).toBeCloseTo(0, 5);
    expect(result!.rmsError).toBeCloseTo(0, 5);
  });

  test('skew rays return the midpoint of the shortest connecting segment, rmsError = 0.5 m', () => {
    // Ray 1: along +X at z=0  → closest point on ray: (0, 0, 0)
    // Ray 2: along +Y at z=1  → closest point on ray: (0, 0, 1)
    // Midpoint is (0, 0, 0.5). Perpendicular distance from midpoint to each ray = 0.5 m.
    const obs: Observation[] = [
      {
        ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, 0, 1), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(0, 5);
    expect(result!.point[1]).toBeCloseTo(0, 5);
    expect(result!.point[2]).toBeCloseTo(0.5, 5);
    expect(result!.rmsError).toBeCloseTo(0.5, 5);
  });

  // ─── Weights ───────────────────────────────────────────────────────────────

  test('weights bias the result towards the heavier ray', () => {
    // Ray 1 (z=0 plane) has weight 9; Ray 2 (z=1) has weight 1.
    // Weighted result should be pulled well below z=0.5.
    const obs: Observation[] = [
      {
        ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 9,
      },
      {
        ray: { origin: v3(0, 0, 1), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[2]).toBeLessThan(0.5);
  });

  test('a zero-weight ray is fully ignored', () => {
    // The zero-weight ray points in a completely wrong direction.
    // Result should still converge to the intersection of the two valid rays at origin.
    const obs: Observation[] = [
      {
        ray: { origin: v3(-1, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(5, 5, 5), direction: v3(1, 0, 0) },
        rayWeight: 0,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(0, 5);
    expect(result!.point[1]).toBeCloseTo(0, 5);
    expect(result!.point[2]).toBeCloseTo(0, 5);
  });

  // ─── Depth prior ───────────────────────────────────────────────────────────

  test('single ray with a strong depth prior returns approximately the depth point', () => {
    // With only 1 ray, the geometry is under-determined without depth.
    // A strong along-ray depth prior pins the answer on the ray at the given distance.
    const obs: Observation[] = [
      {
        ray: { origin: v3(0, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
        depthPoint: v3(5, 0, 0),
        depthWeight: 10,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(5, 2);
    expect(result!.point[1]).toBeCloseTo(0, 2);
    expect(result!.point[2]).toBeCloseTo(0, 2);
  });

  test('strong triangulation baseline out-votes weak depth priors', () => {
    // Three rays converge at the origin (0, 0, 0) — directions are normalized.
    // Each carries a weak depth prior pointing toward z=1 — deliberately wrong.
    // The triangulation should win and pull the result near origin.
    const obs: Observation[] = [
      {
        ray: {
          origin: v3(-1, 1, 0),
          direction: v3(INV_SQRT2, -INV_SQRT2, 0),
        },
        rayWeight: 1,
        depthPoint: v3(0, 0, 1),
        depthWeight: 0.1,
      },
      {
        ray: {
          origin: v3(1, 1, 0),
          direction: v3(-INV_SQRT2, -INV_SQRT2, 0),
        },
        rayWeight: 1,
        depthPoint: v3(0, 0, 1),
        depthWeight: 0.1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 1, 0) },
        rayWeight: 1,
        depthPoint: v3(0, 0, 1),
        depthWeight: 0.1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point[2]).toBeLessThan(0.5);
  });

  // ─── Uncertainty metric ────────────────────────────────────────────────────

  test('adding more consistent rays lowers the uncertainty', () => {
    const twoRays: Observation[] = [
      {
        ray: { origin: v3(-1, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
    ];
    const threeRays: Observation[] = [
      ...twoRays,
      {
        ray: { origin: v3(0, 0, -1), direction: v3(0, 0, 1) },
        rayWeight: 1,
      },
    ];
    const r2 = solveClosestPointOfApproach(twoRays)!;
    const r3 = solveClosestPointOfApproach(threeRays)!;
    expect(r3.uncertainty).toBeLessThan(r2.uncertainty);
  });

  test('near-parallel rays (tiny baseline) produce higher uncertainty than wide-baseline rays', () => {
    const wideBaseline: Observation[] = [
      {
        ray: { origin: v3(-1, 0, 0), direction: v3(1, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 1, 0) },
        rayWeight: 1,
      },
    ];
    const narrowBaseline: Observation[] = [
      {
        ray: {
          origin: v3(-0.001, 0, 0),
          direction: v3(1, 0, 0),
        },
        rayWeight: 1,
      },
      {
        ray: {
          origin: v3(0.001, 0, 0),
          direction: v3(1, 0.001, 0),
        },
        rayWeight: 1,
      },
    ];
    const rWide = solveClosestPointOfApproach(wideBaseline)!;
    const rNarrow = solveClosestPointOfApproach(narrowBaseline)!;
    expect(rNarrow.uncertainty).toBeGreaterThan(rWide.uncertainty);
  });

  // ─── Normalization robustness ──────────────────────────────────────────────

  test('un-normalized input directions produce the same result as pre-normalized ones', () => {
    // Same geometry as the intersecting-perpendicular test but directions scaled by 2.
    const unnormalized: Observation[] = [
      {
        ray: { origin: v3(-1, 0, 0), direction: v3(2, 0, 0) },
        rayWeight: 1,
      },
      {
        ray: { origin: v3(0, -1, 0), direction: v3(0, 2, 0) },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(unnormalized);
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(0, 5);
    expect(result!.point[1]).toBeCloseTo(0, 5);
    expect(result!.point[2]).toBeCloseTo(0, 5);
    expect(result!.rmsError).toBeCloseTo(0, 5);
  });
});
