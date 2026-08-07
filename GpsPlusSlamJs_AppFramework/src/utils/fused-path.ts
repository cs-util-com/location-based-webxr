/**
 * Fused Path Calculation
 *
 * Transforms AR odometry positions into GPS coordinates using the alignment matrix.
 * This enables displaying the "fused" SLAM+GPS trajectory on the session summary map.
 *
 * The alignment matrix (computed by the alignment solver in the library) transforms
 * AR-local odometry positions into NUE (North-Up-East) meters relative to a
 * GPS zero reference point. We then convert NUE to lat/lng for Leaflet.
 *
 * Internal coordinate convention: X=North, Y=Up, Z=East (right-handed).
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-01-27-user-feedback.md Issue #4b
 */

import { vec3, mat4 } from 'gl-matrix';
import {
  calcGpsCoords,
  type LatLong,
  type Vector3,
  type Matrix4,
} from 'gps-plus-slam-js';
import type { GpsCoord } from '../types/geo-types';

/** Input data for computing the fused path */
export interface FusedPathInput {
  /** Odometry positions in AR-local coordinates */
  odometryPositions: ReadonlyArray<Vector3>;
  /** Alignment matrix from the solver (null if not computed yet) */
  alignmentMatrix: Matrix4 | null;
  /** GPS origin for ENU conversion (null if no GPS data) */
  zeroRef: LatLong | null;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Compute the fused GPS path from odometry positions using the alignment matrix.
 *
 * Each odometry position is transformed by the alignment matrix to get ENU
 * coordinates (meters relative to zeroRef), then converted to GPS lat/lng.
 *
 * @param input - Odometry positions, alignment matrix, and GPS zero reference
 * @returns Array of GPS coordinates suitable for Leaflet polyline
 */
export function computeFusedPath(input: FusedPathInput): GpsCoord[] {
  const { odometryPositions, alignmentMatrix, zeroRef } = input;

  // Guard: need all three inputs
  if (!alignmentMatrix || !zeroRef || odometryPositions.length === 0) {
    return [];
  }

  // Convert the tuple to gl-matrix mat4 for transformations
  // Note: Matrix4 is already column-major (same as gl-matrix), no transpose needed
  const matrix = mat4.fromValues(...alignmentMatrix);

  // Pre-allocate vectors outside the loop to reduce GC pressure on long trajectories
  const odomVec = vec3.create();
  const alignedVec = vec3.create();

  // Transform each odometry position to GPS coordinates
  return odometryPositions.map((odomPos) => {
    // Reuse pre-allocated vec3
    vec3.set(odomVec, odomPos[0], odomPos[1], odomPos[2]);

    // Apply alignment matrix: AR-local → ENU meters
    vec3.transformMat4(alignedVec, odomVec, matrix);

    // Convert ENU to GPS lat/lng
    const gpsCoord = calcGpsCoords(zeroRef, alignedVec);

    // Return in Leaflet format (lng, not lon)
    return {
      lat: gpsCoord.lat,
      lng: gpsCoord.lon,
    };
  });
}

// Re-export the canonical single-point alignment→GPS pipeline from
// `gps-plus-slam-js` so framework consumers have one obvious entry point.
export { fusedGpsFromOdom } from 'gps-plus-slam-js';
