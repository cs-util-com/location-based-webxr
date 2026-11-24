/**
 * Properties of rectangular planar targets over random widths, aspect
 * ratios and poses.
 *
 * Why these tests matter: the unit cases pin five aspects at one pose. A
 * rectangle seen from an arbitrary angle is where a lingering square
 * assumption (a diagonal of sqrt 2, a height equal to the width) would show,
 * so the pose and both width measurers are checked across the whole range.
 */
// Activates the core library's licence before any module under test loads.
import '../../test-setup';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildObjectPoints, solveQrPose, type Pose } from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import { estimateQrSizeFromDepthDense } from './qr-size-from-depth';
import { createDepthUnprojector } from '../depth-unprojection';
import { rotationAngleDeg } from '../../test-utils/qr-zxing-pipeline';
import {
  DEPTH_PROJECTION,
  SCENE_INTRINSICS,
  depthPointOf,
  projectWorldPoints,
  quadLattice,
  targetPointsInWorld,
} from '../../test-utils/synthetic-planar-target';

const CAMERA: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/**
 * A target facing the camera at the origin, turned by yaw then pitch. Its
 * width is a share of the distance, so the whole target stays inside the
 * depth camera's 60 deg view at every turn.
 */
const targetArb = fc
  .record({
    widthShare: fc.double({ min: 0.05, max: 0.3, noNaN: true }),
    aspect: fc.double({ min: 0.4, max: 2.5, noNaN: true }),
    distanceM: fc.double({ min: 0.6, max: 4, noNaN: true }),
    yawDeg: fc.double({ min: -40, max: 40, noNaN: true }),
    pitchDeg: fc.double({ min: -30, max: 30, noNaN: true }),
  })
  .map((t) => ({ ...t, widthM: t.widthShare * t.distanceM }));

function poseOf(t: { distanceM: number; yawDeg: number; pitchDeg: number }) {
  const y = (t.yawDeg * Math.PI) / 360;
  const p = (t.pitchDeg * Math.PI) / 360;
  // q = qYaw * qPitch, both about the target's own axes.
  const qy = [0, Math.sin(y), 0, Math.cos(y)];
  const qp = [Math.sin(p), 0, 0, Math.cos(p)];
  const rotation: Pose['rotation'] = [
    qy[3]! * qp[0]!,
    qy[1]! * qp[3]!,
    -qy[1]! * qp[0]!,
    qy[3]! * qp[3]!,
  ];
  return { position: [0, 0, -t.distanceM], rotation } as Pose;
}

describe('rectangular planar targets', () => {
  it('the single-view solve recovers the pose of any rectangle', () => {
    fc.assert(
      fc.property(targetArb, (t) => {
        const pose = poseOf(t);
        const local = buildObjectPoints(t.widthM, t.aspect);
        const corners = projectWorldPoints(
          targetPointsInWorld(local, pose),
          CAMERA
        );
        const sol = solveQrPose({
          imagePoints: corners,
          sizeM: t.widthM,
          aspectRatio: t.aspect,
          intrinsics: SCENE_INTRINSICS,
          cameraPose: CAMERA,
          solver: new PlanarPnpSquare(),
        });
        expect(sol).not.toBeNull();
        // The solver returns a float32 rotation: up to about 1e-3 px of rounding.
        expect(sol!.reprojectionErrorPx).toBeLessThan(0.01);
        // A single view fixes the tilt only to float32 rounding (about 0.03 deg).
        expect(
          rotationAngleDeg(sol!.qrPoseWorld.rotation, pose.rotation)
        ).toBeLessThan(0.1);
        const err = Math.hypot(
          sol!.qrPoseWorld.position[0] - pose.position[0],
          sol!.qrPoseWorld.position[1] - pose.position[1],
          sol!.qrPoseWorld.position[2] - pose.position[2]
        );
        expect(err).toBeLessThan(1e-5 * t.distanceM);
      }),
      { numRuns: 80, seed: 11 }
    );
  });

  it('the dense depth measurer reports the width of any rectangle', () => {
    const unprojector = createDepthUnprojector(
      [0, 0, 0],
      [0, 0, 0, 1],
      DEPTH_PROJECTION
    )!;
    fc.assert(
      fc.property(targetArb, (t) => {
        const quad = targetPointsInWorld(
          buildObjectPoints(t.widthM, t.aspect),
          poseOf(t)
        );
        const screens = quad.map(depthPointOf) as [
          ReturnType<typeof depthPointOf>,
          ReturnType<typeof depthPointOf>,
          ReturnType<typeof depthPointOf>,
          ReturnType<typeof depthPointOf>,
        ];
        const obs = estimateQrSizeFromDepthDense(
          screens,
          quadLattice(quad, 4).map(depthPointOf),
          unprojector,
          t.aspect
        );
        expect(obs).not.toBeNull();
        expect(Math.abs(obs!.sizeM - t.widthM) / t.widthM).toBeLessThan(1e-6);
        expect(obs!.quality).toBeGreaterThan(0.9999);
      }),
      { numRuns: 80, seed: 12 }
    );
  });
});
