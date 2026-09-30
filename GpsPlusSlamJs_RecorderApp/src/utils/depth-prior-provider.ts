/**
 * Depth Prior Provider.
 * Samples the depth map along a ray, unprojects it, and attaches a confidence weight.
 */

import type {
  DepthPoint,
  DepthSample,
} from 'gps-plus-slam-app-framework/types/ar-types';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { createDepthGridLookup } from 'gps-plus-slam-app-framework/ar/depth-grid-lookup';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A depth-prior observation: a 3D world point and a confidence weight. */
export interface DepthPriorObservation {
  /** 3D world-space position of the depth reading. */
  readonly point: Vector3;
  /** Confidence weight in [0, 1]. */
  readonly weight: number;
  /** Raw depth reading in metres. */
  readonly depthM: number;
}

/** Options for sampleDepthPrior. */
export interface SampleDepthPriorOptions {
  /** Distance (m) at which confidence weight equals 0.5. Default: 2.0 */
  readonly referenceRangeM?: number;
  /** Max screen-space distance [0,1] to include in neighbourhood. Default: 0.10 */
  readonly maxScreenDist?: number;
  /** Max allowed depth std dev (m) before prior is rejected. Default: 0.5 */
  readonly maxAllowedDepthStdDevM?: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point. Bilinearly interpolates depth, checks for edges,
 * unprojects to world space, and computes a confidence weight.
 */
function parsePriorOptions(options?: SampleDepthPriorOptions) {
  return {
    maxScreenDist: options?.maxScreenDist ?? 0.1,
    referenceRangeM: options?.referenceRangeM ?? 2.0,
    maxAllowedDepthStdDevM: options?.maxAllowedDepthStdDevM ?? 0.5,
  };
}

export function sampleDepthPrior(
  sample: DepthSample | null | undefined,
  aimedScreenX: number,
  aimedScreenY: number,
  options?: SampleDepthPriorOptions
): DepthPriorObservation | null {
  if (!sample?.projectionMatrix) return null;

  const { maxScreenDist, referenceRangeM, maxAllowedDepthStdDevM } =
    parsePriorOptions(options);
  const { projectionMatrix, points, cameraPos, cameraRot } = sample;

  const depthM = createDepthGridLookup(points).depthAt(
    aimedScreenX,
    aimedScreenY
  );
  if (!(depthM! > 0)) return null;

  const localPoints = findDepthPointsInRadius(
    points,
    aimedScreenX,
    aimedScreenY,
    maxScreenDist
  );
  if (localPoints.length === 0) return null;

  const finalWeight =
    computeDepthWeight(depthM!, referenceRangeM) *
    computeEdgePenalty(localPoints, maxAllowedDepthStdDevM);
  if (finalWeight <= 0) return null;

  const unprojector = createDepthUnprojector(
    cameraPos,
    cameraRot,
    projectionMatrix
  );
  if (!unprojector) return null;

  const worldPt = unprojector.unproject({
    screenX: aimedScreenX,
    screenY: aimedScreenY,
    depthM: depthM!,
  });
  if (!worldPt) return null;

  return { point: worldPt, weight: finalWeight, depthM: depthM! };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all depth points within a screen-space radius. */
export function findDepthPointsInRadius(
  points: readonly DepthPoint[],
  aimedX: number,
  aimedY: number,
  maxDist: number
): DepthPoint[] {
  const maxDist2 = maxDist * maxDist;
  const results: DepthPoint[] = [];

  for (const p of points) {
    const dx = p.screenX - aimedX;
    const dy = p.screenY - aimedY;
    if (dx * dx + dy * dy <= maxDist2) {
      results.push(p);
    }
  }

  return results;
}

/** Compute edge confidence penalty based on local depth variance. */
export function computeEdgePenalty(
  localPoints: readonly DepthPoint[],
  maxAllowedDepthStdDevM: number
): number {
  if (localPoints.length <= 1) return 1.0;

  let sum = 0;
  for (const p of localPoints) {
    sum += p.depthM;
  }
  const mean = sum / localPoints.length;

  let sumSqDiff = 0;
  for (const p of localPoints) {
    const diff = p.depthM - mean;
    sumSqDiff += diff * diff;
  }

  const variance = sumSqDiff / localPoints.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev >= maxAllowedDepthStdDevM) return 0.0;
  const ratio = stdDev / maxAllowedDepthStdDevM;
  return 1.0 - ratio * ratio;
}

/** Quartic confidence weight matching active sensor noise laws. */
export function computeDepthWeight(
  depthM: number,
  referenceRangeM: number
): number {
  if (!Number.isFinite(depthM) || depthM < 0) return 0;
  if (!Number.isFinite(referenceRangeM) || referenceRangeM <= 0) return 0;
  const ratio = depthM / referenceRangeM;
  const ratio2 = ratio * ratio;
  return 1.0 / (1.0 + ratio2 * ratio2);
}
