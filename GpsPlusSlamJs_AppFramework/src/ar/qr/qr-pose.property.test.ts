/**
 * QR pose math — property tests.
 *
 * Why this test matters: the conventions here (intrinsics-from-projection,
 * OpenCV→WebXR flip, size↔distance linearity, full detected-corners→world
 * round-trip) must hold for ANY plausible frustum and pose, not just the
 * hand-picked unit cases. Expectations are derived analytically / via gl-matrix
 * on a separate code path from the implementation. gl-matrix Float32 rounding
 * means pixel agreement is asserted to ~1e-3 px, world poses to ~1e-4.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { Matrix4, Quaternion } from 'gps-plus-slam-js';
import {
  buildObjectPoints,
  intrinsicsFromProjection,
  projectViewPoint,
  qrInCameraFromOpenCv,
  composePose,
  transformPoint,
  solveQrPose,
  validateQuad,
  type Pose,
  type Point2,
  type SolvePnpSquare,
} from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';

const arbFovy = fc.double({
  min: Math.PI / 6,
  max: (Math.PI * 2) / 3,
  noNaN: true,
});
const arbAspect = fc.double({ min: 0.4, max: 2.5, noNaN: true });
// A view point comfortably inside the frustum and in front of the camera.
const arbInFront = fc.record({
  x: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
  y: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
  z: fc.double({ min: -8, max: -1, noNaN: true }),
});

function yawQuat(angle: number): Quaternion {
  const q = quat.setAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), angle);
  return [q[0], q[1], q[2], q[3]];
}

describe('intrinsicsFromProjection — pinhole matches the GL projection', () => {
  it('projects any in-front view point the same as ndc-from-projection-matrix', () => {
    fc.assert(
      fc.property(arbFovy, arbAspect, arbInFront, (fovy, aspect, pt) => {
        const W = 800;
        const H = 600;
        const p = mat4.perspective(mat4.create(), fovy, aspect, 0.1, 1000);
        const intr = intrinsicsFromProjection(
          Array.from(p) as unknown as Matrix4,
          W,
          H
        );

        // Reference: full clip-space projection → ndc → pixel (top-left origin).
        const clip = clipFromMat4(p, pt.x, pt.y, pt.z);
        const ndcX = clip.x / clip.w;
        const ndcY = clip.y / clip.w;
        const refPx = ((ndcX + 1) * W) / 2;
        const refPy = ((1 - ndcY) * H) / 2;

        const got = projectViewPoint([pt.x, pt.y, pt.z], intr);
        expect(got).not.toBeNull();
        expect(Math.abs(got!.x - refPx)).toBeLessThan(1e-6 * W);
        expect(Math.abs(got!.y - refPy)).toBeLessThan(1e-6 * H);
      })
    );
  });
});

describe('qrInCameraFromOpenCv — agrees with both pinhole models', () => {
  it('OpenCV projection of object points equals WebXR projection of the converted pose', () => {
    const arbRvec = fc.tuple(
      fc.double({ min: -1.2, max: 1.2, noNaN: true }),
      fc.double({ min: -1.2, max: 1.2, noNaN: true }),
      fc.double({ min: -1.2, max: 1.2, noNaN: true })
    );
    const arbTvec = fc.tuple(
      fc.double({ min: -0.3, max: 0.3, noNaN: true }),
      fc.double({ min: -0.3, max: 0.3, noNaN: true }),
      fc.double({ min: 0.8, max: 5, noNaN: true }) // +z forward, in front
    );
    const arbSize = fc.double({ min: 0.05, max: 0.5, noNaN: true });

    fc.assert(
      fc.property(arbRvec, arbTvec, arbSize, (rvec, tvec, sizeM) => {
        const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
        const obj = buildObjectPoints(sizeM);

        const angle = Math.hypot(...rvec);
        const R =
          angle < 1e-9
            ? quat.create()
            : quat.setAxisAngle(
                quat.create(),
                vec3.normalize(vec3.create(), vec3.fromValues(...rvec)),
                angle
              );

        // OpenCV pinhole on p_cam = R·p_obj + t (only meaningful when in front).
        const opencvPixels = obj.map((o) => {
          const v = vec3.transformQuat(vec3.create(), vec3.fromValues(...o), R);
          const Z = v[2] + tvec[2];
          fc.pre(Z > 0.1);
          return {
            x: intr.cx + (intr.fx * (v[0] + tvec[0])) / Z,
            y: intr.cy + (intr.fy * (v[1] + tvec[1])) / Z,
          };
        });

        const qrInCam = qrInCameraFromOpenCv({ rvec, tvec });
        for (let i = 0; i < 4; i++) {
          const webxr = projectViewPoint(transformPoint(obj[i], qrInCam), intr);
          expect(webxr).not.toBeNull();
          // gl-matrix Float32 rounding → ~1e-5 px; allow a comfortable margin.
          expect(Math.abs(webxr!.x - opencvPixels[i].x)).toBeLessThan(1e-3);
          expect(Math.abs(webxr!.y - opencvPixels[i].y)).toBeLessThan(1e-3);
        }
      })
    );
  });
});

describe('size ↔ distance linearity (the §7 self-check premise)', () => {
  it('scaling object size and translation by k yields identical pixels', () => {
    const arbK = fc.double({ min: 1.1, max: 5, noNaN: true });
    const arbSize = fc.double({ min: 0.05, max: 0.4, noNaN: true });
    fc.assert(
      fc.property(arbSize, arbK, (sizeM, k) => {
        const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
        // Same pose, but a k× larger QR placed k× further away projects to the
        // identical pixels — i.e. a wrong assumed size moves ‖tvec‖ linearly.
        const poseNear: Pose = {
          position: [0.02, -0.01, -1.5],
          rotation: [0, 0, 0, 1],
        };
        const poseFar: Pose = {
          position: [0.02 * k, -0.01 * k, -1.5 * k],
          rotation: [0, 0, 0, 1],
        };

        const near = buildObjectPoints(sizeM).map((o) =>
          projectViewPoint(transformPoint(o, poseNear), intr)!
        );
        const far = buildObjectPoints(sizeM * k).map((o) =>
          projectViewPoint(transformPoint(o, poseFar), intr)!
        );
        for (let i = 0; i < 4; i++) {
          expect(Math.abs(near[i].x - far[i].x)).toBeLessThan(1e-3);
          expect(Math.abs(near[i].y - far[i].y)).toBeLessThan(1e-3);
        }
      })
    );
  });
});

describe('solveQrPose — full round-trip recovers the synthetic pose', () => {
  it('reconstructs qrPoseWorld from projected corners for random poses', () => {
    const arbRvec = fc.tuple(
      fc.double({ min: -0.8, max: 0.8, noNaN: true }),
      fc.double({ min: -0.8, max: 0.8, noNaN: true }),
      fc.double({ min: -0.8, max: 0.8, noNaN: true })
    );
    const arbTvec = fc.tuple(
      fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      fc.double({ min: 1, max: 4, noNaN: true })
    );
    const arbCamPos = fc.tuple(
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true })
    );
    const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

    fc.assert(
      fc.property(
        arbRvec,
        arbTvec,
        arbCamPos,
        arbAngle,
        (rvec, tvec, camPos, camAngle) => {
          const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
          const sizeM = 0.2;

          const qrInCam = qrInCameraFromOpenCv({ rvec, tvec });
          const obj = buildObjectPoints(sizeM);
          const corners: Point2[] = [];
          for (const o of obj) {
            const px = projectViewPoint(transformPoint(o, qrInCam), intr);
            fc.pre(px !== null); // require all corners in front / finite
            corners.push(px);
          }

          const cameraPose: Pose = {
            position: camPos,
            rotation: yawQuat(camAngle),
          };

          // Stub solver returns exactly the OpenCV (rvec,tvec) we started from.
          const solver: SolvePnpSquare = {
            solve: () => ({ rvec, tvec }),
          };

          const solution = solveQrPose({
            imagePoints: corners,
            sizeM,
            intrinsics: intr,
            cameraPose,
            solver,
          });

          // Some random quads validate as mirrored/degenerate — those legitimately
          // return null and are not a round-trip failure.
          if (solution === null) return;

          const expectedWorld = composePose(cameraPose, qrInCam);
          for (let i = 0; i < 3; i++) {
            expect(
              Math.abs(
                solution.qrPoseWorld.position[i] - expectedWorld.position[i]
              )
            ).toBeLessThan(1e-4);
          }
          const dot =
            solution.qrPoseWorld.rotation[0] * expectedWorld.rotation[0] +
            solution.qrPoseWorld.rotation[1] * expectedWorld.rotation[1] +
            solution.qrPoseWorld.rotation[2] * expectedWorld.rotation[2] +
            solution.qrPoseWorld.rotation[3] * expectedWorld.rotation[3];
          expect(Math.abs(Math.abs(dot) - 1)).toBeLessThan(1e-5);
        }
      )
    );
  });
});

describe('solveQrPose — end-to-end with the REAL pure-JS PlanarPnpSquare', () => {
  it('recovers qrPoseWorld from projected corners using the actual solver', () => {
    // The strongest end-to-end proof: no stub. Project a synthetic square,
    // feed the pixels to solveQrPose with the production PlanarPnpSquare, and
    // require the recovered world pose to match the ground truth. A clear tilt
    // keeps the planar flip distinguishable so the reprojection pick is correct.
    const arbAxis = fc
      .tuple(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true })
      )
      .filter(([x, y, z]) => Math.hypot(x, y, z) > 0.1);
    const arbAngle = fc.double({ min: 0.15, max: 0.7, noNaN: true });
    const arbTvec = fc.record({
      x: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      y: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      z: fc.double({ min: 1.2, max: 3.5, noNaN: true }),
    });
    const arbCamPos = fc.tuple(
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true })
    );
    const arbCamAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

    const solver = new PlanarPnpSquare();

    fc.assert(
      fc.property(
        arbAxis,
        arbAngle,
        arbTvec,
        arbCamPos,
        arbCamAngle,
        (axis, angle, tv, camPos, camAngle) => {
          const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
          const sizeM = 0.2;

          // Ground-truth OpenCV pose → rvec = angle · unit-axis.
          const n = vec3.normalize(vec3.create(), vec3.fromValues(...axis));
          const rvec: [number, number, number] = [
            angle * n[0],
            angle * n[1],
            angle * n[2],
          ];
          const tvec: [number, number, number] = [tv.x, tv.y, tv.z];

          const qrInCam = qrInCameraFromOpenCv({ rvec, tvec });
          const obj = buildObjectPoints(sizeM);
          const corners: Point2[] = [];
          for (const o of obj) {
            const px = projectViewPoint(transformPoint(o, qrInCam), intr);
            if (px === null) return; // corner behind camera — not a solver case
            corners.push(px);
          }
          // Quads the production winding guard rejects are legitimately not
          // solver inputs; skip them (early return, not an fc.pre skip).
          if (!validateQuad(corners).ok) return;

          const cameraPose: Pose = {
            position: camPos,
            rotation: yawQuat(camAngle),
          };

          const solution = solveQrPose({
            imagePoints: corners,
            sizeM,
            intrinsics: intr,
            cameraPose,
            solver,
          });
          expect(solution).not.toBeNull();

          const expectedWorld = composePose(cameraPose, qrInCam);
          for (let i = 0; i < 3; i++) {
            expect(
              Math.abs(
                solution!.qrPoseWorld.position[i] - expectedWorld.position[i]
              )
            ).toBeLessThan(2e-3);
          }
          const dot =
            solution!.qrPoseWorld.rotation[0] * expectedWorld.rotation[0] +
            solution!.qrPoseWorld.rotation[1] * expectedWorld.rotation[1] +
            solution!.qrPoseWorld.rotation[2] * expectedWorld.rotation[2] +
            solution!.qrPoseWorld.rotation[3] * expectedWorld.rotation[3];
          expect(Math.abs(Math.abs(dot) - 1)).toBeLessThan(1e-3);
        }
      ),
      { numRuns: 300 }
    );
  });
});

/** Multiply a column-major mat4 by [x,y,z,1], returning clip-space x,y,w. */
function clipFromMat4(
  m: mat4,
  x: number,
  y: number,
  z: number
): { x: number; y: number; w: number } {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    w: m[3] * x + m[7] * y + m[11] * z + m[15],
  };
}
