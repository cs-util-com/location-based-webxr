import type { Vector3 } from 'gps-plus-slam-app-framework/core';

/**
 * Convert a raw WebXR AR-local position into the recorder's GPS-world frame.
 * The recorder's alignment matrix operates in NUE coordinates, so the static
 * WebXR-to-NUE basis change must happen before alignment.
 *
 * extractOdomPosition() returns raw WebXR coordinates [x, y, z].
 * NUE convention: X=North, Y=Up, Z=East.
 * WebXR convention: X=East, Y=Up, Z=South.
 * WEBXR_TO_NUE: NUE = (-WebXR.z, WebXR.y, WebXR.x)
 */
export function arLocalToGpsWorld(
  arPosition: Vector3,
  alignmentMatrix: readonly number[] | null | undefined
): Vector3 | null {
  if (!alignmentMatrix || alignmentMatrix.length !== 16) return null;

  // WEBXR_TO_NUE: NUE = (-WebXR.z, WebXR.y, WebXR.x)
  const nueX = -arPosition[2];
  const nueY = arPosition[1];
  const nueZ = arPosition[0];
  const m = alignmentMatrix;

  return [
    m[0]! * nueX + m[4]! * nueY + m[8]! * nueZ + m[12]!,
    m[1]! * nueX + m[5]! * nueY + m[9]! * nueZ + m[13]!,
    m[2]! * nueX + m[6]! * nueY + m[10]! * nueZ + m[14]!,
  ];
}