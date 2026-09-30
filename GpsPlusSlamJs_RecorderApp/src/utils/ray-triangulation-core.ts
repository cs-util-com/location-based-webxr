/**
 * Ray Triangulation Core.
 *
 * Least-squares closest-point-of-approach solver for N weighted rays,
 * with optional depth-prior fusion. All geometry uses the framework's
 * `Vector3 = readonly [number, number, number]` tuple type.
 */

import type { Vector3 } from 'gps-plus-slam-app-framework/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 3D ray. Direction need not be pre-normalized; the solver normalizes internally. */
interface Ray {
  origin: Vector3;
  direction: Vector3;
}

/**
 * One "measurement shot". Ray + optional depth reading are grouped so
 * outlier-rejection (e.g. MSAC) can atomically discard both.
 */
export interface Observation {
  ray: Ray;
  /** Confidence in the ray direction. Typically 1.0; lower if tracking was unstable. */
  rayWeight: number;
  /** 3D point derived from the depth map along this ray. */
  depthPoint?: Vector3;
  /** Confidence in the depth reading. Decays with distance. */
  depthWeight?: number;
}

/** Result of triangulating N observations. */
export interface TriangulationResult {
  point: Vector3;
  /**
   * trace(A⁻¹) — high when rays are nearly parallel (small baseline).
   * Drives the "move sideways" coaching prompt.
   */
  uncertainty: number;
  /** Average perpendicular distance (metres) from the solved point to each ray. */
  rmsError: number;
}

// ---------------------------------------------------------------------------
// 3×3 matrix helpers
// ---------------------------------------------------------------------------

type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Inverts a 3×3 row-major matrix. Returns null when |det| < 1e-8 (singular). */
function invertMatrix3x3(m: Mat3): Mat3 | null {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < 1e-8) return null;
  const inv = 1.0 / det;
  return [
    (m[4] * m[8] - m[7] * m[5]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[3] * m[2] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[6] * m[4]) * inv,
    (m[6] * m[1] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[3] * m[1]) * inv,
  ];
}

// ---------------------------------------------------------------------------
// Perpendicular distance (exported for MSAC scoring)
// ---------------------------------------------------------------------------

/**
 * Compute the perpendicular distance from point P to a ray.
 * Uses the cross-product identity: ||(P − o) × d̂|| = perpendicular distance.
 *
 * Extracted from computeRMSError for standalone MSAC scoring.
 */
export function perpendicularDistanceToRay(
  point: Vector3,
  rayOrigin: Vector3,
  rayDirection: Vector3
): number {
  const len = Math.sqrt(
    rayDirection[0] ** 2 + rayDirection[1] ** 2 + rayDirection[2] ** 2
  );
  if (len < 1e-10) return Infinity;
  const dx = rayDirection[0] / len;
  const dy = rayDirection[1] / len;
  const dz = rayDirection[2] / len;
  const pox = point[0] - rayOrigin[0];
  const poy = point[1] - rayOrigin[1];
  const poz = point[2] - rayOrigin[2];
  // cross product (P-o) × d̂
  const cx = poy * dz - poz * dy;
  const cy = poz * dx - pox * dz;
  const cz = pox * dy - poy * dx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Least-squares closest-point-of-approach solver for N weighted rays.
 *
 * Ray term:   A += w·(I − d·dᵀ),   B += w·(I − d·dᵀ)·o
 * Depth term: A += w·(d·dᵀ),       B += w·(d·p)·d
 *
 * The two terms are orthogonal complements, so ray and depth constraints
 * never fight each other. Returns null when A is singular.
 */
export function solveClosestPointOfApproach(
  observations: Observation[]
): TriangulationResult | null {
  if (observations.length === 0) return null;

  const A: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const B: [number, number, number] = [0, 0, 0];

  for (const obs of observations) {
    const len = Math.sqrt(
      obs.ray.direction[0] ** 2 +
        obs.ray.direction[1] ** 2 +
        obs.ray.direction[2] ** 2
    );
    if (len < 1e-10) continue;
    const dx = obs.ray.direction[0] / len;
    const dy = obs.ray.direction[1] / len;
    const dz = obs.ray.direction[2] / len;

    if (obs.rayWeight > 0) {
      const ox = obs.ray.origin[0];
      const oy = obs.ray.origin[1];
      const oz = obs.ray.origin[2];
      const w = obs.rayWeight;
      // M = I − d·dᵀ
      const M: Mat3 = [
        1 - dx * dx,
        -dx * dy,
        -dx * dz,
        -dy * dx,
        1 - dy * dy,
        -dy * dz,
        -dz * dx,
        -dz * dy,
        1 - dz * dz,
      ];
      A[0] += M[0] * w;
      A[1] += M[1] * w;
      A[2] += M[2] * w;
      A[3] += M[3] * w;
      A[4] += M[4] * w;
      A[5] += M[5] * w;
      A[6] += M[6] * w;
      A[7] += M[7] * w;
      A[8] += M[8] * w;
      B[0] += (M[0] * ox + M[1] * oy + M[2] * oz) * w;
      B[1] += (M[3] * ox + M[4] * oy + M[5] * oz) * w;
      B[2] += (M[6] * ox + M[7] * oy + M[8] * oz) * w;
    }

    if (obs.depthPoint && obs.depthWeight != null && obs.depthWeight > 0) {
      const px = obs.depthPoint[0];
      const py = obs.depthPoint[1];
      const pz = obs.depthPoint[2];
      const w = obs.depthWeight;
      // D = d·dᵀ (along-ray projector — orthogonal complement of M)
      A[0] += dx * dx * w;
      A[1] += dx * dy * w;
      A[2] += dx * dz * w;
      A[3] += dy * dx * w;
      A[4] += dy * dy * w;
      A[5] += dy * dz * w;
      A[6] += dz * dx * w;
      A[7] += dz * dy * w;
      A[8] += dz * dz * w;
      const dDotP = dx * px + dy * py + dz * pz;
      B[0] += dx * dDotP * w;
      B[1] += dy * dDotP * w;
      B[2] += dz * dDotP * w;
    }
  }

  const A_inv = invertMatrix3x3(A);
  if (!A_inv) return null;

  const P: Vector3 = [
    A_inv[0] * B[0] + A_inv[1] * B[1] + A_inv[2] * B[2],
    A_inv[3] * B[0] + A_inv[4] * B[1] + A_inv[5] * B[2],
    A_inv[6] * B[0] + A_inv[7] * B[1] + A_inv[8] * B[2],
  ];

  const rmsError = computeRMSError(observations, P);
  const uncertainty = A_inv[0] + A_inv[4] + A_inv[8];

  return { point: P, uncertainty, rmsError };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Computes the Root Mean Square perpendicular distance from point P to all valid rays. */
function computeRMSError(observations: Observation[], P: Vector3): number {
  let sumSq = 0;
  let validRays = 0;
  for (const obs of observations) {
    if (obs.rayWeight <= 0) continue;
    const dist = perpendicularDistanceToRay(
      P,
      obs.ray.origin,
      obs.ray.direction
    );
    if (!Number.isFinite(dist)) continue;
    sumSq += dist * dist;
    validRays++;
  }
  return validRays > 0 ? Math.sqrt(sumSq / validRays) : 0;
}
