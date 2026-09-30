/**
 * Robust Triangulation — MSAC Fusion Module.
 *
 * Fuses ray triangulation (Component 1) with depth-prior observations
 * (Component 2) using M-Estimator Sample Consensus (MSAC) with:
 *   - Dual-mode hypothesis generation (Strategy A: depth, Strategy B: parallax)
 *   - Decoupled inlier classification / weighted scoring
 *   - Range-adaptive thresholds
 *   - Deterministic seeded PRNG
 *   - Early exits for trivial observation counts
 */

import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import {
  solveClosestPointOfApproach,
  perpendicularDistanceToRay,
  type Observation,
} from './ray-triangulation-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A measurement-ray observation with provenance metadata for entity storage. */
export interface MeasurementRayObservation {
  id: string;
  timestamp: number;
  rayOrigin: Vector3;
  rayDirection: Vector3;
  rayWeight: number;
  depthPoint?: Vector3;
  depthWeight?: number;
}

/** Result of robust triangulation via MSAC. */
export interface RobustTriangulationResult {
  point: Vector3;
  uncertainty: number;
  rmsError: number;
  msacScore: number;
  inlierIds: string[];
  outlierIds: string[];
  hasSufficientBaseline: boolean;
}

/** Options for the MSAC solver. */
export interface RobustTriangulationOptions {
  /** Base distance tolerance (metres) for inlier classification. Default: 0.5 */
  baseDistanceThreshold?: number;
  /** Angular tolerance (radians) for range-adaptive scaling. Default: 0.005 (~0.29°) */
  angularThresholdRadians?: number;
  /** Number of MSAC iterations. Default: 100 */
  iterations?: number;
  /** PRNG seed for deterministic replay. Default: 42 */
  seed?: number;
  /** Minimum baseline (metres) to set hasSufficientBaseline = true. Default: 0.5 */
  minBaselineM?: number;
  /** Minimum angle (radians) between ray pairs in Strategy B. Default: ~1° */
  minParallaxAngle?: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — xorshift32
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic seeded PRNG using xorshift32.
 * Returns a function that produces values in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  // Ensure non-zero state
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Range-adaptive threshold
// ---------------------------------------------------------------------------

/**
 * Computes a range-adaptive inlier threshold.
 *
 * threshold = baseTolerance + medianRange × tan(angularThresholdRadians)
 *
 * At close range the base tolerance dominates; at long range the angular
 * tolerance allows proportionally larger geometric errors.
 */
export function computeAdaptiveThreshold(
  hypothesisPoint: Vector3,
  cameraOrigins: Vector3[],
  baseTolerance: number,
  angularThresholdRadians: number
): number {
  if (cameraOrigins.length === 0) return baseTolerance;

  const ranges: number[] = [];
  for (const o of cameraOrigins) {
    const dx = hypothesisPoint[0] - o[0];
    const dy = hypothesisPoint[1] - o[1];
    const dz = hypothesisPoint[2] - o[2];
    ranges.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  ranges.sort((a, b) => a - b);
  const medianRange = ranges[Math.floor(ranges.length / 2)]!;

  return baseTolerance + medianRange * Math.tan(angularThresholdRadians);
}

// ---------------------------------------------------------------------------
// Decoupled MSAC observation scoring
// ---------------------------------------------------------------------------

/**
 * Along-ray depth error: |dot(P − depthPoint, d̂)|.
 * Matches the solver's d·dᵀ projector convention.
 */
function alongRayDepthError(
  point: Vector3,
  depthPoint: Vector3,
  rayDirection: Vector3
): number {
  const len = Math.sqrt(
    rayDirection[0] ** 2 + rayDirection[1] ** 2 + rayDirection[2] ** 2
  );
  if (len < 1e-10) return Infinity;
  const dx = rayDirection[0] / len;
  const dy = rayDirection[1] / len;
  const dz = rayDirection[2] / len;
  const vx = point[0] - depthPoint[0];
  const vy = point[1] - depthPoint[1];
  const vz = point[2] - depthPoint[2];
  return Math.abs(vx * dx + vy * dy + vz * dz);
}

/**
 * Evaluates a single observation against a hypothesis point.
 *
 * Decoupled scoring (from Design Decisions):
 * - **Inlier classification**: pure geometric distance.
 *   `rayDistance < threshold` AND (if depth exists) `depthDistance < threshold`.
 * - **MSAC score**: `rayWeight × min(rayDist², thresh²) + depthWeight × min(depthDist², thresh²)`.
 */
export function evaluateObservation(
  point: Vector3,
  obs: Observation,
  threshold: number
): { isInlier: boolean; msacScore: number } {
  const thresh2 = threshold * threshold;
  const rayDist = perpendicularDistanceToRay(
    point,
    obs.ray.origin,
    obs.ray.direction
  );
  const rayDist2 = rayDist * rayDist;

  let isInlier = rayDist < threshold;
  let msacScore =
    (obs.rayWeight > 0 ? obs.rayWeight : 1) * Math.min(rayDist2, thresh2);

  if (obs.depthPoint && obs.depthWeight != null && obs.depthWeight > 0) {
    const depthDist = alongRayDepthError(
      point,
      obs.depthPoint,
      obs.ray.direction
    );
    const depthDist2 = depthDist * depthDist;
    if (depthDist >= threshold) isInlier = false;
    msacScore += obs.depthWeight * Math.min(depthDist2, thresh2);
  }

  return { isInlier, msacScore };
}

// ---------------------------------------------------------------------------
// Baseline computation
// ---------------------------------------------------------------------------

/** Returns the maximum pairwise distance between any two camera origins. */
function computeMaxBaseline(origins: Vector3[]): number {
  let maxDist = 0;
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const dx = origins[i]![0] - origins[j]![0];
      const dy = origins[i]![1] - origins[j]![1];
      const dz = origins[i]![2] - origins[j]![2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxDist) maxDist = d;
    }
  }
  return maxDist;
}

// ---------------------------------------------------------------------------
// Convert MeasurementRayObservation → Observation
// ---------------------------------------------------------------------------

function toObservation(m: MeasurementRayObservation): Observation {
  return {
    ray: { origin: m.rayOrigin, direction: m.rayDirection },
    rayWeight: m.rayWeight,
    depthPoint: m.depthPoint,
    depthWeight: m.depthWeight,
  };
}

// ---------------------------------------------------------------------------
// Angle between two ray directions
// ---------------------------------------------------------------------------

function angleBetweenRays(d1: Vector3, d2: Vector3): number {
  const len1 = Math.sqrt(d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2);
  const len2 = Math.sqrt(d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2);
  if (len1 < 1e-10 || len2 < 1e-10) return 0;
  const dot = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (len1 * len2);
  return Math.acos(Math.max(-1, Math.min(1, Math.abs(dot))));
}

// ---------------------------------------------------------------------------
// Hypothesis generation
// ---------------------------------------------------------------------------

function generateHypothesis(
  observations: MeasurementRayObservation[],
  allObs: Observation[],
  depthIndices: number[],
  rng: () => number,
  minParallaxAngle: number
): Observation[] | null {
  const useStrategyA = depthIndices.length > 0 && rng() < 0.5;

  if (useStrategyA) {
    // Strategy A: pick 1 ray with depth prior
    const idx = depthIndices[Math.floor(rng() * depthIndices.length)]!;
    return [allObs[idx]!];
  } else {
    // Strategy B: pick 2 rays for pure triangulation
    // Try up to 10 times to find a non-degenerate pair
    const n = observations.length;
    for (let attempt = 0; attempt < 10; attempt++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * (n - 1));
      if (j >= i) j++;

      const angle = angleBetweenRays(
        observations[i]!.rayDirection,
        observations[j]!.rayDirection
      );
      // Reject near-parallel pairs (< minParallaxAngle)
      if (angle >= minParallaxAngle && angle <= Math.PI - minParallaxAngle) {
        return [allObs[i]!, allObs[j]!];
      }
    }
    return null; // All attempts degenerate — skip this iteration
  }
}

// ---------------------------------------------------------------------------
// Hypothesis evaluation
// ---------------------------------------------------------------------------

function scoreHypothesis(
  hypothesisPoint: Vector3,
  allObs: Observation[],
  observations: MeasurementRayObservation[],
  threshold: number
): { totalScore: number; inlierIds: string[]; outlierIds: string[] } {
  let totalScore = 0;
  const inlierIds: string[] = [];
  const outlierIds: string[] = [];
  const n = observations.length;

  for (let i = 0; i < n; i++) {
    const { isInlier, msacScore } = evaluateObservation(
      hypothesisPoint,
      allObs[i]!,
      threshold
    );
    totalScore += msacScore;
    if (isInlier) {
      inlierIds.push(observations[i]!.id);
    } else {
      outlierIds.push(observations[i]!.id);
    }
  }

  return { totalScore, inlierIds, outlierIds };
}

// ---------------------------------------------------------------------------
// Inlier Resolution
// ---------------------------------------------------------------------------

function resolveInliers(
  observations: MeasurementRayObservation[],
  bestInlierIds: string[],
  bestOutlierIds: string[],
  bestPoint: Vector3,
  bestScore: number,
  hasSufficientBaseline: boolean
): RobustTriangulationResult {
  const inlierSet = new Set(bestInlierIds);
  const inlierObs = observations
    .filter((o) => inlierSet.has(o.id))
    .map(toObservation);

  const finalResult = solveClosestPointOfApproach(inlierObs);
  if (!finalResult) {
    return {
      point: bestPoint,
      uncertainty: Infinity,
      rmsError: Infinity,
      msacScore: bestScore,
      inlierIds: bestInlierIds,
      outlierIds: bestOutlierIds,
      hasSufficientBaseline,
    };
  }

  return {
    point: finalResult.point,
    uncertainty: finalResult.uncertainty,
    rmsError: finalResult.rmsError,
    msacScore: bestScore,
    inlierIds: bestInlierIds,
    outlierIds: bestOutlierIds,
    hasSufficientBaseline,
  };
}

// ---------------------------------------------------------------------------
// Early Exits
// ---------------------------------------------------------------------------

function tryEarlyExit(
  observations: MeasurementRayObservation[],
  allObs: Observation[],
  hasSufficientBaseline: boolean
): RobustTriangulationResult | null {
  // ── Early exit: 1 observation ──────────────────────────────────────────
  if (observations.length === 1) {
    const obs = allObs[0]!;
    // Must have depth to solve a single ray
    if (!obs.depthPoint || !obs.depthWeight || obs.depthWeight <= 0) {
      return null;
    }
    const result = solveClosestPointOfApproach([obs]);
    if (!result) return null;
    return {
      point: result.point,
      uncertainty: result.uncertainty,
      rmsError: result.rmsError,
      msacScore: 0,
      inlierIds: [observations[0]!.id],
      outlierIds: [],
      hasSufficientBaseline: false,
    };
  }

  // ── Early exit: 2 observations ─────────────────────────────────────────
  if (observations.length === 2) {
    const result = solveClosestPointOfApproach(allObs);
    if (!result) return null;
    return {
      point: result.point,
      uncertainty: result.uncertainty,
      rmsError: result.rmsError,
      msacScore: 0,
      inlierIds: observations.map((o) => o.id),
      outlierIds: [],
      hasSufficientBaseline,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main MSAC solver
// ---------------------------------------------------------------------------

/**
 * Robust triangulation using MSAC (M-Estimator Sample Consensus).
 *
 * - **1 observation with depth**: direct solve, `hasSufficientBaseline = false`.
 * - **2 observations**: direct solve, baseline computed.
 * - **≥ 3 observations**: full MSAC with dual-mode hypothesis generation.
 *
 * Returns `null` if no valid solution can be found.
 */
// eslint-disable-next-line complexity
export function solveRobustTriangulation(
  observations: MeasurementRayObservation[],
  options?: RobustTriangulationOptions
): RobustTriangulationResult | null {
  if (observations.length === 0) return null;

  const baseThr = options?.baseDistanceThreshold ?? 0.5;
  const angThr = options?.angularThresholdRadians ?? 0.005;
  const maxIter = options?.iterations ?? 100;
  const seed = options?.seed ?? 42;
  const minBaselineM = options?.minBaselineM ?? 0.5;
  const minParallaxAngle = options?.minParallaxAngle ?? Math.PI / 180; // 1°

  const allObs = observations.map(toObservation);
  const allOrigins = observations.map((m) => m.rayOrigin);
  const baseline = computeMaxBaseline(allOrigins);
  const hasSufficientBaseline = baseline >= minBaselineM;

  if (observations.length <= 2) {
    return tryEarlyExit(observations, allObs, hasSufficientBaseline);
  }

  // ── ≥ 3 observations: full MSAC ───────────────────────────────────────
  const rng = createSeededRng(seed);
  const n = observations.length;

  // Pre-classify: which observations have usable depth priors?
  const depthIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    const obs = allObs[i]!;
    if (obs.depthPoint && obs.depthWeight != null && obs.depthWeight > 0) {
      depthIndices.push(i);
    }
  }

  let bestScore = Infinity;
  let bestInlierIds: string[] = [];
  let bestOutlierIds: string[] = [];
  let bestPoint: Vector3 | null = null;

  for (let iter = 0; iter < maxIter; iter++) {
    // ── Hypothesis generation ────────────────────────────────────────────
    const hypothesisObs = generateHypothesis(
      observations,
      allObs,
      depthIndices,
      rng,
      minParallaxAngle
    );
    if (!hypothesisObs) continue;

    // Solve hypothesis
    const hypothesisResult = solveClosestPointOfApproach(hypothesisObs);
    if (!hypothesisResult) continue;

    const hypothesisPoint = hypothesisResult.point;

    // ── Adaptive threshold ───────────────────────────────────────────────
    const threshold = computeAdaptiveThreshold(
      hypothesisPoint,
      allOrigins,
      baseThr,
      angThr
    );

    // ── Score all observations ───────────────────────────────────────────
    const { totalScore, inlierIds, outlierIds } = scoreHypothesis(
      hypothesisPoint,
      allObs,
      observations,
      threshold
    );

    if (totalScore < bestScore) {
      bestScore = totalScore;
      bestInlierIds = inlierIds;
      bestOutlierIds = outlierIds;
      bestPoint = hypothesisPoint;
    }
  }

  if (!bestPoint || bestInlierIds.length === 0) return null;

  return resolveInliers(
    observations,
    bestInlierIds,
    bestOutlierIds,
    bestPoint,
    bestScore,
    hasSufficientBaseline
  );
}
