/**
 * One synthetic walk, measured (QR near-frontal pose plan 2026-09-23-2314,
 * M0): render each step, decode it with zxing, and score today's raw and
 * stable poses and the multi-view prototype's variants against the truth.
 * Test-only. See qr-walk-measurement.ts.md.
 */

import type { Pose } from '../ar/qr/qr-pose';
import { intrinsicsFromProjection, solveQrPose } from '../ar/qr/qr-pose';
import { PlanarPnpSquare } from '../ar/qr/planar-pnp';
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
  errFusedDeg: Partial<Record<MultiViewVariant, number>>;
  /**
   * The code normal's error split into PITCH (elevation, the axis the
   * phone's wall check measures) and YAW (azimuth), deg; NaN when missing.
   */
  axisErrDeg: {
    raw: AxisErr;
    stable: AxisErr;
    fused: Partial<Record<MultiViewVariant, AxisErr>>;
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

/** Score the window ending at the latest view. */
function scoreWindow(
  views: readonly ViewObservation[],
  trueCameras: readonly Pose[],
  raws: readonly (Pose | null)[],
  latestRaw: Pose | null,
  o: WalkMeasurementOptions
): Omit<WalkRow, 'step'> {
  const truth = o.codeWorld.rotation;
  const err = (p: Pose | null | undefined): number =>
    p ? rotationAngleDeg(p.rotation, truth) : Number.NaN;
  // The stable pose averages the raw poses of the SAME window of views
  // (a rejected solve is simply absent), so every method sees the same frames.
  const accepted = raws.filter((r): r is Pose => r !== null);
  const stable =
    accepted.length > 0 ? evaluateQrPoseStability(accepted).pose : null;
  const starts = distinctStarts(
    views.flatMap((v) => realCandidateStarts(v, SIZE_M))
  );
  const errFusedDeg: WalkRow['errFusedDeg'] = {};
  const fusedAxis: WalkRow['axisErrDeg']['fused'] = {};
  for (const variant of o.variants ?? ALL_VARIANTS) {
    const fused = solveMultiView(views, starts, {
      sizeM: SIZE_M,
      variant,
      ...(o.robustScalePx === undefined
        ? {}
        : { robustScalePx: o.robustScalePx }),
    });
    errFusedDeg[variant] = fused
      ? rotationAngleDeg(fused.rotationWorld, truth)
      : Number.NaN;
    fusedAxis[variant] = axisErr(
      fused
        ? { position: fused.positionWorld, rotation: fused.rotationWorld }
        : null,
      truth
    );
  }
  // Binned by the TRUE geometry, whatever pose the solvers were handed.
  const rays = trueCameras.map((c) => rayAngleDeg(c, o.codeWorld));
  return {
    window: views.length,
    rayDeg: rays[rays.length - 1]!,
    reachedDeg: Math.max(...rays),
    errRawDeg: err(latestRaw),
    errStableDeg: err(stable),
    errFusedDeg,
    axisErrDeg: {
      raw: axisErr(latestRaw, truth),
      stable: axisErr(stable, truth),
      fused: fusedAxis,
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
