/**
 * Synthetic Depth Samples at Exact World Points (test-only helper)
 *
 * Builds `DepthSample`s whose points unproject EXACTLY to chosen raw-WebXR
 * world positions, through the REAL perspective-projection path — the
 * complement of `synthetic-occupancy-grid.ts` (which is limited by design
 * to solid box slabs seen from the origin with an identity projection).
 * Use this when a test needs arbitrary geometry (floors, slopes, noise
 * clusters) observed from an arbitrary camera pose: each world point is
 * forward-projected (world → view → clip → normalized screen + z-depth)
 * with the same matrix `createDepthUnprojector` will invert, so feeding
 * the sample to `OccupancyGrid.addSample` exercises the genuine fold
 * pipeline and lands each point where the test placed it (up to f32
 * projection round-off, well under a millimetre at room scale).
 *
 * @see synthetic-depth-samples.ts.md for detailed documentation
 */

import { mat4, quat, vec3, vec4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint, DepthSample } from '../types/ar-types';

// Wide-FOV projection (~126°, square aspect) so a downward-looking camera
// at head height sees a metres-wide floor patch — a default 60° matrix
// would clip the patches the floor-estimator tests need.
const PROJ_F32 = mat4.perspective(mat4.create(), 2.2, 1, 0.05, 100);

/** The serializable projection carried by every built sample. */
export const WIDE_TEST_PROJECTION: Matrix4 = Array.from(
  PROJ_F32
) as unknown as Matrix4;

/** −90° pitch: the camera looks straight down (view −z → world −y). */
export const LOOK_DOWN: Quaternion = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** +90° pitch: the camera looks straight up (view −z → world +y). */
export const LOOK_UP: Quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/**
 * Build a DepthSample whose points unproject exactly to `worldPoints`.
 * Throws on a fixture-authoring error (a point behind the camera or
 * outside the frustum) so a bad test setup fails loudly instead of
 * silently thinning the grid.
 */
export function makeWorldPointSample(
  cameraPos: Vector3,
  worldPoints: readonly Vector3[],
  cameraRot: Quaternion = LOOK_DOWN
): DepthSample {
  const invRot = quat.conjugate(quat.create(), cameraRot);
  const points: DepthPoint[] = worldPoints.map((w) => {
    const rel = vec3.fromValues(
      w[0] - cameraPos[0],
      w[1] - cameraPos[1],
      w[2] - cameraPos[2]
    );
    const view = vec3.transformQuat(vec3.create(), rel, invRot);
    if (view[2] >= 0) {
      throw new Error('test fixture error: world point behind the camera');
    }
    const clip = vec4.transformMat4(
      vec4.create(),
      vec4.fromValues(view[0], view[1], view[2], 1),
      PROJ_F32
    );
    const screenX = (clip[0] / clip[3] + 1) / 2;
    const screenY = (1 - clip[1] / clip[3]) / 2;
    if (screenX < 0 || screenX > 1 || screenY < 0 || screenY > 1) {
      throw new Error('test fixture error: world point outside the frustum');
    }
    return { screenX, screenY, depthM: -view[2] };
  });
  return {
    timestamp: 0,
    cameraPos,
    cameraRot,
    points,
    projectionMatrix: WIDE_TEST_PROJECTION,
  };
}

/** Regular XZ lattice of surface points, y given per (x, z). */
export function surfacePatch(
  yAt: (x: number, z: number) => number,
  extentM: number,
  stepM: number,
  centerX = 0,
  centerZ = 0
): Vector3[] {
  const pts: Vector3[] = [];
  for (let dx = -extentM; dx <= extentM + 1e-9; dx += stepM) {
    for (let dz = -extentM; dz <= extentM + 1e-9; dz += stepM) {
      const x = centerX + dx;
      const z = centerZ + dz;
      pts.push([x, yAt(x, z), z]);
    }
  }
  return pts;
}
