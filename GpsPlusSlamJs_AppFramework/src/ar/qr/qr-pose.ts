/**
 * QR pose math — Phase 1 of the QR-code detection & 3D-tracking plan.
 *
 * Pure, device-free, OpenCV-free transforms shared by every later phase:
 * - object-point builder for a centered planar square (the `solvePnP` model),
 * - camera intrinsics derived from the rendered view's projection matrix,
 * - the OpenCV camera frame (+x right, +y DOWN, +z FORWARD) → WebXR camera
 *   frame (+x right, +y UP, −z forward) conversion of a solved pose,
 * - rigid pose compose/invert to lift a QR-in-camera pose into raw-WebXR
 *   ("odom") space under `arWorldGroup`,
 * - quad winding validation (the mirror/degenerate guard the briefs warn about),
 * - reprojection error (the on-device verification gate's quality metric).
 *
 * The heavy `solvePnP` itself is injected via {@link SolvePnpSquare} so this
 * module — and its tests — need no OpenCV. See qr-pose.ts.md for the full
 * convention rationale and the OpenCV↔WebXR derivation.
 *
 * Convention notes (single source of truth):
 * - Image/pixel coordinates have a TOP-LEFT origin, x right, y DOWN — matching
 *   `depth-unprojection.ts`, `BarcodeDetector.cornerPoints`, and OpenCV.
 * - The QR-local object frame is +x right, +y UP, +z out of the printed face;
 *   the centered square lies on z = 0. Corner order is TL, TR, BR, BL as read
 *   on the printed symbol (carries the QR's reading orientation → pose yaw).
 * - `solvePnP` maps object→camera in the OpenCV frame: p_cam = R·p_obj + t.
 *   WebXR camera = Rx(π)·(OpenCV camera); Rx(π) = diag(1,−1,−1) is a proper
 *   rotation (det = +1), so the converted pose stays a rigid motion.
 */

import { quat, vec3 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';

/** A 2D point in image/pixel space (top-left origin, x right, y down). */
export interface Point2 {
  x: number;
  y: number;
}

/** Pinhole intrinsics in pixels for the exact buffer fed to the detector. */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** A rigid pose: rotation quaternion [x,y,z,w] + position [x,y,z]. */
export interface Pose {
  position: Vector3;
  rotation: Quaternion;
}

/** Raw OpenCV `solvePnP` output: Rodrigues rotation vector + translation. */
export interface OpenCvPnpResult {
  /** Rodrigues rotation vector (axis · angle), OpenCV camera frame. */
  rvec: Vector3;
  /** Translation (object origin in OpenCV camera frame), meters. */
  tvec: Vector3;
}

/**
 * Injected planar-PnP solver. The production implementation is the pure-JS
 * {@link PlanarPnpSquare} (planar-pnp.ts, IPPE); tests inject a stub. Returns `null`
 * when the solve fails (degenerate input, no convergence).
 */
export interface SolvePnpSquare {
  solve(
    objectPoints: readonly Vector3[],
    imagePoints: readonly Point2[],
    intrinsics: CameraIntrinsics
  ): OpenCvPnpResult | null;
}

/** Inputs for {@link solveQrPose}. */
export interface SolveQrPoseInput {
  /** The 4 detected corners, ordered TL, TR, BR, BL (symbol reading order). */
  imagePoints: readonly Point2[];
  /** Printed physical side length of the QR, meters (from the level file). */
  sizeM: number;
  /** Intrinsics for the exact pixel buffer the corners came from. */
  intrinsics: CameraIntrinsics;
  /** Capturing camera pose in raw-WebXR/odom space (`DepthSample.cameraPos/Rot`). */
  cameraPose: Pose;
  /** The PnP backend. */
  solver: SolvePnpSquare;
  /**
   * Reject the detection when the RMS reprojection error exceeds this many
   * pixels. Default 4 px (research2's runtime-stability heuristic).
   */
  maxReprojectionErrorPx?: number;
}

/** Result of {@link solveQrPose}. */
export interface QrPoseSolution {
  /** QR pose in raw-WebXR/odom space, ready to hang off `arWorldGroup`. */
  qrPoseWorld: Pose;
  /** QR pose relative to the WebXR camera (pre-composition). */
  qrPoseInCamera: Pose;
  /** RMS reprojection error in pixels (lower = better intrinsics/pose fit). */
  reprojectionErrorPx: number;
}

const DEFAULT_MAX_REPROJECTION_ERROR_PX = 4;

/**
 * Build the 4 object points of a centered planar square of side `sizeM`, in
 * the QR-local frame (+x right, +y up, z = 0), ordered TL, TR, BR, BL to match
 * the detector's symbol reading order.
 */
export function buildObjectPoints(
  sizeM: number
): [Vector3, Vector3, Vector3, Vector3] {
  if (!(sizeM > 0) || !Number.isFinite(sizeM)) {
    throw new RangeError(
      `qr-pose: sizeM must be a positive number, got ${sizeM}`
    );
  }
  const h = sizeM / 2;
  return [
    [-h, h, 0], // TL
    [h, h, 0], // TR
    [h, -h, 0], // BR
    [-h, -h, 0], // BL
  ];
}

/**
 * Derive pinhole intrinsics (pixels) from a column-major GL projection matrix
 * for a detector frame of `width`×`height`. Valid for an axis-aligned frustum
 * (no skew); principal point uses the TOP-LEFT-origin pixel convention.
 *
 * Derivation (see qr-pose.ts.md): for clip = P·v_view and pixel
 * px = (ndc.x+1)·W/2, py = (1−ndc.y)·H/2 with ndc = clip.xy / (−Z):
 *   fx = P[0]·W/2, fy = P[5]·H/2, cx = (1−P[8])·W/2, cy = (1+P[9])·H/2.
 */
export function intrinsicsFromProjection(
  projection: Matrix4,
  width: number,
  height: number
): CameraIntrinsics {
  if (!projection || projection.length !== 16) {
    throw new RangeError('qr-pose: projection must be a 16-element matrix');
  }
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError('qr-pose: width and height must be positive');
  }
  return {
    fx: (projection[0] * width) / 2,
    fy: (projection[5] * height) / 2,
    cx: ((1 - projection[8]) * width) / 2,
    cy: ((1 + projection[9]) * height) / 2,
  };
}

/**
 * Project a point given in the WebXR camera frame (+x right, +y up, −z forward)
 * to a pixel (top-left origin). Returns `null` for points not strictly in front
 * of the camera (z ≥ 0) or non-finite results.
 */
export function projectViewPoint(
  pointInCamera: Vector3,
  intrinsics: CameraIntrinsics
): Point2 | null {
  const [x, y, z] = pointInCamera;
  const depth = -z; // forward distance in WebXR view space
  if (!(depth > 0) || !Number.isFinite(depth)) {
    return null;
  }
  const px = intrinsics.cx + (intrinsics.fx * x) / depth;
  const py = intrinsics.cy - (intrinsics.fy * y) / depth;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}

/**
 * Convert a solved OpenCV pose (object→OpenCV-camera) into the QR pose in the
 * WebXR camera frame. Left-multiply by Rx(π): rotation = Rx(π)·R, position =
 * Rx(π)·t = (t0, −t1, −t2).
 */
export function qrInCameraFromOpenCv(pnp: OpenCvPnpResult): Pose {
  const { rvec, tvec } = pnp;
  const angle = Math.hypot(rvec[0], rvec[1], rvec[2]);
  const qR = quat.create();
  if (angle > 1e-12) {
    const axis = vec3.fromValues(
      rvec[0] / angle,
      rvec[1] / angle,
      rvec[2] / angle
    );
    quat.setAxisAngle(qR, axis, angle);
  }
  // Rx(π) = diag(1,−1,−1), a proper rotation (det = +1) mapping the OpenCV
  // camera frame (+y down, +z forward) onto the WebXR camera frame.
  const rxPi = quat.fromValues(1, 0, 0, 0);
  const qWorld = quat.multiply(quat.create(), rxPi, qR);
  quat.normalize(qWorld, qWorld);
  return {
    rotation: [qWorld[0], qWorld[1], qWorld[2], qWorld[3]],
    position: [tvec[0], -tvec[1], -tvec[2]],
  };
}

/** Compose two rigid poses: result = parent ∘ child (child expressed in parent). */
export function composePose(parent: Pose, child: Pose): Pose {
  const pq = quat.fromValues(
    parent.rotation[0],
    parent.rotation[1],
    parent.rotation[2],
    parent.rotation[3]
  );
  const cq = quat.fromValues(
    child.rotation[0],
    child.rotation[1],
    child.rotation[2],
    child.rotation[3]
  );
  const rq = quat.multiply(quat.create(), pq, cq);
  quat.normalize(rq, rq);

  const childPos = vec3.fromValues(
    child.position[0],
    child.position[1],
    child.position[2]
  );
  const rotated = vec3.transformQuat(vec3.create(), childPos, pq);
  return {
    rotation: [rq[0], rq[1], rq[2], rq[3]],
    position: [
      rotated[0] + parent.position[0],
      rotated[1] + parent.position[1],
      rotated[2] + parent.position[2],
    ],
  };
}

/** Invert a rigid pose: if pose maps A→B, the result maps B→A. */
export function invertPose(pose: Pose): Pose {
  const q = quat.fromValues(
    pose.rotation[0],
    pose.rotation[1],
    pose.rotation[2],
    pose.rotation[3]
  );
  const inv = quat.invert(quat.create(), q);
  quat.normalize(inv, inv);
  const p = vec3.fromValues(
    pose.position[0],
    pose.position[1],
    pose.position[2]
  );
  const negRotated = vec3.transformQuat(vec3.create(), p, inv);
  return {
    rotation: [inv[0], inv[1], inv[2], inv[3]],
    position: [-negRotated[0], -negRotated[1], -negRotated[2]],
  };
}

/**
 * Signed area of the quad TL→TR→BR→BL via the shoelace formula, in image
 * pixels (top-left origin, y down). A front-facing QR imaged in symbol order is
 * clockwise on screen → POSITIVE signed area in this y-down convention. A
 * negative value means the winding is reversed (mirrored / wrong corner order)
 * — the #1 pose bug the briefs warn about.
 */
export function signedQuadArea(corners: readonly Point2[]): number {
  let sum = 0;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    if (a === undefined || b === undefined) continue; // unreachable for in-bounds i
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Result of {@link validateQuad}. */
export interface QuadValidation {
  ok: boolean;
  /** True when the quad winding is reversed (mirrored corner order). */
  mirrored: boolean;
  /** True when the quad is too small or too thin to trust. */
  degenerate: boolean;
  /** |signed area| in px² — useful for a "too small" threshold. */
  areaPx2: number;
}

/**
 * Validate the 4 detected corners (assumed ordered TL, TR, BR, BL). Rejects a
 * mirrored winding and degenerate (tiny / collinear) quads. This does NOT
 * re-sort by image position — that would destroy the reading orientation the
 * detector encodes; it only guards the known failure modes.
 */
export function validateQuad(
  corners: readonly Point2[],
  options: { minAreaPx2?: number } = {}
): QuadValidation {
  const minAreaPx2 = options.minAreaPx2 ?? 64; // ~8×8 px floor
  if (
    corners.length !== 4 ||
    corners.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y))
  ) {
    return { ok: false, mirrored: false, degenerate: true, areaPx2: 0 };
  }
  const signed = signedQuadArea(corners);
  const areaPx2 = Math.abs(signed);
  const mirrored = signed < 0; // clockwise (front-facing) is positive here
  const degenerate = areaPx2 < minAreaPx2;
  return { ok: !mirrored && !degenerate, mirrored, degenerate, areaPx2 };
}

/**
 * RMS reprojection error (pixels): project the object points through
 * `qrPoseInCamera` (WebXR frame) and the pinhole model, compare to the detected
 * image points. `Infinity` if any point falls behind the camera.
 */
export function reprojectionErrorPx(
  objectPoints: readonly Vector3[],
  imagePoints: readonly Point2[],
  qrPoseInCamera: Pose,
  intrinsics: CameraIntrinsics
): number {
  if (objectPoints.length !== imagePoints.length || objectPoints.length === 0) {
    return Infinity;
  }
  let sumSq = 0;
  for (let i = 0; i < objectPoints.length; i++) {
    const obj = objectPoints[i];
    const img = imagePoints[i];
    if (obj === undefined || img === undefined) {
      return Infinity;
    }
    const projected = projectViewPoint(
      transformPoint(obj, qrPoseInCamera),
      intrinsics
    );
    if (!projected) {
      return Infinity;
    }
    const dx = projected.x - img.x;
    const dy = projected.y - img.y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / objectPoints.length);
}

/**
 * Rotate a vector by a unit quaternion in FULL double precision:
 * v' = v + 2·qv×(qv×v + w·v). Deliberately not gl-matrix (`transformPoint`
 * below): its default Float32Array backing loses ~2e-8 relative — fine for
 * odom-space points, not for geo offsets that get compared exactly in tests
 * and serialized into level files.
 */
export function rotateVectorByQuaternion(
  rotation: Quaternion,
  v: Vector3
): Vector3 {
  const [qx, qy, qz, qw] = rotation;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Apply a rigid pose to a point: result = rotation·p + position. */
export function transformPoint(point: Vector3, pose: Pose): Vector3 {
  const q = quat.fromValues(
    pose.rotation[0],
    pose.rotation[1],
    pose.rotation[2],
    pose.rotation[3]
  );
  const p = vec3.fromValues(point[0], point[1], point[2]);
  const r = vec3.transformQuat(vec3.create(), p, q);
  return [
    r[0] + pose.position[0],
    r[1] + pose.position[1],
    r[2] + pose.position[2],
  ];
}

/**
 * Full pipeline: detected corners → QR pose in raw-WebXR/odom space. Validates
 * the quad, solves PnP (injected), converts OpenCV→WebXR, composes with the
 * camera pose, and gates on reprojection error. Returns `null` when the
 * detection is rejected at any stage.
 */
export function solveQrPose(input: SolveQrPoseInput): QrPoseSolution | null {
  const {
    imagePoints,
    sizeM,
    intrinsics,
    cameraPose,
    solver,
    maxReprojectionErrorPx = DEFAULT_MAX_REPROJECTION_ERROR_PX,
  } = input;

  const validation = validateQuad(imagePoints);
  if (!validation.ok) {
    return null;
  }

  const objectPoints = buildObjectPoints(sizeM);
  const pnp = solver.solve(objectPoints, imagePoints, intrinsics);
  if (!pnp) {
    return null;
  }
  if (
    !pnp.rvec.every(Number.isFinite) ||
    !pnp.tvec.every(Number.isFinite) ||
    pnp.tvec[2] <= 0 // object must be in front of the OpenCV camera (+z forward)
  ) {
    return null;
  }

  const qrPoseInCamera = qrInCameraFromOpenCv(pnp);
  const reprojectionErrorPx_ = reprojectionErrorPx(
    objectPoints,
    imagePoints,
    qrPoseInCamera,
    intrinsics
  );
  if (!(reprojectionErrorPx_ <= maxReprojectionErrorPx)) {
    return null;
  }

  const qrPoseWorld = composePose(cameraPose, qrPoseInCamera);
  return {
    qrPoseWorld,
    qrPoseInCamera,
    reprojectionErrorPx: reprojectionErrorPx_,
  };
}
