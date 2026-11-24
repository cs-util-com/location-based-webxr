/**
 * Test-only synthetic scenes of a planar target (a QR code or a rectangular
 * image target) seen from known camera poses, in double precision.
 *
 * The object points are passed in (`buildObjectPoints(widthM, aspectRatio)`),
 * so the helper never depends on how the production code builds them; the
 * aspect-1 golden test relies on that to compare against frozen values.
 */
import { mat4, vec4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';
import {
  projectViewPoint,
  rotateVectorByQuaternion,
  type CameraIntrinsics,
  type Point2,
  type Pose,
} from '../ar/qr/qr-pose';
import type { QrFusedEntry } from '../ar/qr/qr-fused-window';
import { mulberry32 } from './elevation-offset-scenarios';

/** The intrinsics every planar-target scene uses (a 1024 x 768 buffer). */
export const SCENE_INTRINSICS: CameraIntrinsics = {
  fx: 820,
  fy: 820,
  cx: 512,
  cy: 384,
};

/** A target's local points in the world (`target` applied in double precision). */
export function targetPointsInWorld(
  local: readonly Vector3[],
  target: Pose
): Vector3[] {
  return local.map((p) => {
    const w = rotateVectorByQuaternion(target.rotation, p);
    return [
      w[0] + target.position[0],
      w[1] + target.position[1],
      w[2] + target.position[2],
    ];
  });
}

/**
 * The pixels of world points seen from `camera`, each moved by up to
 * +-`noisePx` (uniform, from `rand`). Throws when a point is behind the
 * camera: a scene that does so is a broken test, not a case to skip.
 */
export function projectWorldPoints(
  world: readonly Vector3[],
  camera: Pose,
  options: {
    intrinsics?: CameraIntrinsics;
    noisePx?: number;
    rand?: () => number;
  } = {}
): Point2[] {
  const k = options.intrinsics ?? SCENE_INTRINSICS;
  const noise = options.noisePx ?? 0;
  const rand = options.rand ?? (() => 0.5);
  const inv: Quaternion = [
    -camera.rotation[0],
    -camera.rotation[1],
    -camera.rotation[2],
    camera.rotation[3],
  ];
  return world.map((w) => {
    const c = projectViewPoint(
      rotateVectorByQuaternion(inv, [
        w[0] - camera.position[0],
        w[1] - camera.position[1],
        w[2] - camera.position[2],
      ]),
      k
    );
    if (!c)
      throw new RangeError('synthetic-planar-target: point behind camera');
    return {
      x: c.x + (rand() * 2 - 1) * noise,
      y: c.y + (rand() * 2 - 1) * noise,
    };
  });
}

/** Multiply two quaternions [x, y, z, w]: a * b. */
function qmul(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * Fused-window entries of `cameras` looking at a target: exact corners plus
 * uniform +-`noisePx`, and the camera pose the TRACKER reports, off the true
 * one by uniform +-`jitterCm` and a rotation of up to `jitterDeg`.
 */
export function planarTargetEntries(
  local: readonly Vector3[],
  target: Pose,
  cameras: readonly Pose[],
  options: {
    noisePx?: number;
    jitterCm?: number;
    jitterDeg?: number;
    seed?: number;
    epoch?: number;
  } = {}
): QrFusedEntry[] {
  const rand = mulberry32(options.seed ?? 1);
  const u = () => rand() * 2 - 1;
  const world = targetPointsInWorld(local, target);
  return cameras.map((camera, i) => {
    const corners = projectWorldPoints(world, camera, {
      noisePx: options.noisePx ?? 0,
      rand,
    });
    const jc = (options.jitterCm ?? 0) / 100;
    const half = (((options.jitterDeg ?? 0) * Math.PI) / 180) * 0.5 * u();
    const axis = [u(), u(), u()];
    const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
    const s = Math.sin(half) / len;
    const delta: Quaternion = [
      axis[0]! * s,
      axis[1]! * s,
      axis[2]! * s,
      Math.cos(half),
    ];
    const reported: Pose = {
      position: [
        camera.position[0] + u() * jc,
        camera.position[1] + u() * jc,
        camera.position[2] + u() * jc,
      ],
      rotation: qmul(delta, camera.rotation),
    };
    return {
      timestamp: 1000 + i * 125,
      corners,
      cameraPose: reported,
      intrinsics: SCENE_INTRINSICS,
      frameEpoch: options.epoch ?? 0,
    };
  });
}

/** The projection the depth scenes use (camera at the origin, identity rotation). */
export const DEPTH_PROJECTION = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/** A camera-frame point (camera at the origin, -z forward) as a depth read. */
export function depthPointOf(world: Vector3): DepthPoint {
  const clip = vec4.transformMat4(
    vec4.create(),
    [world[0], world[1], world[2], 1],
    DEPTH_PROJECTION
  );
  return {
    screenX: (clip[0] / clip[3] + 1) / 2,
    screenY: (1 - clip[1] / clip[3]) / 2,
    depthM: -world[2],
  };
}

/** Bilinear lattice of `n x n` points across a quad (TL, TR, BR, BL). */
export function quadLattice(quad: readonly Vector3[], n: number): Vector3[] {
  const [tl, tr, br, bl] = quad as [Vector3, Vector3, Vector3, Vector3];
  const lerp = (a: Vector3, b: Vector3, t: number): Vector3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const v = n === 1 ? 0.5 : i / (n - 1);
    const top = lerp(tl, tr, v);
    const bottom = lerp(bl, br, v);
    for (let j = 0; j < n; j++) {
      pts.push(lerp(top, bottom, n === 1 ? 0.5 : j / (n - 1)));
    }
  }
  return pts;
}
