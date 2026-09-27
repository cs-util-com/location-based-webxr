/**
 * A QR code's printed size from parallax (QR size consensus plan §2, §7, S1).
 *
 * Why these tests matter: a code whose size nobody stated is sized from how
 * its views line up as the camera moves - the tracker knows every camera
 * position in metres, so views from different spots fix the scale without
 * the depth sensor. The estimate must be right on the walks people make
 * (a step sideways, an arc) with a realistic tracker jitter, and it must
 * REFUSE when the views carry no scale (standing still, walking straight at
 * the code, a tiny step, a code too small on screen) instead of returning
 * a confident wrong size: the probe showed standing still gives errors of
 * hundreds of percent and the fit's own error estimate misses it (§4, §6 #3).
 */
import { describe, expect, it } from 'vitest';
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  solveQrPose,
  type CameraIntrinsics,
  type Point2,
  type Pose,
} from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import type { QrFusedEntry } from './qr-fused-window';
import { estimateQrSizeFromParallax } from './qr-size-parallax';
import { walkCameraPoses } from '../../test-utils/synthetic-qr-walk';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';

const K: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };
/** A code on a wall at chest height, turned 10 deg. */
const CODE: Pose = {
  position: [0, 1.4, 0],
  rotation: [0, Math.sin(Math.PI / 36), 0, Math.cos(Math.PI / 36)],
};

type Walk = Parameters<typeof walkCameraPoses>[0];

/**
 * Entries of a walk past a code of side `sizeM`: exact corners plus
 * uniform +-`noisePx`, and the camera pose the TRACKER reports, off the
 * true one by uniform +-`jitterCm` / +-`jitterDeg` (plan §4).
 */
function entries(
  walk: Omit<Walk, 'codeWorld'>,
  options: {
    sizeM?: number;
    noisePx?: number;
    jitterCm?: number;
    jitterDeg?: number;
    seed?: number;
    epoch?: number;
  } = {}
): QrFusedEntry[] {
  const sizeM = options.sizeM ?? 0.16;
  const rand = mulberry32(options.seed ?? 1);
  const u = () => rand() * 2 - 1;
  const cams = walkCameraPoses({ ...walk, codeWorld: CODE });
  return cams.map((camera, i) => {
    const inv: Pose['rotation'] = [
      -camera.rotation[0],
      -camera.rotation[1],
      -camera.rotation[2],
      camera.rotation[3],
    ];
    const corners: Point2[] = buildObjectPoints(sizeM).map((p) => {
      const w = rotateVectorByQuaternion(CODE.rotation, p);
      const c = projectViewPoint(
        rotateVectorByQuaternion(inv, [
          w[0] + CODE.position[0] - camera.position[0],
          w[1] + CODE.position[1] - camera.position[1],
          w[2] + CODE.position[2] - camera.position[2],
        ]),
        K
      )!;
      const n = options.noisePx ?? 0;
      return { x: c.x + u() * n, y: c.y + u() * n };
    });
    const jc = (options.jitterCm ?? 0) / 100;
    const half = (((options.jitterDeg ?? 0) * Math.PI) / 180) * 0.5 * u();
    const axis = [u(), u(), u()];
    const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
    const s = Math.sin(half) / len;
    const [dx, dy, dz, dw] = [
      axis[0]! * s,
      axis[1]! * s,
      axis[2]! * s,
      Math.cos(half),
    ];
    const [qx, qy, qz, qw] = camera.rotation;
    const reported: Pose = {
      position: [
        camera.position[0] + u() * jc,
        camera.position[1] + u() * jc,
        camera.position[2] + u() * jc,
      ],
      rotation: [
        dw * qx + dx * qw + dy * qz - dz * qy,
        dw * qy - dx * qz + dy * qw + dz * qx,
        dw * qz + dx * qy - dy * qx + dz * qw,
        dw * qw - dx * qx - dy * qy - dz * qz,
      ],
    };
    return {
      timestamp: 1000 + i * 125,
      corners,
      cameraPose: reported,
      intrinsics: K,
      frameEpoch: options.epoch ?? 0,
    };
  });
}

const relErr = (sizeM: number, truth: number) => Math.abs(sizeM / truth - 1);

describe('estimateQrSizeFromParallax', () => {
  // Plan §2: why a nominal size works at all. A single-view solve at a wrong
  // size places the code on the SAME ray from the camera, scaled about the
  // camera by that size ratio - so the rays point at the true centre.
  it('relies on single-view solves scaling about the camera with the size', () => {
    const [e] = entries(
      { kind: 'sidestep', distanceM: 1.5, extent: 0.3, steps: 1 },
      { noisePx: 1 }
    );
    const solve = (sizeM: number) =>
      solveQrPose({
        imagePoints: e!.corners,
        sizeM,
        intrinsics: K,
        cameraPose: e!.cameraPose,
        solver: new PlanarPnpSquare(),
      })!.qrPoseWorld;
    const a = solve(0.16);
    const b = solve(0.24);
    const cam = e!.cameraPose.position;
    for (let j = 0; j < 3; j++) {
      expect(b.position[j]! - cam[j]!).toBeCloseTo(
        (a.position[j]! - cam[j]!) * 1.5,
        6
      );
    }
  });

  it('recovers the size on the walks people make, with a realistic tracker jitter', () => {
    const walks: Omit<Walk, 'codeWorld'>[] = [
      { kind: 'sidestep', distanceM: 0.8, extent: 0.3, steps: 8 },
      { kind: 'sidestep', distanceM: 1.5, extent: 0.3, steps: 8 },
      { kind: 'sidestep', distanceM: 1.5, extent: 0.6, steps: 8 },
      { kind: 'arc', distanceM: 1.5, extent: 20, steps: 8 },
      { kind: 'arc', distanceM: 1.0, extent: 45, steps: 8 },
    ];
    for (const trueSize of [0.1, 0.16, 0.25]) {
      for (const walk of walks) {
        const errs: number[] = [];
        for (let seed = 1; seed <= 12; seed++) {
          const r = estimateQrSizeFromParallax(
            entries(walk, {
              sizeM: trueSize,
              noisePx: 1,
              jitterCm: 0.5,
              jitterDeg: 0.2,
              seed,
            })
          );
          expect(
            r,
            `${walk.kind} ${walk.extent} @${walk.distanceM} seed ${seed}`
          ).not.toBeNull();
          errs.push(relErr(r!.sizeM, trueSize));
        }
        errs.sort((a, b) => a - b);
        const label = `${trueSize} m, ${walk.kind} ${walk.extent} @ ${walk.distanceM} m`;
        expect(errs[6]!, `median ${label}`).toBeLessThan(0.02);
        expect(errs[11]!, `max ${label}`).toBeLessThan(0.06);
      }
    }
  });

  // Plan §4, §6 #3: these carry no scale; the answer must be "unknown".
  it('refuses a standing phone, a walk straight at the code, and a tiny step', () => {
    const cases: Omit<Walk, 'codeWorld'>[] = [
      { kind: 'still', distanceM: 1.5, extent: 0, steps: 8 },
      { kind: 'approach', distanceM: 1.0, extent: 1.0, steps: 8 },
      { kind: 'sidestep', distanceM: 1.5, extent: 0.03, steps: 8 },
    ];
    for (const walk of cases) {
      const r = estimateQrSizeFromParallax(
        entries(walk, { noisePx: 1, jitterCm: 0.5, jitterDeg: 0.2 })
      );
      expect(r, `${walk.kind} ${walk.extent}`).toBeNull();
    }
  });

  it('refuses a code too small on screen', () => {
    // 5 cm at 3 m: ~14 px edges, where corner noise biases the size (§6 #2).
    const r = estimateQrSizeFromParallax(
      entries(
        { kind: 'sidestep', distanceM: 3, extent: 0.6, steps: 8 },
        { sizeM: 0.05 }
      )
    );
    expect(r).toBeNull();
  });

  it('refuses fewer than the minimum of views', () => {
    const e = entries({
      kind: 'sidestep',
      distanceM: 1.5,
      extent: 0.6,
      steps: 8,
    });
    expect(estimateQrSizeFromParallax(e.slice(0, 4))).toBeNull();
    expect(estimateQrSizeFromParallax(e.slice(0, 5))).not.toBeNull();
  });

  // A tracking restart moves the frame: views across it are not comparable.
  it("uses only the newest entry's frame epoch", () => {
    const old = entries(
      { kind: 'sidestep', distanceM: 1.5, extent: 0.6, steps: 8 },
      { sizeM: 0.25 }
    );
    const now = entries(
      { kind: 'still', distanceM: 1.5, extent: 0, steps: 8 },
      { epoch: 1 }
    );
    expect(estimateQrSizeFromParallax([...old, ...now])).toBeNull();
    const back = entries(
      { kind: 'sidestep', distanceM: 1.5, extent: 0.6, steps: 8 },
      { epoch: 1 }
    );
    const r = estimateQrSizeFromParallax([...old, ...back]);
    expect(relErr(r!.sizeM, 0.16)).toBeLessThan(0.01);
  });

  // Plan §6 #8: an unusable view is skipped without shifting the others.
  it('skips an unusable view without misaligning the rest', () => {
    const e = entries({
      kind: 'sidestep',
      distanceM: 1.5,
      extent: 0.6,
      steps: 8,
    });
    const flat = {
      ...e[3]!,
      corners: e[3]!.corners.map(() => ({ x: 500, y: 400 })),
    };
    const r = estimateQrSizeFromParallax([
      ...e.slice(0, 3),
      flat,
      ...e.slice(4),
    ]);
    expect(r!.views).toBe(7);
    expect(relErr(r!.sizeM, 0.16)).toBeLessThan(0.005);
  });

  it('reports the lateral baseline and honours a stricter gate', () => {
    const e = entries({
      kind: 'sidestep',
      distanceM: 1.5,
      extent: 0.3,
      steps: 8,
    });
    const r = estimateQrSizeFromParallax(e)!;
    // An even 30 cm step: rms spread 0.3 * sqrt(9 / 84) ~ 0.098 m.
    expect(r.lateralBaselineM).toBeCloseTo(0.098, 2);
    expect(
      estimateQrSizeFromParallax(e, { minLateralBaselineM: 0.12 })
    ).toBeNull();
  });
});
