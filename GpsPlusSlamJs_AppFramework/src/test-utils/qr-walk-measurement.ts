/**
 * One synthetic walk, measured (QR near-frontal pose plan 2026-09-23-2314,
 * M0): render each step, decode it with zxing, and score today's raw and
 * stable poses and the multi-view prototype's variants against the truth.
 * Test-only. See qr-walk-measurement.ts.md.
 */

import type { Pose } from '../ar/qr/qr-pose';
import {
  buildObjectPoints,
  intrinsicsFromProjection,
  rotateVectorByQuaternion,
  solveQrPose,
} from '../ar/qr/qr-pose';
import { PlanarPnpSquare, solveLinear } from '../ar/qr/planar-pnp';
import { evaluateQrPoseStability } from '../ar/qr/qr-pose-aggregation';
import { perspectiveProjection, renderQrFrame } from './synthetic-qr-frame';
import { mulberry32 } from './elevation-offset-scenarios';
import { rotationAngleDeg, zxingDetect } from './qr-zxing-pipeline';
import {
  codeInCamera,
  rayAngleDeg,
  walkCameraPoses,
  type WalkOptions,
} from './synthetic-qr-walk';
import {
  realCandidateStarts,
  solveMultiView,
  type MultiViewVariant,
  type ViewObservation,
} from './qr-multiview-prototype';
import { solveQrPoseMultiView } from '../ar/qr/qr-multi-view-pose';

/** A launch URL of realistic length (QR version 5-8 at level Q). */
const PAYLOAD =
  'https://gps-plus-slam.csutil.workers.dev/tour/?t=S/k7Qm2xPz9LbV4nRw8TcY3hFd6JsA1eGu5oKi0MNq';
const SIZE_M = 0.16;
/** The owner's phone, folded (QR summary §4a); fovY is an assumption. */
const PHONE = { width: 439, height: 1024, fovYDeg: 64 };
const ALL_VARIANTS: MultiViewVariant[] = [
  'rotSharedFixedT',
  'rotSharedFreeT',
  'shared6',
];

export interface WalkMeasurementOptions extends WalkOptions {
  noiseSigma: number;
  seed: number;
  blurRadiusPx?: number;
  capture?: { width: number; height: number; fovYDeg: number };
  /** Observations per window (the stable pose's default is 8). */
  window?: number;
  robustScalePx?: number;
  variants?: MultiViewVariant[];
  /**
   * Per-frame SLAM error on the camera poses the SOLVERS are given (the image
   * is always rendered from the true pose): Gaussian position noise per axis
   * (m) and a rotation about a random axis with a Gaussian angle (deg).
   */
  slamNoise?: {
    rotationDeg: number;
    translationM: number;
    /** A drift: per step, a random rotation of this sigma accumulates. */
    driftRotationDegPerStep?: number;
    /** A drift: per step, Gaussian position noise of this sigma accumulates. */
    driftTranslationMPerStep?: number;
  };
}

/** One decoded step, scored. Errors are absolute rotation errors, degrees. */
export interface WalkRow {
  step: number;
  /** Observations in the window this row was scored on. */
  window: number;
  /** This view's angle between the code normal and its ray. */
  rayDeg: number;
  /** The largest `rayDeg` in the window: how oblique the window got. */
  reachedDeg: number;
  /** Today's per-frame pose; NaN when the solve was rejected. */
  errRawDeg: number;
  /** Today's windowed stable pose over the raw poses; NaN before one exists. */
  errStableDeg: number;
  /**
   * Whether today's stability gate lets this window through
   * (`status === 'stable'`): consumers only ever see gated poses.
   */
  stableGated: boolean;
  /** The gate's two measures on this window (it opens at <= 3 cm and <= 5 deg). */
  stableSpread: { translationM: number; rotationDeg: number };
  errFusedDeg: Partial<Record<MultiViewVariant, number>>;
  /** The production multi-view solve (M3a) on the same window; NaN when null. */
  errProductionDeg: number;
  /** Its wall-clock time on this machine, ms (reported, never asserted). */
  productionMs: number;
  /**
   * The position re-fit spike: the prototype's fixedT solve with each view's
   * position re-fitted to the production rotation (one pass); NaN when absent.
   */
  errRefitDeg: number;
  /**
   * The code normal's error split into PITCH (elevation, the axis the
   * phone's wall check measures) and YAW (azimuth), deg; NaN when missing.
   */
  axisErrDeg: {
    raw: AxisErr;
    stable: AxisErr;
    fused: Partial<Record<MultiViewVariant, AxisErr>>;
    production: AxisErr;
  };
}

/** Standard normal sample from a uniform generator (Box-Muller). */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** `camera` with SLAM-like noise, or `camera` itself without any. */
function perturbed(
  camera: Pose,
  noise: WalkMeasurementOptions['slamNoise'],
  rand: () => number,
  drift: Drift
): Pose {
  if (!noise) return camera;
  const t = noise.translationM;
  const white = randomRotation(rand, noise.rotationDeg);
  return {
    position: [
      camera.position[0] + drift.t[0] + gaussian(rand) * t,
      camera.position[1] + drift.t[1] + gaussian(rand) * t,
      camera.position[2] + drift.t[2] + gaussian(rand) * t,
    ],
    rotation: qmul(qmul(camera.rotation, drift.q), white),
  };
}

export interface AxisErr {
  pitch: number;
  yaw: number;
}

const DEG = 180 / Math.PI;

/** Elevation and azimuth of a rotation's +z axis (the code normal), deg. */
function normalAngles(q: readonly number[]): { elev: number; azim: number } {
  const [x, y, z, w] = q as [number, number, number, number];
  const nx = 2 * (x * z + w * y);
  const ny = 2 * (y * z - w * x);
  const nz = 1 - 2 * (x * x + y * y);
  return {
    elev: Math.asin(Math.max(-1, Math.min(1, ny))) * DEG,
    azim: Math.atan2(nx, nz) * DEG,
  };
}

function axisErr(
  est: Pose | null | undefined,
  truth: readonly number[]
): AxisErr {
  if (!est) return { pitch: Number.NaN, yaw: Number.NaN };
  const a = normalAngles(est.rotation);
  const b = normalAngles(truth);
  const dAz = Math.abs(a.azim - b.azim) % 360;
  return { pitch: Math.abs(a.elev - b.elev), yaw: Math.min(dAz, 360 - dAz) };
}

function qmul(a: readonly number[], b: readonly number[]): Quat4 {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}

type Quat4 = [number, number, number, number];
type Vec3 = [number, number, number];

/** A rotation about a random axis with a Gaussian angle of `sigmaDeg`. */
function randomRotation(rand: () => number, sigmaDeg: number): Quat4 {
  const axis = [gaussian(rand), gaussian(rand), gaussian(rand)];
  const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
  const half = (gaussian(rand) * sigmaDeg * Math.PI) / 360;
  const s = Math.sin(half) / len;
  return [axis[0]! * s, axis[1]! * s, axis[2]! * s, Math.cos(half)];
}

/** The accumulated SLAM drift, advanced one step per frame. */
interface Drift {
  q: Quat4;
  t: Vec3;
}

function advanceDrift(
  drift: Drift,
  noise: WalkMeasurementOptions['slamNoise'],
  rand: () => number
): void {
  if (!noise?.driftRotationDegPerStep && !noise?.driftTranslationMPerStep)
    return;
  drift.q = qmul(
    drift.q,
    randomRotation(rand, noise.driftRotationDegPerStep ?? 0)
  );
  const st = noise.driftTranslationMPerStep ?? 0;
  drift.t = [
    drift.t[0] + gaussian(rand) * st,
    drift.t[1] + gaussian(rand) * st,
    drift.t[2] + gaussian(rand) * st,
  ];
}

/** Keep one start per orientation (within 2 deg): the solve is per start. */
function distinctStarts(starts: readonly Pose[]): Pose[] {
  const out: Pose[] = [];
  for (const s of starts) {
    if (!out.some((o) => rotationAngleDeg(o.rotation, s.rotation) < 2)) {
      out.push(s);
    }
  }
  return out;
}

/**
 * The code's world position that best fits `view`'s corners for a GIVEN code
 * rotation: least squares on the corners' viewing rays (each ray's
 * perpendicular residual is linear in the position). The position re-fit
 * spike (plan §12, §14): one pass of re-fitting the positions to the joint
 * rotation before solving again.
 */
function refitPosition(
  view: ViewObservation,
  rotation: Pose['rotation']
): Vec3 | null {
  const { fx, fy, cx, cy } = view.intrinsics;
  const cam = view.cameraWorld;
  const camInv: Pose['rotation'] = [
    -cam.rotation[0],
    -cam.rotation[1],
    -cam.rotation[2],
    cam.rotation[3],
  ];
  const A = new Array<number>(9).fill(0);
  const b = [0, 0, 0];
  // Columns of the world->camera rotation, i.e. Rc^T applied to the axes.
  const axes = (
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Vec3[]
  ).map((e) => rotateVectorByQuaternion(camInv, e));
  buildObjectPoints(SIZE_M).forEach((o, k) => {
    const c = view.corners[k]!;
    const d: Vec3 = [(c.x - cx) / fx, -(c.y - cy) / fy, -1];
    const n = Math.hypot(d[0], d[1], d[2]);
    const u = d.map((x) => x / n);
    const perp = (x: readonly number[]) => {
      const dot = x[0]! * u[0]! + x[1]! * u[1]! + x[2]! * u[2]!;
      return x.map((xi, i) => xi - dot * u[i]!);
    };
    const M = axes.map(perp); // column j = (I - u u^T) Rc^T e_j
    const w = rotateVectorByQuaternion(rotation, o);
    const rhs = perp(
      rotateVectorByQuaternion(camInv, [
        w[0] - cam.position[0],
        w[1] - cam.position[1],
        w[2] - cam.position[2],
      ])
    ).map((x) => -x);
    for (let a = 0; a < 3; a++) {
      for (let r = 0; r < 3; r++) {
        b[a]! += M[a]![r]! * rhs[r]!;
        for (let col = 0; col < 3; col++)
          A[a * 3 + col]! += M[a]![r]! * M[col]![r]!;
      }
    }
  });
  const p = solveLinear(A, b);
  return p ? [p[0]!, p[1]!, p[2]!] : null;
}

/** Render, decode and solve one step; null when zxing does not decode it. */
async function observe(
  camera: Pose,
  seenFrom: Pose,
  o: WalkMeasurementOptions,
  step: number
): Promise<{ view: ViewObservation; raw: Pose | null } | null> {
  const cap = o.capture ?? PHONE;
  const projection = perspectiveProjection({
    fovYDeg: cap.fovYDeg,
    aspect: cap.width / cap.height,
  });
  const frame = renderQrFrame({
    text: PAYLOAD,
    sizeM: SIZE_M,
    qrPoseInCamera: codeInCamera(camera, o.codeWorld),
    projection,
    width: cap.width,
    height: cap.height,
    supersample: 2,
    blurRadiusPx: o.blurRadiusPx ?? 0,
    noiseSigma: o.noiseSigma,
    seed: o.seed * 1000 + step,
  });
  const det = await zxingDetect(frame.image);
  if (!det || det.text !== PAYLOAD) return null;
  const intrinsics = intrinsicsFromProjection(
    projection,
    cap.width,
    cap.height
  );
  // The solvers see the camera pose SLAM would report (`seenFrom`).
  const view: ViewObservation = {
    corners: det.corners,
    cameraWorld: seenFrom,
    intrinsics,
  };
  const raw = solveQrPose({
    imagePoints: det.corners,
    sizeM: SIZE_M,
    intrinsics,
    cameraPose: seenFrom,
    solver: new PlanarPnpSquare(),
  });
  return { view, raw: raw ? raw.qrPoseWorld : null };
}

/** The robust-loss option, when the walk sets one. */
function robustOption(o: WalkMeasurementOptions): { robustScalePx?: number } {
  return o.robustScalePx === undefined
    ? {}
    : { robustScalePx: o.robustScalePx };
}

/** Rotation error against `truth`, deg; NaN when there is no pose. */
function errDeg(p: Pose | null | undefined, truth: Pose['rotation']): number {
  return p ? rotationAngleDeg(p.rotation, truth) : Number.NaN;
}

/**
 * Today's stable pose over the raw poses of the SAME window of views (a
 * rejected solve is simply absent), so every method sees the same frames;
 * with the gate's verdict and the two spreads it judges.
 */
function stabilityOf(raws: readonly (Pose | null)[]): {
  stable: Pose | null;
  stableGated: boolean;
  stableSpread: WalkRow['stableSpread'];
} {
  const accepted = raws.filter((r): r is Pose => r !== null);
  if (accepted.length === 0) {
    return {
      stable: null,
      stableGated: false,
      stableSpread: { translationM: Number.NaN, rotationDeg: Number.NaN },
    };
  }
  const s = evaluateQrPoseStability(accepted);
  return {
    stable: s.pose,
    stableGated: s.status === 'stable',
    stableSpread: {
      translationM: s.translationSpreadM,
      rotationDeg: s.rotationSpreadDeg,
    },
  };
}

/** Every prototype variant on the window: rotation and axis errors. */
function prototypeColumns(
  views: readonly ViewObservation[],
  starts: readonly Pose[],
  o: WalkMeasurementOptions
): Pick<WalkRow, 'errFusedDeg'> & {
  fusedAxis: WalkRow['axisErrDeg']['fused'];
} {
  const truth = o.codeWorld.rotation;
  const errFusedDeg: WalkRow['errFusedDeg'] = {};
  const fusedAxis: WalkRow['axisErrDeg']['fused'] = {};
  for (const variant of o.variants ?? ALL_VARIANTS) {
    const fused = solveMultiView(views, starts, {
      sizeM: SIZE_M,
      variant,
      ...robustOption(o),
    });
    const pose = fused
      ? { position: fused.positionWorld, rotation: fused.rotationWorld }
      : null;
    errFusedDeg[variant] = errDeg(pose, truth);
    fusedAxis[variant] = axisErr(pose, truth);
  }
  return { errFusedDeg, fusedAxis };
}

/**
 * The production solve on the window (timed), and the position re-fit
 * spike: the prototype's fixedT solve with each view's position re-fitted to
 * the production rotation.
 */
function productionColumns(
  views: readonly ViewObservation[],
  starts: readonly Pose[],
  o: WalkMeasurementOptions
): {
  production: Pose | null;
  productionMs: number;
  errRefitDeg: number;
} {
  const t0 = performance.now();
  const solved = solveQrPoseMultiView(
    views.map((v) => ({
      corners: v.corners,
      cameraPose: v.cameraWorld,
      intrinsics: v.intrinsics,
    })),
    SIZE_M,
    robustOption(o)
  );
  const productionMs = performance.now() - t0;
  if (!solved) {
    return { production: null, productionMs, errRefitDeg: Number.NaN };
  }
  const refitted = views.map((v) => refitPosition(v, solved.rotation));
  const refit = refitted.every((p) => p !== null)
    ? solveMultiView(views, starts, {
        sizeM: SIZE_M,
        variant: 'rotSharedFixedT',
        fixedPositions: refitted,
        ...robustOption(o),
      })
    : null;
  return {
    production: { position: solved.position, rotation: solved.rotation },
    productionMs,
    errRefitDeg: refit
      ? rotationAngleDeg(refit.rotationWorld, o.codeWorld.rotation)
      : Number.NaN,
  };
}

/** Score the window ending at the latest view. */
function scoreWindow(
  views: readonly ViewObservation[],
  trueCameras: readonly Pose[],
  raws: readonly (Pose | null)[],
  latestRaw: Pose | null,
  o: WalkMeasurementOptions
): Omit<WalkRow, 'step'> {
  const truth = o.codeWorld.rotation;
  const { stable, stableGated, stableSpread } = stabilityOf(raws);
  const starts = distinctStarts(
    views.flatMap((v) => realCandidateStarts(v, SIZE_M))
  );
  const { errFusedDeg, fusedAxis } = prototypeColumns(views, starts, o);
  const { production, productionMs, errRefitDeg } = productionColumns(
    views,
    starts,
    o
  );
  // Binned by the TRUE geometry, whatever pose the solvers were handed.
  const rays = trueCameras.map((c) => rayAngleDeg(c, o.codeWorld));
  return {
    window: views.length,
    rayDeg: rays[rays.length - 1]!,
    reachedDeg: Math.max(...rays),
    errRawDeg: errDeg(latestRaw, truth),
    errStableDeg: errDeg(stable, truth),
    stableGated,
    stableSpread,
    errFusedDeg,
    errProductionDeg: errDeg(production, truth),
    productionMs,
    errRefitDeg,
    axisErrDeg: {
      raw: axisErr(latestRaw, truth),
      stable: axisErr(stable, truth),
      fused: fusedAxis,
      production: axisErr(production, truth),
    },
  };
}

/** Walk, decode every step, and score every method on a sliding window. */
export async function measureWalk(
  o: WalkMeasurementOptions
): Promise<WalkRow[]> {
  const size = o.window ?? 8;
  const views: ViewObservation[] = [];
  const trueCameras: Pose[] = [];
  const raws: (Pose | null)[] = [];
  const rows: WalkRow[] = [];
  const cameras = walkCameraPoses(o);
  const rand = mulberry32(o.seed * 7919 + 17);
  const drift: Drift = { q: [0, 0, 0, 1], t: [0, 0, 0] };
  for (let step = 0; step < cameras.length; step++) {
    const camera = cameras[step]!;
    advanceDrift(drift, o.slamNoise, rand);
    const seenFrom = perturbed(camera, o.slamNoise, rand, drift);
    const seen = await observe(camera, seenFrom, o, step);
    if (!seen) continue;
    views.push(seen.view);
    trueCameras.push(camera);
    raws.push(seen.raw);
    rows.push({
      step,
      ...scoreWindow(
        views.slice(-size),
        trueCameras.slice(-size),
        raws.slice(-size),
        seen.raw,
        o
      ),
    });
  }
  return rows;
}
