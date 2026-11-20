/**
 * PINHOLE camera intrinsics from a WebXR/ARCore projection matrix.
 *
 * One implementation for every reader of a recording's lens: the
 * Recorder's COLMAP export and the Tour Viewer's splat trainer reader both
 * call it, so the two can never disagree about the principal point.
 *
 * @see pinhole-from-projection.ts.md for the derivation and the pixel
 *   convention.
 */

import type { Matrix4 } from 'gps-plus-slam-js';

/** PINHOLE intrinsics in pixels (COLMAP camera model `PINHOLE`). */
export interface PinholeIntrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * Recover PINHOLE intrinsics from a column-major WebXR/ARCore projection
 * matrix and the image's pixel dimensions.
 *
 * Derivation (see sidecar): for an OpenGL-style perspective matrix `m` stored
 * column-major (`m[col*4 + row]`), projecting a view-space point and mapping
 * NDC to pixels (top-left origin, y down) gives:
 *  - `fx = 0.5 · W · m[0]`   (m00)
 *  - `fy = 0.5 · H · m[5]`   (m11)
 *  - `cx = 0.5 · W · (1 − m[8])`   (m20, the x skew/offset term)
 *  - `cy = 0.5 · H · (1 + m[9])`   (m21, the y skew/offset term)
 *
 * This is the CONTINUOUS pixel convention (pixel centres at half-integers,
 * the image spanning [0, W]): a centred, symmetric frustum gives exactly
 * `cx = W/2`, `cy = H/2`. A caller must not add a further half-pixel step.
 *
 * **W, H are the JPEG frame's pixel dimensions** (after any
 * `resolutionDivisor`), not the depth buffer's - the matrix is resolution
 * independent (it encodes the frustum in normalized coords).
 *
 * @throws RangeError if the matrix is not 16 finite numbers or W/H are not
 *   positive finite numbers, or if the recovered focal lengths are not
 *   positive (a degenerate/non-perspective matrix).
 */
export function pinholeFromProjection(
  projectionMatrix: Matrix4,
  width: number,
  height: number
): PinholeIntrinsics {
  if (
    projectionMatrix.length !== 16 ||
    !projectionMatrix.every(Number.isFinite)
  ) {
    throw new RangeError('projectionMatrix must be 16 finite numbers');
  }
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    throw new RangeError(
      `width and height must be positive finite numbers, got ${width}×${height}`
    );
  }

  const m00 = projectionMatrix[0];
  const m11 = projectionMatrix[5];
  const m20 = projectionMatrix[8];
  const m21 = projectionMatrix[9];

  const fx = 0.5 * width * m00;
  const fy = 0.5 * height * m11;
  const cx = 0.5 * width * (1 - m20);
  const cy = 0.5 * height * (1 + m21);

  if (!(fx > 0) || !(fy > 0)) {
    throw new RangeError(
      `recovered non-positive focal length (fx=${fx}, fy=${fy}); ` +
        'matrix is not a forward-facing perspective projection'
    );
  }

  return { fx, fy, cx, cy };
}

function isPositiveFinite(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}
