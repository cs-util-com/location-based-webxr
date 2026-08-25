/**
 * QR pose math — unit tests.
 *
 * Why this test matters: these lock the conventions every later QR phase rides
 * on (object-point order, intrinsics-from-projection formula, OpenCV→WebXR
 * axis flip, mirror/degenerate rejection, reprojection gating, and the full
 * detected-corners → world-pose orchestration). Expectations are derived
 * independently of the implementation (hand-rolled projector / gl-matrix), so a
 * regression in the production transforms surfaces here, not on a device.
 *
 * gl-matrix uses Float32Array internally, so composed transforms carry ~1e-5
 * relative rounding; `toBeCloseTo` digit counts reflect that (cf.
 * depth-unprojection.property.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import {
  buildObjectPoints,
  rotateVectorByQuaternion,
  intrinsicsFromProjection,
  projectViewPoint,
  qrInCameraFromOpenCv,
  composePose,
  invertPose,
  transformPoint,
  validateQuad,
  signedQuadArea,
  reprojectionErrorPx,
  solveQrPose,
  type Pose,
  type Point2,
  type SolvePnpSquare,
  type OpenCvPnpResult,
} from './qr-pose';

const IDENTITY: Quaternion = [0, 0, 0, 1];

function yawQuat(angle: number): Quaternion {
  const q = quat.setAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), angle);
  return [q[0], q[1], q[2], q[3]];
}

describe('buildObjectPoints', () => {
  it('returns a centered square of the given side, TL,TR,BR,BL, on z=0', () => {
    const pts = buildObjectPoints(2);
    expect(pts).toEqual([
      [-1, 1, 0],
      [1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
    ]);
    // Side length between consecutive corners is exactly `sizeM`.
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(
        2,
        9
      );
    }
  });

  it('rejects non-positive or non-finite sizes', () => {
    expect(() => buildObjectPoints(0)).toThrow(RangeError);
    expect(() => buildObjectPoints(-1)).toThrow(RangeError);
    expect(() => buildObjectPoints(NaN)).toThrow(RangeError);
  });
});

describe('intrinsicsFromProjection', () => {
  it('matches a hand-computed symmetric perspective frustum', () => {
    const W = 640;
    const H = 480;
    const fovy = Math.PI / 3;
    const aspect = W / H;
    const p = Array.from(
      mat4.perspective(mat4.create(), fovy, aspect, 0.1, 1000)
    ) as unknown as Matrix4;

    const intr = intrinsicsFromProjection(p, W, H);
    // For a symmetric frustum the principal point is the image center.
    expect(intr.cx).toBeCloseTo(W / 2, 3);
    expect(intr.cy).toBeCloseTo(H / 2, 3);
    // fy = (H/2)/tan(fovy/2); fx = fy (square pixels, aspect already applied).
    const expectedFy = H / 2 / Math.tan(fovy / 2);
    expect(intr.fy).toBeCloseTo(expectedFy, 3);
    expect(intr.fx).toBeCloseTo(expectedFy, 3);
  });

  it('shifts the principal point for an off-center frustum', () => {
    const W = 100;
    const H = 100;
    // Asymmetric frustum: principal point should leave the center.
    const p = Array.from(
      mat4.frustum(mat4.create(), -0.1, 0.3, -0.2, 0.2, 0.1, 100)
    ) as unknown as Matrix4;
    const intr = intrinsicsFromProjection(p, W, H);
    expect(intr.cx).not.toBeCloseTo(W / 2, 1);
  });

  it('rejects malformed inputs', () => {
    const ok = Array.from(mat4.create()) as unknown as Matrix4;
    expect(() =>
      intrinsicsFromProjection([1, 2, 3] as unknown as Matrix4, 10, 10)
    ).toThrow();
    expect(() => intrinsicsFromProjection(ok, 0, 10)).toThrow();
  });
});

describe('projectViewPoint', () => {
  const intr = { fx: 500, fy: 500, cx: 320, cy: 240 };

  it('projects an on-axis point to the principal point', () => {
    const px = projectViewPoint([0, 0, -2], intr);
    expect(px).not.toBeNull();
    expect(px!.x).toBeCloseTo(320, 9);
    expect(px!.y).toBeCloseTo(240, 9);
  });

  it('maps +x to the right and +y upward (smaller py)', () => {
    const right = projectViewPoint([0.1, 0, -1], intr);
    const up = projectViewPoint([0, 0.1, -1], intr);
    expect(right!.x).toBeGreaterThan(320);
    expect(up!.y).toBeLessThan(240); // up in world = smaller py (top-left origin)
  });

  it('returns null for points not in front of the camera', () => {
    expect(projectViewPoint([0, 0, 0], intr)).toBeNull();
    expect(projectViewPoint([0, 0, 1], intr)).toBeNull();
  });
});

describe('qrInCameraFromOpenCv', () => {
  it('flips Y and Z of the translation (Rx(π))', () => {
    const pose = qrInCameraFromOpenCv({ rvec: [0, 0, 0], tvec: [1, 2, 3] });
    expect(pose.position).toEqual([1, -2, -3]);
  });

  it('agrees with both pinhole models (the OpenCV↔WebXR consistency check)', () => {
    // A non-trivial OpenCV pose.
    const rvec: Vector3 = [0.3, -0.5, 0.2];
    const tvec: Vector3 = [0.05, -0.02, 1.5];
    const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
    const objectPoints = buildObjectPoints(0.2);

    // OpenCV path: p_cam = R·p_obj + t, then OpenCV pinhole (px=cx+fx·X/Z).
    const angle = Math.hypot(...rvec);
    const R = quat.setAxisAngle(
      quat.create(),
      vec3.normalize(vec3.create(), vec3.fromValues(...rvec)),
      angle
    );
    const opencvPixels = objectPoints.map((obj) => {
      const v = vec3.transformQuat(vec3.create(), vec3.fromValues(...obj), R);
      const X = v[0] + tvec[0];
      const Y = v[1] + tvec[1];
      const Z = v[2] + tvec[2];
      return { x: intr.cx + (intr.fx * X) / Z, y: intr.cy + (intr.fy * Y) / Z };
    });

    // WebXR path: convert pose, transform, project with the WebXR pinhole.
    const qrInCam = qrInCameraFromOpenCv({ rvec, tvec });
    const webxrPixels = objectPoints.map(
      (obj) => projectViewPoint(transformPoint(obj, qrInCam), intr)!
    );

    for (let i = 0; i < 4; i++) {
      expect(webxrPixels[i].x).toBeCloseTo(opencvPixels[i].x, 3);
      expect(webxrPixels[i].y).toBeCloseTo(opencvPixels[i].y, 3);
    }
  });
});

describe('composePose / invertPose / transformPoint', () => {
  const pose: Pose = { position: [1, -2, 3], rotation: yawQuat(0.7) };

  it('compose(pose, invert(pose)) is the identity pose', () => {
    const id = composePose(pose, invertPose(pose));
    for (let i = 0; i < 3; i++) expect(id.position[i]).toBeCloseTo(0, 4);
    const dot =
      id.rotation[0] * IDENTITY[0] +
      id.rotation[1] * IDENTITY[1] +
      id.rotation[2] * IDENTITY[2] +
      id.rotation[3] * IDENTITY[3];
    expect(Math.abs(dot)).toBeCloseTo(1, 5);
  });

  it('transformPoint composes the same as applying poses in sequence', () => {
    const child: Pose = { position: [0.5, 0, 0], rotation: IDENTITY };
    const point: Vector3 = [1, 0, 0];
    const viaCompose = transformPoint(point, composePose(pose, child));
    const viaSequence = transformPoint(transformPoint(point, child), pose);
    for (let i = 0; i < 3; i++) {
      expect(viaCompose[i]).toBeCloseTo(viaSequence[i], 4);
    }
  });
});

describe('validateQuad / signedQuadArea', () => {
  // A front-facing QR in symbol order TL,TR,BR,BL is clockwise on a y-down
  // screen → positive signed area.
  const frontFacing: Point2[] = [
    { x: 10, y: 10 }, // TL
    { x: 90, y: 10 }, // TR
    { x: 90, y: 90 }, // BR
    { x: 10, y: 90 }, // BL
  ];

  it('accepts a well-formed front-facing quad', () => {
    expect(signedQuadArea(frontFacing)).toBeGreaterThan(0);
    const v = validateQuad(frontFacing);
    expect(v).toMatchObject({ ok: true, mirrored: false, degenerate: false });
    expect(v.areaPx2).toBeCloseTo(6400, 6);
  });

  it('flags a mirrored (reversed-winding) quad', () => {
    const mirrored = [...frontFacing].reverse();
    const v = validateQuad(mirrored);
    expect(v.mirrored).toBe(true);
    expect(v.ok).toBe(false);
  });

  it('flags a degenerate (tiny) quad', () => {
    const tiny: Point2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const v = validateQuad(tiny);
    expect(v.degenerate).toBe(true);
    expect(v.ok).toBe(false);
  });

  it('rejects non-finite or wrong-count inputs', () => {
    expect(
      validateQuad([
        { x: NaN, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]).ok
    ).toBe(false);
    expect(validateQuad([{ x: 0, y: 0 }]).ok).toBe(false);
  });
});

/**
 * A stub PnP solver that returns the exact OpenCV (rvec,tvec) corresponding to
 * a chosen WebXR `qrPoseInCamera`. It inverts `qrInCameraFromOpenCv`: since
 * Rx(π) is its own inverse, R_ocv = Rx(π)·R_webxr and t_ocv = (t0,−t1,−t2).
 * This lets the orchestration round-trip be tested with no OpenCV present.
 */
function makeExactSolver(qrPoseInCamera: Pose): SolvePnpSquare {
  return {
    solve(): OpenCvPnpResult {
      const rxPi = quat.fromValues(1, 0, 0, 0);
      const qWebxr = quat.fromValues(
        qrPoseInCamera.rotation[0],
        qrPoseInCamera.rotation[1],
        qrPoseInCamera.rotation[2],
        qrPoseInCamera.rotation[3]
      );
      const qOcv = quat.multiply(quat.create(), rxPi, qWebxr);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(qOcv[3])));
      const s = Math.sqrt(1 - qOcv[3] * qOcv[3]);
      const sign = qOcv[3] < 0 ? -1 : 1; // canonicalize to match acos branch
      const rvec: Vector3 =
        s < 1e-9
          ? [0, 0, 0]
          : [
              (sign * qOcv[0] * angle) / s,
              (sign * qOcv[1] * angle) / s,
              (sign * qOcv[2] * angle) / s,
            ];
      const t = qrPoseInCamera.position;
      return { rvec, tvec: [t[0], -t[1], -t[2]] };
    },
  };
}

describe('solveQrPose (orchestration round-trip)', () => {
  const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
  const sizeM = 0.2;

  // Known QR pose relative to the camera: 1.5 m in front, slightly rotated.
  const qrPoseInCamera: Pose = {
    position: [0.05, -0.03, -1.5],
    rotation: yawQuat(0.25),
  };

  // Camera pose in raw-WebXR/odom space.
  const cameraPose: Pose = { position: [3, 1, -2], rotation: yawQuat(1.1) };

  function projectedCorners(): Point2[] {
    return buildObjectPoints(sizeM).map(
      (obj) => projectViewPoint(transformPoint(obj, qrPoseInCamera), intr)!
    );
  }

  it('recovers the known world pose from projected corners', () => {
    const solution = solveQrPose({
      imagePoints: projectedCorners(),
      sizeM,
      intrinsics: intr,
      cameraPose,
      solver: makeExactSolver(qrPoseInCamera),
    });
    expect(solution).not.toBeNull();
    expect(solution!.reprojectionErrorPx).toBeLessThan(1e-3);

    const expectedWorld = composePose(cameraPose, qrPoseInCamera);
    for (let i = 0; i < 3; i++) {
      expect(solution!.qrPoseInCamera.position[i]).toBeCloseTo(
        qrPoseInCamera.position[i],
        4
      );
      expect(solution!.qrPoseWorld.position[i]).toBeCloseTo(
        expectedWorld.position[i],
        4
      );
    }
  });

  it('rejects a mirrored corner order', () => {
    const mirrored = projectedCorners().reverse();
    const solution = solveQrPose({
      imagePoints: mirrored,
      sizeM,
      intrinsics: intr,
      cameraPose,
      solver: makeExactSolver(qrPoseInCamera),
    });
    expect(solution).toBeNull();
  });

  it('rejects when the solver reports an object behind the camera', () => {
    const badSolver: SolvePnpSquare = {
      solve: () => ({ rvec: [0, 0, 0], tvec: [0, 0, -1] }),
    };
    const solution = solveQrPose({
      imagePoints: projectedCorners(),
      sizeM,
      intrinsics: intr,
      cameraPose,
      solver: badSolver,
    });
    expect(solution).toBeNull();
  });

  it('rejects a solution whose reprojection error exceeds the gate', () => {
    // Solver returns a pose at the wrong distance → corners reproject far off.
    const wrong: Pose = {
      position: [0.05, -0.03, -3.0],
      rotation: qrPoseInCamera.rotation,
    };
    const solution = solveQrPose({
      imagePoints: projectedCorners(),
      sizeM,
      intrinsics: intr,
      cameraPose,
      solver: makeExactSolver(wrong),
      maxReprojectionErrorPx: 4,
    });
    expect(solution).toBeNull();
  });
});

describe('reprojectionErrorPx', () => {
  it('is ~0 when the pose reproduces the image points', () => {
    const intr = { fx: 500, fy: 500, cx: 100, cy: 100 };
    const pose: Pose = { position: [0, 0, -1], rotation: IDENTITY };
    const obj = buildObjectPoints(0.1);
    const img = obj.map(
      (o) => projectViewPoint(transformPoint(o, pose), intr)!
    );
    expect(reprojectionErrorPx(obj, img, pose, intr)).toBeLessThan(1e-3);
  });

  it('is Infinity when a point falls behind the camera', () => {
    const intr = { fx: 500, fy: 500, cx: 100, cy: 100 };
    const pose: Pose = { position: [0, 0, 1], rotation: IDENTITY };
    const obj = buildObjectPoints(0.1);
    const img: Point2[] = obj.map(() => ({ x: 0, y: 0 }));
    expect(reprojectionErrorPx(obj, img, pose, intr)).toBe(Infinity);
  });
});

// Why these tests matter (M1 milestone review #3): rotateVectorByQuaternion
// is the double-precision kernel every geo-side rotation (vote offsets,
// minting) rides on, and it shipped without a direct test — including zero
// coverage of the quaternion cross-terms. The composite-axis case below is
// the one a single-axis rotation can never exercise.
describe('rotateVectorByQuaternion', () => {
  it('rotates 90° about y right-handedly (x → −z)', () => {
    const s = Math.SQRT1_2;
    const q: Quaternion = [0, s, 0, s];
    const r = rotateVectorByQuaternion(q, [1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(-1, 12);
  });

  it('matches the hand-derived result for a composite-axis rotation', () => {
    // 120° about the normalized (1,1,1) axis cyclically permutes the basis:
    // x → y → z → x. All quaternion cross-terms participate.
    const c = Math.sin(Math.PI / 3) / Math.sqrt(3); // sin(60°)/√3
    const q: Quaternion = [c, c, c, Math.cos(Math.PI / 3)];
    const rx = rotateVectorByQuaternion(q, [1, 0, 0]);
    expect(rx[0]).toBeCloseTo(0, 12);
    expect(rx[1]).toBeCloseTo(1, 12);
    expect(rx[2]).toBeCloseTo(0, 12);
    const rz = rotateVectorByQuaternion(q, [0, 0, 1]);
    expect(rz[0]).toBeCloseTo(1, 12);
    expect(rz[1]).toBeCloseTo(0, 12);
    expect(rz[2]).toBeCloseTo(0, 12);
  });

  it('preserves vector length for arbitrary rotations (isometry)', () => {
    const q: Quaternion = [0.1, 0.2, -0.3, Math.sqrt(1 - 0.01 - 0.04 - 0.09)];
    const v: Vector3 = [3, -4, 12];
    const r = rotateVectorByQuaternion(q, v);
    expect(Math.hypot(r[0], r[1], r[2])).toBeCloseTo(13, 12);
  });
});
