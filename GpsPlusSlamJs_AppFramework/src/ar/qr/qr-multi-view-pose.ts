/**
 * Multi-view QR pose: one world ROTATION for a static code, solved jointly
 * over several detections of it from different camera poses (QR near-frontal
 * pose plan 2026-09-23-2314, M3a).
 *
 * One frame of a small, near-frontal code barely constrains its tilt, and its
 * mirror flip fits that frame almost as well as the truth. Views from
 * different places, whose camera poses SLAM supplies, constrain both. The
 * formulation is the one the M0 sweeps chose (`rotSharedFixedT`): the
 * rotation is shared by every view, and each view's code position stays fixed
 * at its own single-view solve, because positions are already well determined
 * and freeing them bought nothing under SLAM noise.
 *
 * Damped Gauss-Newton on the corners' pixel error with a robust loss (so one
 * bad corner cannot drag the window), numeric Jacobian, 3 unknowns, all in
 * double precision (`composePose` is Float32). Several starts: every view's
 * real IPPE candidates; the lowest robust cost wins. See
 * qr-multi-view-pose.ts.md.
 */

import type { Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { CameraIntrinsics, Point2, Pose } from './qr-pose.js';
import {
  buildObjectPoints,
  rotateVectorByQuaternion,
  validateQuad,
} from './qr-pose.js';
import {
  PlanarPnpSquare,
  homographyFromCorrespondences,
  realIppeCandidates,
  solveLinear,
  type Mat3,
} from './planar-pnp.js';

/** One detection of the code. */
export interface QrViewObservation {
  /** The 4 corners in symbol reading order (TL, TR, BR, BL), pixels. */
  corners: readonly Point2[];
  /** The capturing camera's pose in the world (raw-WebXR/odom space). */
  cameraPose: Pose;
  /** Intrinsics for the exact pixel buffer the corners came from. */
  intrinsics: CameraIntrinsics;
}

export interface QrMultiViewPoseOptions {
  /**
   * Robust-loss scale on one corner's pixel error: errors beyond it count
   * linearly, not squared. `Infinity` = plain least squares. Default 1 px.
   */
  robustScalePx?: number;
  /** Iteration cap per start. Default 30. */
  maxIterations?: number;
  /**
   * How many starts are refined: the distinct candidate rotations with the
   * lowest robust cost over all views. Default 3.
   */
  maxStarts?: number;
}

export interface QrMultiViewPoseResult {
  /** The code's world rotation, unit quaternion [x, y, z, w]. */
  rotation: Quaternion;
  /** Mean of the views' own code positions, world metres. */
  position: Vector3;
  /** RMS corner error over all views at `rotation`, px. */
  costPx: number;
  /** The number of views the solve used. */
  views: number;
  /**
   * 1-sigma uncertainty of the code's TILT (the direction of its normal) for
   * 1 px of corner noise, degrees, along its worst direction. Large when the
   * views do not determine the tilt (one near-frontal view, or many from one
   * spot); `Infinity` when it is not determined at all.
   */
  tiltSigmaDeg: number;
  /** Distinct starts refined (the solve's work is starts x iterations). */
  starts: number;
  /** Gauss-Newton iterations over all starts. */
  iterations: number;
}

type Quat = [number, number, number, number];

const DEFAULT_ROBUST_SCALE_PX = 1;
const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_MAX_STARTS = 3;
/** Starts closer than this to an earlier one are dropped. */
const DUPLICATE_START_DEG = 2;
const JACOBIAN_STEP_RAD = 1e-6;
/** Converged when the step is below this (6e-7 deg) ... */
const STEP_DONE_RAD = 1e-8;
/** ... or the robust cost fell by less than this fraction. */
const COST_DONE_RELATIVE = 1e-9;
const RAD_TO_DEG = 180 / Math.PI;

// --- double-precision quaternions [x, y, z, w] ---

function qmul(a: readonly number[], b: readonly number[]): Quat {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}

function qconj(q: readonly number[]): Quat {
  return [-q[0]!, -q[1]!, -q[2]!, q[3]!];
}

function qnormalize(q: readonly number[]): Quat {
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  return [q[0]! / n, q[1]! / n, q[2]! / n, q[3]! / n];
}

/** A rotation vector (axis * angle, rad) as a unit quaternion. */
function qexp(v: readonly number[]): Quat {
  const angle = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (angle < 1e-12) return qnormalize([v[0]! / 2, v[1]! / 2, v[2]! / 2, 1]);
  const s = Math.sin(angle / 2) / angle;
  return [v[0]! * s, v[1]! * s, v[2]! * s, Math.cos(angle / 2)];
}

function angleBetweenDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  );
  return 2 * Math.acos(Math.min(1, dot)) * RAD_TO_DEG;
}

/** A row-major rotation matrix as a unit quaternion (Shepperd's method). */
function quatFromMatrix(m: Mat3): Quat {
  const trace = m[0] + m[4] + m[8];
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    return qnormalize([
      (m[7] - m[5]) / s,
      (m[2] - m[6]) / s,
      (m[3] - m[1]) / s,
      s / 4,
    ]);
  }
  if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    return qnormalize([
      s / 4,
      (m[1] + m[3]) / s,
      (m[2] + m[6]) / s,
      (m[7] - m[5]) / s,
    ]);
  }
  if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    return qnormalize([
      (m[1] + m[3]) / s,
      s / 4,
      (m[5] + m[7]) / s,
      (m[2] - m[6]) / s,
    ]);
  }
  const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
  return qnormalize([
    (m[2] + m[6]) / s,
    (m[5] + m[7]) / s,
    s / 4,
    (m[3] - m[1]) / s,
  ]);
}

// --- validation ---

function isFinitePose(pose: Pose): boolean {
  return (
    pose.position.length === 3 &&
    pose.rotation.length === 4 &&
    [...pose.position, ...pose.rotation].every(Number.isFinite) &&
    Math.hypot(...pose.rotation) > 0.5
  );
}

function isUsableView(view: QrViewObservation): boolean {
  const { fx, fy, cx, cy } = view.intrinsics;
  return (
    fx > 0 &&
    fy > 0 &&
    Number.isFinite(fx) &&
    Number.isFinite(fy) &&
    Number.isFinite(cx) &&
    Number.isFinite(cy) &&
    isFinitePose(view.cameraPose) &&
    validateQuad(view.corners).ok
  );
}

// --- per-view candidates ---

/** One view's own code position and the world rotations it offers as starts. */
interface ViewSeed {
  position: Vector3;
  rotations: Quat[];
}

/**
 * `view`'s own code position and its REAL IPPE candidates' world rotations.
 *
 * The position is the single-frame solve's (lowest reprojection error over
 * ALL candidates), not the real root's: measured over noise, distance and
 * SLAM error, the real root's position was never better and at close range
 * worse (p95 1.55 vs 1.26 deg at 0.8 m, 0.5 px; plan §12).
 */
function seedOf(view: QrViewObservation, sizeM: number): ViewSeed | null {
  const { fx, fy, cx, cy } = view.intrinsics;
  const object = buildObjectPoints(sizeM);
  const H = homographyFromCorrespondences(
    object.map((o) => [o[0], o[1]] as const),
    view.corners.map((c) => [(c.x - cx) / fx, (c.y - cy) / fy] as const)
  );
  const own = new PlanarPnpSquare().solve(
    object,
    view.corners,
    view.intrinsics
  );
  if (!H || !own) return null;
  const candidates = realIppeCandidates(H).filter((c) => c.t[2] > 0);
  if (candidates.length === 0) return null;
  const cam = view.cameraPose;
  // OpenCV camera (+y down, +z forward) -> WebXR camera: left-multiply by
  // Rx(pi) = diag(1, -1, -1); then lift into the world by the camera pose.
  const inCamera: Vector3 = [own.tvec[0], -own.tvec[1], -own.tvec[2]];
  const offset = rotateVectorByQuaternion(cam.rotation, inCamera);
  const position: Vector3 = [
    cam.position[0] + offset[0],
    cam.position[1] + offset[1],
    cam.position[2] + offset[2],
  ];
  const rotations = candidates.map(({ R }) =>
    qnormalize(
      qmul(
        cam.rotation,
        quatFromMatrix([
          R[0],
          R[1],
          R[2],
          -R[3],
          -R[4],
          -R[5],
          -R[6],
          -R[7],
          -R[8],
        ])
      )
    )
  );
  return { position, rotations };
}

// --- the model ---

interface Problem {
  views: readonly QrViewObservation[];
  object: readonly Vector3[];
  positions: readonly Vector3[];
  robustScalePx: number;
}

/** Corner residuals (x, y per corner, all views) for rotation `q`; null if a corner falls behind a camera. */
function residuals(pr: Problem, q: readonly number[]): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < pr.views.length; i++) {
    const { cameraPose: cam, intrinsics, corners } = pr.views[i]!;
    const p = pr.positions[i]!;
    const camInv = qconj(cam.rotation);
    for (let k = 0; k < 4; k++) {
      const w = rotateVectorByQuaternion(q as Quat, pr.object[k]!);
      const [x, y, z] = rotateVectorByQuaternion(camInv, [
        w[0] + p[0] - cam.position[0],
        w[1] + p[1] - cam.position[1],
        w[2] + p[2] - cam.position[2],
      ]);
      const depth = -z;
      if (!(depth > 1e-6)) return null;
      out.push(
        intrinsics.cx + (intrinsics.fx * x) / depth - corners[k]!.x,
        intrinsics.cy - (intrinsics.fy * y) / depth - corners[k]!.y
      );
    }
  }
  return out;
}

/** Per-corner robust weights (repeated for x and y) and the robust cost. */
function robustWeights(
  r: readonly number[],
  scale: number
): { w: number[]; cost: number } {
  const w: number[] = [];
  let cost = 0;
  for (let j = 0; j < r.length; j += 2) {
    const e = Math.hypot(r[j]!, r[j + 1]!);
    const inlier = e <= scale;
    const wj = inlier ? 1 : scale / e;
    cost += inlier ? e * e : 2 * scale * e - scale * scale;
    w.push(wj, wj);
  }
  return { w, cost };
}

function rmsPx(r: readonly number[]): number {
  let s = 0;
  for (const v of r) s += v * v;
  return Math.sqrt(s / (r.length / 2));
}

/** Weighted normal equations J^T W J (row-major 3x3) and -J^T W r at `q`. */
function normalEquations(
  pr: Problem,
  q: Quat,
  r: readonly number[],
  w: readonly number[]
): { A: number[]; b: number[] } | null {
  const J: number[][] = [];
  for (let c = 0; c < 3; c++) {
    const d = [0, 0, 0];
    d[c] = JACOBIAN_STEP_RAD;
    const rp = residuals(pr, qmul(q, qexp(d)));
    d[c] = -JACOBIAN_STEP_RAD;
    const rm = residuals(pr, qmul(q, qexp(d)));
    if (!rp || !rm) return null;
    J.push(rp.map((v, j) => (v - rm[j]!) / (2 * JACOBIAN_STEP_RAD)));
  }
  const A = new Array<number>(9).fill(0);
  const b = [0, 0, 0];
  for (let j = 0; j < r.length; j++) {
    for (let a = 0; a < 3; a++) {
      b[a]! -= w[j]! * J[a]![j]! * r[j]!;
      for (let c = 0; c < 3; c++)
        A[a * 3 + c]! += w[j]! * J[a]![j]! * J[c]![j]!;
    }
  }
  return { A, b };
}

interface State {
  q: Quat;
  r: number[];
  cost: number;
  /** Iterations taken to reach this state. */
  iterations: number;
}

/**
 * One damped Gauss-Newton iteration: raise the damping until a step lowers
 * the robust cost. `null` when no step does (converged or stuck).
 */
function dampedIteration(
  pr: Problem,
  state: State,
  lambda: number
): { state: State; lambda: number; done: boolean } | null {
  const eq = normalEquations(
    pr,
    state.q,
    state.r,
    robustWeights(state.r, pr.robustScalePx).w
  );
  if (!eq) return null;
  let damping = lambda;
  for (let tries = 0; tries < 8; tries++, damping *= 5) {
    const Ad = eq.A.map((v, idx) =>
      idx % 4 === 0 ? v + damping * (v + 1e-12) : v
    );
    const dx = solveLinear(Ad, eq.b);
    if (!dx) return null;
    const q = qnormalize(qmul(state.q, qexp(dx)));
    const r = residuals(pr, q);
    if (!r) continue;
    const cost = robustWeights(r, pr.robustScalePx).cost;
    if (cost > state.cost) continue;
    const done =
      Math.hypot(...dx) < STEP_DONE_RAD ||
      state.cost - cost <= COST_DONE_RELATIVE * state.cost;
    return {
      state: { q, r, cost, iterations: state.iterations + 1 },
      lambda: Math.max(damping / 3, 1e-9),
      done,
    };
  }
  return null;
}

function refine(pr: Problem, start: Quat, maxIterations: number): State | null {
  const r = residuals(pr, start);
  if (!r) return null;
  let state: State = {
    q: start,
    r,
    cost: robustWeights(r, pr.robustScalePx).cost,
    iterations: 0,
  };
  let lambda = 1e-3;
  for (let it = 0; it < maxIterations; it++) {
    const step = dampedIteration(pr, state, lambda);
    if (!step) break;
    state = step.state;
    lambda = step.lambda;
    if (step.done) break;
  }
  return state;
}

/**
 * The tilt's 1-sigma (1 px corner noise), degrees, along its worst direction:
 * the larger eigenvalue of the in-plane-axes block of (J^T W J)^-1. The
 * perturbation is code-local, so its x and y components tilt the normal.
 */
function tiltSigmaDeg(pr: Problem, state: State): number {
  const eq = normalEquations(
    pr,
    state.q,
    state.r,
    robustWeights(state.r, pr.robustScalePx).w
  );
  if (!eq) return Infinity;
  const col = (c: number) => solveLinear(eq.A, c === 0 ? [1, 0, 0] : [0, 1, 0]);
  const c0 = col(0);
  const c1 = col(1);
  if (!c0 || !c1) return Infinity;
  const [a, b, d] = [c0[0]!, c0[1]!, c1[1]!];
  const maxEig = (a + d) / 2 + Math.hypot((a - d) / 2, b);
  return maxEig >= 0 ? Math.sqrt(maxEig) * RAD_TO_DEG : Infinity;
}

/**
 * The distinct candidate rotations, cheapest first by their robust cost over
 * ALL views, at most `maxStarts` of them. A view's mirror flip fits the other
 * views badly, so it ranks low as soon as the views differ.
 */
function rankedStarts(
  pr: Problem,
  seeds: readonly ViewSeed[],
  maxStarts: number
): Quat[] {
  const distinct: Quat[] = [];
  for (const q of seeds.flatMap((s) => s.rotations)) {
    if (!distinct.some((s) => angleBetweenDeg(s, q) < DUPLICATE_START_DEG))
      distinct.push(q);
  }
  const costOf = (q: Quat) => {
    const r = residuals(pr, q);
    return r ? robustWeights(r, pr.robustScalePx).cost : Infinity;
  };
  return distinct
    .map((q) => ({ q, cost: costOf(q) }))
    .filter((s) => Number.isFinite(s.cost))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, maxStarts)
    .map((s) => s.q);
}

/** Every view's seed, or `null` when the views or `sizeM` are unusable. */
function seedsOf(
  views: readonly QrViewObservation[],
  sizeM: number
): ViewSeed[] | null {
  if (views.length === 0 || !(sizeM > 0) || !Number.isFinite(sizeM))
    return null;
  if (!views.every(isUsableView)) return null;
  const seeds = views.map((view) => seedOf(view, sizeM));
  return seeds.every((seed): seed is ViewSeed => seed !== null) ? seeds : null;
}

/** The lowest-cost refinement over `starts`, and the iterations it all took. */
function bestRefinement(
  pr: Problem,
  starts: readonly Quat[],
  maxIterations: number
): { best: State | null; iterations: number } {
  let best: State | null = null;
  let iterations = 0;
  for (const start of starts) {
    const state = refine(pr, start, maxIterations);
    if (!state) continue;
    iterations += state.iterations;
    if (!best || state.cost < best.cost) best = state;
  }
  return { best, iterations };
}

/**
 * The code's world rotation from several views of it, with the mean of the
 * views' own positions. `null` when there is no view, `sizeM` is not a
 * positive finite number, an option is out of range, any view is unusable
 * (not four finite corners in front-facing winding, bad intrinsics or camera
 * pose, no real candidate), or no start converges.
 */
export function solveQrPoseMultiView(
  views: readonly QrViewObservation[],
  sizeM: number,
  options: QrMultiViewPoseOptions = {}
): QrMultiViewPoseResult | null {
  const {
    robustScalePx = DEFAULT_ROBUST_SCALE_PX,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxStarts = DEFAULT_MAX_STARTS,
  } = options;
  if (!(robustScalePx > 0) || !(maxStarts >= 1) || !(maxIterations >= 1))
    return null;
  const seeds = seedsOf(views, sizeM);
  if (!seeds) return null;
  const pr: Problem = {
    views,
    object: buildObjectPoints(sizeM),
    positions: seeds.map((seed) => seed.position),
    robustScalePx,
  };
  const starts = rankedStarts(pr, seeds, maxStarts);
  const { best, iterations } = bestRefinement(pr, starts, maxIterations);
  if (!best) return null;
  const mean = (a: 0 | 1 | 2) =>
    seeds.reduce((sum, seed) => sum + seed.position[a], 0) / seeds.length;
  return {
    rotation: best.q,
    position: [mean(0), mean(1), mean(2)],
    costPx: rmsPx(best.r),
    views: views.length,
    tiltSigmaDeg: tiltSigmaDeg(pr, best),
    starts: starts.length,
    iterations,
  };
}
