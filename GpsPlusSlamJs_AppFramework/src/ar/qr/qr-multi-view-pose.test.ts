/**
 * The production multi-view QR pose solve (QR near-frontal pose plan
 * 2026-09-23-2314, M3a; formulation `rotSharedFixedT`, chosen by M0 §8b/§10).
 *
 * Why these tests matter: one frame of a small, near-frontal code does not
 * contain its tilt, and its mirror flip fits it as well as the truth. Several
 * frames seen from different camera positions - whose poses SLAM knows - do
 * contain both. These tests pin that the solve recovers the truth from exact
 * views, never settles on a mirror flip, shrugs off one bad corner, reports how
 * well the tilt is determined, and refuses unusable input.
 */
import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics, Point2, Pose } from './qr-pose';
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
} from './qr-pose';
import {
  homographyFromCorrespondences,
  ippePoseCandidates,
  realIppeCandidates,
  type Mat3,
} from './planar-pnp';
import {
  solveQrPoseMultiView,
  type QrViewObservation,
} from './qr-multi-view-pose';
import {
  walkCameraPoses,
  type WalkKind,
} from '../../test-utils/synthetic-qr-walk';
import {
  realCandidateStarts,
  solveMultiView,
} from '../../test-utils/qr-multiview-prototype';
import { rotationAngleDeg } from '../../test-utils/qr-zxing-pipeline';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';

const SIZE_M = 0.16;
const INTRINSICS: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };

function tilted(deg: number, axis: 'x' | 'y' = 'x'): Pose {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return {
    position: [0, 1.5, 0],
    rotation: axis === 'x' ? [s, 0, 0, Math.cos(h)] : [0, s, 0, Math.cos(h)],
  };
}

/**
 * Exact corners of `code` seen from `camera` (optionally one corner moved),
 * projected in double precision: `codeInCamera` goes through the Float32
 * `composePose`, whose rounding alone would exceed these tests' bounds.
 */
function view(camera: Pose, code: Pose, corner0Offset = 0): QrViewObservation {
  const camInv: Pose['rotation'] = [
    -camera.rotation[0],
    -camera.rotation[1],
    -camera.rotation[2],
    camera.rotation[3],
  ];
  const corners = buildObjectPoints(SIZE_M).map((p, i) => {
    const w = rotateVectorByQuaternion(code.rotation, p);
    const inCam = rotateVectorByQuaternion(camInv, [
      w[0] + code.position[0] - camera.position[0],
      w[1] + code.position[1] - camera.position[1],
      w[2] + code.position[2] - camera.position[2],
    ]);
    const px = projectViewPoint(inCam, INTRINSICS)!;
    return i === 0 ? { x: px.x + corner0Offset, y: px.y } : px;
  });
  return { corners, cameraPose: camera, intrinsics: INTRINSICS };
}

/**
 * Exact views along a walk. The walks are laid out around the code's own
 * normal, so how obliquely they see it is set by `offsetDeg` and `extent`,
 * not by the code's rotation (which only turns the whole scene).
 */
function walkViews(
  code: Pose,
  kind: WalkKind,
  extent: number,
  steps: number,
  distanceM = 1.2,
  offsetDeg = 0
): QrViewObservation[] {
  return walkCameraPoses({
    kind,
    codeWorld: code,
    distanceM,
    extent,
    steps,
    offsetDeg,
  }).map((c) => view(c, code));
}

describe('realIppeCandidates', () => {
  /** A homography from a known OpenCV-frame pose (p_cam = R p_obj + t). */
  function homographyOf(R: Mat3, t: [number, number, number]) {
    const h = SIZE_M / 2;
    const obj: [number, number][] = [
      [-h, h],
      [h, h],
      [h, -h],
      [-h, -h],
    ];
    const img = obj.map(([x, y]) => {
      const X = R[0] * x + R[1] * y + t[0];
      const Y = R[3] * x + R[4] * y + t[1];
      const Z = R[6] * x + R[7] * y + t[2];
      return [X / Z, Y / Z] as [number, number];
    });
    return homographyFromCorrespondences(obj, img)!;
  }

  function rotX(deg: number): Mat3 {
    const a = (deg * Math.PI) / 180;
    return [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  }

  // Why this test matters (plan §6 finding 1): of the biquadratic's two roots
  // only tau = 1/sigma_max is a rotation; the other one is the invalid root
  // the single-frame solver can pick. The real pair must contain the truth.
  it('keeps exactly the smaller-depth root, which contains the true pose', () => {
    for (const deg of [5, 15, 30, 50]) {
      const R = rotX(deg);
      const all = ippePoseCandidates(homographyOf(R, [0.05, -0.03, 1.4]));
      const real = realIppeCandidates(homographyOf(R, [0.05, -0.03, 1.4]));
      const depth = (t: readonly number[]) => Math.hypot(t[0]!, t[1]!, t[2]!);
      const minDepth = Math.min(...all.map((c) => depth(c.t)));
      expect(real.length, `${deg}`).toBeGreaterThanOrEqual(1);
      expect(real.length, `${deg}`).toBeLessThanOrEqual(2);
      for (const c of real) expect(depth(c.t)).toBeCloseTo(minDepth, 9);
      const off = real.map((c) =>
        Math.max(...c.R.map((v, i) => Math.abs(v - R[i]!)))
      );
      expect(Math.min(...off), `${deg}`).toBeLessThan(1e-6);
    }
  });
});

describe('solveQrPoseMultiView', () => {
  it('recovers the exact rotation from exact views', () => {
    const code = tilted(4);
    const res = solveQrPoseMultiView(walkViews(code, 'arc', 30, 5), SIZE_M);
    expect(res).not.toBeNull();
    expect(rotationAngleDeg(res!.rotation, code.rotation)).toBeLessThan(1e-3);
    expect(res!.costPx).toBeLessThan(1e-3);
    expect(res!.views).toBe(5);
    // The mean of the views' own positions: exact views, exact position.
    res!.position.forEach((v, a) =>
      expect(Math.abs(v - code.position[a]!)).toBeLessThan(1e-6)
    );
  });

  // Why this test matters: the point of combining views - a mirror flip that
  // fits one view does not fit views from elsewhere, so the solve must land
  // on the truth although every view offers the flip as a start.
  it('never settles on a mirror flip when the views differ', () => {
    // [walk, extent, offset]: across the normal, and - the phone's usual
    // case - all on one side of it, near-frontal.
    for (const [kind, extent, offsetDeg] of [
      ['rise', 0.6, 0],
      ['arc', 30, 0],
      ['arc', 10, 5],
      ['sidestep', 0.3, 4],
      ['rise', 0.3, 6],
    ] as const) {
      const code = tilted(6, 'y');
      const res = solveQrPoseMultiView(
        walkViews(code, kind, extent, 6, 1.2, offsetDeg),
        SIZE_M
      );
      expect(
        rotationAngleDeg(res!.rotation, code.rotation),
        `${kind} ${extent} ${offsetDeg}`
      ).toBeLessThan(1e-3);
    }
  });

  // A single oblique view: its mirror flip is a real candidate too, but
  // fits the corners worse; the solve must return the one that fits.
  it('returns the fitting real candidate for a single view', () => {
    const code = tilted(25);
    const res = solveQrPoseMultiView(
      walkViews(code, 'still', 0, 1, 1.2, 25),
      SIZE_M
    );
    expect(rotationAngleDeg(res!.rotation, code.rotation)).toBeLessThan(1e-3);
  });

  // Why this test matters: a phone delivers the occasional bad corner. With
  // the robust loss its pull is capped - the same ~0.2 deg whether the
  // corner is 10, 25 or 50 px off - while plain least squares follows it
  // (0.8, 2.4, 5.3 deg here; the M0 prototype gives identical numbers).
  it('caps the pull of one bad corner, however bad', () => {
    const code = tilted(10);
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: code,
      distanceM: 1.2,
      extent: 40,
      steps: 6,
    });
    const errs = [10, 25, 50].map((offset) => {
      const views = cams.map((c, i) => view(c, code, i === 2 ? offset : 0));
      const robust = solveQrPoseMultiView(views, SIZE_M)!;
      const plain = solveQrPoseMultiView(views, SIZE_M, {
        robustScalePx: Infinity,
      })!;
      return {
        robust: rotationAngleDeg(robust.rotation, code.rotation),
        plain: rotationAngleDeg(plain.rotation, code.rotation),
      };
    });
    for (const e of errs) expect(e.robust).toBeLessThan(0.3);
    // Capped: the robust error does not grow with the offset ...
    expect(Math.abs(errs[2]!.robust - errs[0]!.robust)).toBeLessThan(0.05);
    // ... while the plain one does, and ends far above it.
    expect(errs[2]!.plain).toBeGreaterThan(3 * errs[0]!.plain);
    expect(errs[2]!.plain).toBeGreaterThan(10 * errs[2]!.robust);
  });

  // Why this test matters: the mounting prior (later) must act only where the
  // views do not determine the tilt; the solve has to say how well they do.
  // Only the ORDERING is pinned: the value under-reads the real error by
  // 1.3-4x (plan §13 #1) and is not calibrated yet.
  it('reports a tilt uncertainty that shrinks as the views get oblique', () => {
    const code = tilted(3);
    const still = solveQrPoseMultiView(walkViews(code, 'still', 0, 6), SIZE_M);
    const arc = solveQrPoseMultiView(walkViews(code, 'arc', 40, 6), SIZE_M);
    expect(still!.tiltSigmaDeg).toBeGreaterThan(arc!.tiltSigmaDeg);
    expect(Number.isFinite(arc!.tiltSigmaDeg)).toBe(true);
  });

  it('returns null for unusable input', () => {
    const code = tilted(4);
    const good = walkViews(code, 'arc', 20, 2);
    expect(solveQrPoseMultiView([], SIZE_M)).toBeNull();
    expect(solveQrPoseMultiView(good, 0)).toBeNull();
    expect(solveQrPoseMultiView(good, SIZE_M, { maxStarts: 0 })).toBeNull();
    expect(
      solveQrPoseMultiView(good, SIZE_M, { maxIterations: Number.NaN })
    ).toBeNull();
    expect(solveQrPoseMultiView(good, SIZE_M, { robustScalePx: 0 })).toBeNull();
    const badCamera = {
      ...good[0]!,
      cameraPose: {
        ...good[0]!.cameraPose,
        position: [Number.NaN, 0, 0] as [number, number, number],
      },
    };
    expect(solveQrPoseMultiView([badCamera], SIZE_M)).toBeNull();
    // A non-unit camera quaternion would silently skew the projection.
    const q = good[0]!.cameraPose.rotation;
    const scaled = {
      ...good[0]!,
      cameraPose: {
        ...good[0]!.cameraPose,
        rotation: [
          q[0] * 0.99,
          q[1] * 0.99,
          q[2] * 0.99,
          q[3] * 0.99,
        ] as Pose['rotation'],
      },
    };
    expect(solveQrPoseMultiView([scaled], SIZE_M)).toBeNull();
    const zeroFx = { ...good[0]!, intrinsics: { ...INTRINSICS, fx: 0 } };
    expect(solveQrPoseMultiView([zeroFx], SIZE_M)).toBeNull();
    expect(solveQrPoseMultiView(good, Number.NaN)).toBeNull();
    expect(solveQrPoseMultiView(good, Infinity)).toBeNull();
    const mirrored = { ...good[0]!, corners: [...good[0]!.corners].reverse() };
    expect(solveQrPoseMultiView([mirrored], SIZE_M)).toBeNull();
    expect(
      solveQrPoseMultiView(
        [{ ...good[0]!, corners: good[0]!.corners.slice(0, 3) }],
        SIZE_M
      )
    ).toBeNull();
    const nan: Point2[] = [
      { x: Number.NaN, y: 1 },
      ...good[0]!.corners.slice(1),
    ];
    expect(
      solveQrPoseMultiView([{ ...good[0]!, corners: nan }], SIZE_M)
    ).toBeNull();
  });

  // Why this test matters (M3b design review §16 #7): one unusable view in
  // a live window - a mirrored quad, a NaN corner, a bad camera pose - must
  // not throw the whole window away; it is dropped and counted, and the
  // rest still gives the exact rotation. Checked on mixed windows, since a
  // check that looked at only some views would pass every one-view case.
  it('drops an unusable view among good ones and solves the rest', () => {
    const code = tilted(4);
    const good = walkViews(code, 'arc', 20, 4);
    const mirrored = { ...good[1]!, corners: [...good[1]!.corners].reverse() };
    const nan: Point2[] = [
      { x: Number.NaN, y: 1 },
      ...good[3]!.corners.slice(1),
    ];
    const res = solveQrPoseMultiView(
      [good[0]!, mirrored, good[2]!, { ...good[3]!, corners: nan }],
      SIZE_M
    )!;
    expect(res.views).toBe(2);
    expect(res.droppedViews).toBe(2);
    expect(rotationAngleDeg(res.rotation, code.rotation)).toBeLessThan(1e-3);
    // Only when NO usable view is left is there no answer.
    expect(solveQrPoseMultiView([mirrored], SIZE_M)).toBeNull();
  });

  // Why this test matters (§16 #6): the fused window's gate judges the fit by
  // the MEDIAN of each view's own corner error, so one bad view cannot trip
  // it - which needs the per-view errors, in the order of the views used.
  it("reports each used view's own corner error", () => {
    const code = tilted(10);
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: code,
      distanceM: 1.2,
      extent: 40,
      steps: 6,
    });
    const exact = solveQrPoseMultiView(
      cams.map((c) => view(c, code)),
      SIZE_M
    )!;
    expect(exact.viewRmsPx).toHaveLength(6);
    for (const e of exact.viewRmsPx) expect(e).toBeLessThan(1e-3);
    const bad = solveQrPoseMultiView(
      cams.map((c, i) => view(c, code, i === 2 ? 25 : 0)),
      SIZE_M
    )!;
    const sorted = [...bad.viewRmsPx].sort((a, b) => a - b);
    expect(bad.viewRmsPx[2]!).toBeGreaterThan(5);
    expect(sorted[2]!).toBeLessThan(1);
  });

  // Why this test matters (plan §15, confirmed by the review's algebra): the
  // joint rotation does not depend on the printed size, so the fused pose
  // needs no size input - scaling the size scales every view's
  // camera-relative geometry uniformly.
  it('gives the same rotation whatever size it is told', () => {
    const rand = mulberry32(5);
    const code = tilted(8, 'y');
    const views = walkViews(code, 'arc', 20, 6, 1.2, 10).map((v) =>
      noisy(v, 0.5, rand)
    );
    const ref = solveQrPoseMultiView(views, SIZE_M)!;
    for (const sizeM of [0.05, 0.5, 1]) {
      const res = solveQrPoseMultiView(views, sizeM)!;
      // Component-wise: an acos-based angle cannot resolve below ~1.7e-6 deg.
      res.rotation.forEach((c, k) =>
        expect(Math.abs(c - ref.rotation[k]!), `${sizeM}`).toBeLessThan(1e-9)
      );
      expect(res.costPx).toBeCloseTo(ref.costPx, 9);
    }
  });

  // Why this test matters: the point of the module - under corner noise,
  // combining views must beat one frame, by a wide margin, on the same
  // corners. (Mutation-checked 2026-09-24: this does NOT catch a refinement
  // that returns its start - ranking alone already beats a typical frame.
  // The prototype-agreement and property tests below catch that one; review
  // §13 #3.)
  it('beats a single frame by a wide margin on noisy views', () => {
    const rand = mulberry32(21);
    const joint: number[] = [];
    const single: number[] = [];
    for (let s = 0; s < 16; s++) {
      const code = tilted(6, s % 2 === 0 ? 'x' : 'y');
      const kind = (['arc', 'rise'] as const)[s % 2]!;
      const views = walkViews(code, kind, kind === 'arc' ? 30 : 0.6, 8).map(
        (v) => noisy(v, 0.5, rand)
      );
      joint.push(
        rotationAngleDeg(
          solveQrPoseMultiView(views, SIZE_M)!.rotation,
          code.rotation
        )
      );
      single.push(
        ...views.map((v) =>
          rotationAngleDeg(
            solveQrPoseMultiView([v], SIZE_M)!.rotation,
            code.rotation
          )
        )
      );
    }
    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
    // Measured 2026-09-24: joint 0.90 deg vs a single frame 2.65 (medians).
    expect(median(joint)).toBeLessThan(0.6 * median(single));
  });

  // Why this test matters: with one start, ranking must hand the refinement
  // the CHEAPEST candidate. A one-sided oblique window keeps every view's
  // flip far from the truth, so a ranking that picked the dearest start
  // would settle on a flip.
  it('refines the cheapest start when only one is allowed', () => {
    const code = tilted(6, 'y');
    const views = walkViews(code, 'arc', 10, 6, 1.2, 20);
    const res = solveQrPoseMultiView(views, SIZE_M, { maxStarts: 1 })!;
    expect(res.starts).toBe(1);
    expect(rotationAngleDeg(res.rotation, code.rotation)).toBeLessThan(1e-3);
  });
});

/** Gaussian corner noise (Box-Muller on a seeded stream). */
function noisy(
  v: QrViewObservation,
  sigmaPx: number,
  rand: () => number
): QrViewObservation {
  const g = () =>
    Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return {
    ...v,
    corners: v.corners.map((c) => ({
      x: c.x + sigmaPx * g(),
      y: c.y + sigmaPx * g(),
    })),
  };
}

describe('solveQrPoseMultiView against the M0 prototype', () => {
  // Why this test matters: the prototype's numbers chose this formulation
  // (plan §10); production must not be worse than what was measured. The
  // differences - double precision throughout, and only the 3 cheapest
  // starts refined instead of all - must not cost accuracy.
  // Windows centred on the normal AND one-sided near-frontal ones (review
  // §13 #4: choosing the starts is only hard in the latter).
  it('is at least as accurate as the prototype on noisy near-frontal walks', () => {
    const rand = mulberry32(7);
    const worse: string[] = [];
    let n = 0;
    for (const offsetDeg of [0, 6, 12]) {
      for (const kind of ['arc', 'rise', 'sidestep'] as const) {
        for (let s = 0; s < 4; s++) {
          const code = tilted(6, s % 2 === 0 ? 'x' : 'y');
          const extent =
            kind === 'arc'
              ? offsetDeg === 0
                ? 30
                : 10
              : offsetDeg === 0
                ? 0.6
                : 0.3;
          const distanceM = s < 2 ? 1.2 : 2.5;
          const exact = walkViews(code, kind, extent, 8, distanceM, offsetDeg);
          const views = exact.map((v) => noisy(v, 0.5, rand));
          const mine = solveQrPoseMultiView(views, SIZE_M);
          const proto = solveMultiView(
            views.map((v) => ({
              corners: v.corners,
              cameraWorld: v.cameraPose,
              intrinsics: v.intrinsics,
            })),
            views.flatMap((v) =>
              realCandidateStarts(
                {
                  corners: v.corners,
                  cameraWorld: v.cameraPose,
                  intrinsics: v.intrinsics,
                },
                SIZE_M
              )
            ),
            { sizeM: SIZE_M, variant: 'rotSharedFixedT' }
          );
          const errMine = rotationAngleDeg(mine!.rotation, code.rotation);
          const errProto = rotationAngleDeg(
            proto!.rotationWorld,
            code.rotation
          );
          n++;
          if (errMine > errProto + 0.1)
            worse.push(
              `${offsetDeg} ${kind} ${s}: ${errMine.toFixed(2)} vs ${errProto.toFixed(2)}`
            );
        }
      }
    }
    expect(n).toBe(36);
    expect(worse).toEqual([]);
  });
});

describe('solveQrPoseMultiView cost', () => {
  // Why this test matters (plan §11): the solve runs per detection in M3b,
  // over a window of about 8 views. Each accepted iteration is 7 residual
  // passes over 8 x 4 corners; this pins the count on THESE seeds (0.5 px,
  // 1.2 m: 3 starts, 12-40 accepted iterations, the still window slowest),
  // deterministically, so a change that multiplies it is seen here and not
  // on a phone. Noisier or farther still windows reach the 30-per-start cap
  // (up to 90; plan §13 #2) - that is not a failure. Milliseconds are
  // measured in the sweep, not here.
  it('bounds starts and iterations on a noisy window of 8', () => {
    const rand = mulberry32(11);
    for (const kind of ['still', 'arc', 'rise'] as const) {
      const views = walkViews(
        tilted(5),
        kind,
        kind === 'arc' ? 30 : 0.6,
        8
      ).map((v) => noisy(v, 0.5, rand));
      const res = solveQrPoseMultiView(views, SIZE_M)!;
      expect(res.starts, kind).toBeLessThanOrEqual(3);
      expect(res.iterations, kind).toBeLessThanOrEqual(60);
    }
  });
});

describe('solveQrPoseMultiView invariants (seeded)', () => {
  // Why this test matters: whatever the code's orientation, the walk and how
  // obliquely it sees the code, exact views must give back the exact
  // rotation - no pose where the solve settles elsewhere.
  it('recovers the truth over random codes, walks and obliqueness', () => {
    const rand = mulberry32(2026);
    const failures: string[] = [];
    for (let k = 0; k < 40; k++) {
      const yaw = (rand() - 0.5) * 60;
      const tilt = (rand() - 0.5) * 50;
      const hy = (yaw * Math.PI) / 360;
      const hx = (tilt * Math.PI) / 360;
      // yaw about y, then tilt about x
      const code: Pose = {
        position: [0, 1.5, 0],
        rotation: [
          Math.cos(hy) * Math.sin(hx),
          Math.sin(hy) * Math.cos(hx),
          -Math.sin(hy) * Math.sin(hx),
          Math.cos(hy) * Math.cos(hx),
        ],
      };
      const kind = (['arc', 'rise', 'sidestep', 'still'] as const)[k % 4]!;
      const offsetDeg = (rand() - 0.5) * 80;
      const views = walkViews(
        code,
        kind,
        kind === 'arc' ? 25 : 0.5,
        5,
        0.8 + rand(),
        offsetDeg
      );
      const res = solveQrPoseMultiView(views, SIZE_M);
      const err = res
        ? rotationAngleDeg(res.rotation, code.rotation)
        : Infinity;
      if (!(err < 1e-2))
        failures.push(
          `${k} ${kind} off ${offsetDeg.toFixed(1)} yaw ${yaw.toFixed(1)} tilt ${tilt.toFixed(1)}: ${err}`
        );
    }
    expect(failures).toEqual([]);
  });
});
