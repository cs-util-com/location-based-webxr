/**
 * Synthetic camera walks around a static QR code, for measuring multi-view
 * pose estimation offline (QR near-frontal pose plan 2026-09-23-2314, M0).
 *
 * Test-only. The world is WebXR's (y up). The camera always looks at the code
 * centre, upright, as a phone held by a walking user would. See
 * synthetic-qr-walk.ts.md.
 */

import type { Pose } from '../ar/qr/qr-pose';
import { composePose, invertPose } from '../ar/qr/qr-pose';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** The fixed walk shapes of the plan's done bar. */
export type WalkKind = 'approach' | 'sidestep' | 'arc' | 'still' | 'rise';

export interface WalkOptions {
  kind: WalkKind;
  /** The code's pose in the world; its +z is the printed face's normal. */
  codeWorld: Pose;
  /** Camera distance from the code centre at the walk's middle, metres. */
  distanceM: number;
  /**
   * The walk's size: `sidestep` total lateral travel (m), `rise` total
   * vertical travel through the code's height (m), `arc` total angle
   * around the code (deg), `approach` how far it starts behind `distanceM`
   * (m). Ignored by `still`.
   */
  extent: number;
  /** Camera poses along the walk (>= 1). */
  steps: number;
  /**
   * Where the walk is centred, as an angle off the code's normal (deg,
   * about the world's y axis). 0 = straight in front of the code.
   */
  offsetDeg?: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 0)) throw new RangeError('synthetic-qr-walk: zero-length vector');
  return [v[0] / n, v[1] / n, v[2] / n];
}

function rotateByQuat(v: Vec3, q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** Quaternion (xyzw) of the rotation whose matrix columns are x, y, z. */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * The world pose of an upright camera at `eye` looking at `target` (WebXR
 * camera frame: +x right, +y up, -z forward).
 */
export function lookAtPose(eye: Vec3, target: Vec3): Pose {
  const back = normalize(sub(eye, target));
  const right = normalize(cross([0, 1, 0], back));
  const up = cross(back, right);
  return { position: [...eye], rotation: quatFromBasis(right, up, back) };
}

/** Camera position at `distance` from `centre`, `angleDeg` off `normal` about world y. */
function around(
  centre: Vec3,
  normal: Vec3,
  distance: number,
  angleDeg: number
): Vec3 {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dir: Vec3 = [
    normal[0] * c + normal[2] * s,
    normal[1],
    -normal[0] * s + normal[2] * c,
  ];
  return [
    centre[0] + distance * dir[0],
    centre[1] + distance * dir[1],
    centre[2] + distance * dir[2],
  ];
}

function validate(options: WalkOptions): void {
  const { distanceM, extent, steps } = options;
  if (!(distanceM > 0) || !Number.isFinite(distanceM)) {
    throw new RangeError(
      `synthetic-qr-walk: distanceM must be > 0, got ${distanceM}`
    );
  }
  if (!Number.isFinite(extent) || extent < 0) {
    throw new RangeError(
      `synthetic-qr-walk: extent must be >= 0, got ${extent}`
    );
  }
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(
      `synthetic-qr-walk: steps must be an integer >= 1, got ${steps}`
    );
  }
}

/** Camera world poses along the walk, each looking at the code centre. */
export function walkCameraPoses(options: WalkOptions): Pose[] {
  validate(options);
  const { kind, codeWorld, distanceM, extent, steps, offsetDeg = 0 } = options;
  const centre = codeWorld.position as Vec3;
  const normal = rotateByQuat([0, 0, 1], codeWorld.rotation as Quat);
  const mid = around(centre, normal, distanceM, offsetDeg);
  const lateral = normalize(cross([0, 1, 0], sub(mid, centre)));
  const toward = normalize(sub(centre, mid));
  const poses: Pose[] = [];
  for (let k = 0; k < steps; k++) {
    const u = steps === 1 ? 0.5 : k / (steps - 1); // 0..1 along the walk
    let eye: Vec3;
    if (kind === 'sidestep') {
      const d = (u - 0.5) * extent;
      eye = [mid[0] + lateral[0] * d, mid[1], mid[2] + lateral[2] * d];
    } else if (kind === 'rise') {
      eye = [mid[0], mid[1] + (u - 0.5) * extent, mid[2]];
    } else if (kind === 'arc') {
      eye = around(centre, normal, distanceM, offsetDeg + (u - 0.5) * extent);
    } else if (kind === 'approach') {
      const back = (1 - u) * extent;
      eye = [mid[0] - toward[0] * back, mid[1], mid[2] - toward[2] * back];
    } else {
      eye = mid;
    }
    poses.push(lookAtPose(eye, centre));
  }
  return poses;
}

/** The code's pose in a camera's frame: the renderer's `qrPoseInCamera`. */
export function codeInCamera(cameraWorld: Pose, codeWorld: Pose): Pose {
  return composePose(invertPose(cameraWorld), codeWorld);
}

/**
 * Angle between the code's normal and the ray from the code centre to the
 * camera, degrees: how obliquely this view sees the code. 0 = straight on,
 * whatever the camera's orientation.
 */
export function rayAngleDeg(cameraWorld: Pose, codeWorld: Pose): number {
  const normal = rotateByQuat([0, 0, 1], codeWorld.rotation as Quat);
  const ray = normalize(
    sub(cameraWorld.position as Vec3, codeWorld.position as Vec3)
  );
  const dot = normal[0] * ray[0] + normal[1] * ray[1] + normal[2] * ray[2];
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}
