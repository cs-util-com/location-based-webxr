/**
 * PROTOTYPE (test-only) of the joint multi-view QR pose solve, for measuring
 * the formulations side by side before M3a builds one for production (QR
 * near-frontal pose plan 2026-09-23-2314, M0). See
 * qr-multiview-prototype.ts.md.
 *
 * The code's world rotation is shared by every view; its position is either
 * shared too (`shared6`), free per view (`rotSharedFreeT`), or fixed per view
 * at that view's own solve (`rotSharedFixedT`). damped Gauss-Newton on the
 * corners' reprojection error with a robust loss, numeric Jacobian, all in
 * double precision (the framework's `composePose` is Float32).
 */

import type { CameraIntrinsics, Point2, Pose } from '../ar/qr/qr-pose';
import { buildObjectPoints, solveQrPose } from '../ar/qr/qr-pose';
import {
  PlanarPnpSquare,
  homographyFromCorrespondences,
  ippePoseCandidates,
  rotationToRodrigues,
  solveLinear,
} from '../ar/qr/planar-pnp';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** One detection: its corners (TL, TR, BR, BL), the camera's world pose, intrinsics. */
export interface ViewObservation {
  corners: readonly Point2[];
  cameraWorld: Pose;
  intrinsics: CameraIntrinsics;
}

export type MultiViewVariant = 'rotSharedFixedT' | 'rotSharedFreeT' | 'shared6';

export interface MultiViewOptions {
  sizeM: number;
  variant: MultiViewVariant;
  /** Robust-loss scale on a corner's pixel error; `Infinity` = plain least squares. Default 1. */
  robustScalePx?: number;
  /** Default 30. */
  maxIterations?: number;
  /**
   * `rotSharedFixedT` only: the per-view world positions to hold fixed,
   * instead of each view's own single-view solve (the position re-fit spike,
   * plan §12 / §14).
   */
  fixedPositions?: readonly Vec3[];
}

export interface MultiViewResult {
  rotationWorld: Quat;
  /** The shared position, or the mean of the per-view positions. */
  positionWorld: Vec3;
  /** RMS corner error over all views, px (unweighted). */
  costPx: number;
  /** The view count the solve used. */
  views: number;
}

// --- double-precision quaternion helpers (xyzw) ---

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

function qnormalize(q: Quat): Quat {
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** exp of a rotation vector (axis * angle, rad) as a unit quaternion. */
function qexp(v: readonly number[]): Quat {
  const angle = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (angle < 1e-12) return qnormalize([v[0]! / 2, v[1]! / 2, v[2]! / 2, 1]);
  const s = Math.sin(angle / 2) / angle;
  return [v[0]! * s, v[1]! * s, v[2]! * s, Math.cos(angle / 2)];
}

function rotate(q: readonly number[], v: readonly number[]): Vec3 {
  const r = qmul(qmul(q, [v[0]!, v[1]!, v[2]!, 0]), qconj(q));
  return [r[0], r[1], r[2]];
}

// --- the model ---

/** Pixel of a code-local point, for a code at (q, p) in the world seen by `view`. */
function project(
  view: ViewObservation,
  q: readonly number[],
  p: readonly number[],
  local: readonly number[]
): Point2 | null {
  const world = rotate(q, local);
  const cam = view.cameraWorld;
  const rel = [
    world[0] + p[0]! - cam.position[0],
    world[1] + p[1]! - cam.position[1],
    world[2] + p[2]! - cam.position[2],
  ];
  const [x, y, z] = rotate(qconj(cam.rotation), rel);
  const depth = -z;
  if (!(depth > 1e-6)) return null;
  const { fx, fy, cx, cy } = view.intrinsics;
  return { x: cx + (fx * x) / depth, y: cy - (fy * y) / depth };
}

interface Problem {
  views: ViewObservation[];
  object: readonly (readonly number[])[];
  variant: MultiViewVariant;
  /** Per-view positions for the fixed-translation variant. */
  fixedPositions: Vec3[];
}

function paramCount(pr: Problem): number {
  if (pr.variant === 'shared6') return 6;
  if (pr.variant === 'rotSharedFreeT') return 3 + 3 * pr.views.length;
  return 3;
}

/** Per-view code position for parameter vector `x`. */
function positionOf(
  pr: Problem,
  x: readonly number[],
  i: number,
  base: Vec3[]
): Vec3 {
  if (pr.variant === 'shared6')
    return [base[0]![0] + x[3]!, base[0]![1] + x[4]!, base[0]![2] + x[5]!];
  if (pr.variant === 'rotSharedFreeT') {
    const o = 3 + 3 * i;
    return [
      base[i]![0] + x[o]!,
      base[i]![1] + x[o + 1]!,
      base[i]![2] + x[o + 2]!,
    ];
  }
  return pr.fixedPositions[i]!;
}

/** Residuals (2 per corner) for the perturbation `x` around (q0, base). */
function residuals(
  pr: Problem,
  q0: Quat,
  base: Vec3[],
  x: readonly number[]
): number[] | null {
  const q = qmul(q0, qexp(x));
  const out: number[] = [];
  for (let i = 0; i < pr.views.length; i++) {
    const v = pr.views[i]!;
    const p = positionOf(pr, x, i, base);
    for (let k = 0; k < 4; k++) {
      const px = project(v, q, p, pr.object[k]!);
      if (!px) return null;
      out.push(px.x - v.corners[k]!.x, px.y - v.corners[k]!.y);
    }
  }
  return out;
}

/** Robust weights per residual pair (corner), and the robust cost. */
function robustWeights(
  r: readonly number[],
  k: number
): { w: number[]; cost: number } {
  const w: number[] = [];
  let cost = 0;
  for (let j = 0; j < r.length; j += 2) {
    const e = Math.hypot(r[j]!, r[j + 1]!);
    const wj = e <= k ? 1 : k / e;
    cost += e <= k ? e * e : 2 * k * e - k * k;
    w.push(wj, wj);
  }
  return { w, cost };
}

function rms(r: readonly number[]): number {
  let s = 0;
  for (let j = 0; j < r.length; j += 2)
    s += r[j]! * r[j]! + r[j + 1]! * r[j + 1]!;
  return Math.sqrt(s / (r.length / 2));
}

/** The linearisation point: the world rotation and the per-variant positions. */
interface State {
  q: Quat;
  base: Vec3[];
  cost: number;
  r: number[];
}

/** Numeric Jacobian (central differences) of the residuals at `state`, m x n. */
function numericJacobian(
  pr: Problem,
  state: State,
  n: number
): number[][] | null {
  const m = state.r.length;
  const J: number[][] = Array.from({ length: m }, () =>
    new Array<number>(n).fill(0)
  );
  for (let c = 0; c < n; c++) {
    const h = c < 3 ? 1e-6 : 1e-7;
    const xp = new Array<number>(n).fill(0);
    const xm = new Array<number>(n).fill(0);
    xp[c] = h;
    xm[c] = -h;
    const rp = residuals(pr, state.q, state.base, xp);
    const rm = residuals(pr, state.q, state.base, xm);
    if (!rp || !rm) return null;
    for (let j = 0; j < m; j++) J[j]![c] = (rp[j]! - rm[j]!) / (2 * h);
  }
  return J;
}

/** Weighted normal equations J^T W J and -J^T W r (row-major A). */
function normalEquations(
  J: number[][],
  w: number[],
  r: number[],
  n: number
): { A: number[]; b: number[] } {
  const A = new Array<number>(n * n).fill(0);
  const b = new Array<number>(n).fill(0);
  J.forEach((row, j) => {
    for (let a = 0; a < n; a++) {
      b[a]! -= w[j]! * row[a]! * r[j]!;
      for (let c = 0; c < n; c++) A[a * n + c]! += w[j]! * row[a]! * row[c]!;
    }
  });
  return { A, b };
}

/** Fold an accepted step into the linearisation point. */
function fold(
  pr: Problem,
  state: State,
  dx: number[]
): Pick<State, 'q' | 'base'> {
  const q = qnormalize(qmul(state.q, qexp(dx)));
  if (pr.variant === 'shared6')
    return { q, base: [positionOf(pr, dx, 0, state.base)] };
  if (pr.variant === 'rotSharedFreeT') {
    return {
      q,
      base: state.base.map((_, i) => positionOf(pr, dx, i, state.base)),
    };
  }
  return { q, base: state.base };
}

/**
 * One damped Gauss-Newton iteration: raise the damping until a step lowers
 * the robust cost. `null` when no step does (converged or stuck).
 */
function dampedIteration(
  pr: Problem,
  state: State,
  lambda: number,
  robustScalePx: number
): { state: State; lambda: number; done: boolean } | null {
  const n = paramCount(pr);
  const J = numericJacobian(pr, state, n);
  if (!J) return null;
  const { A, b } = normalEquations(
    J,
    robustWeights(state.r, robustScalePx).w,
    state.r,
    n
  );
  let damping = lambda;
  for (let tries = 0; tries < 8; tries++, damping *= 5) {
    const Ad = A.map((v, idx) =>
      idx % (n + 1) === 0 ? v + damping * (v + 1e-12) : v
    );
    const dx = solveLinear(Ad, b);
    if (!dx) return null;
    const rNew = residuals(pr, state.q, state.base, dx);
    if (!rNew) continue;
    const cost = robustWeights(rNew, robustScalePx).cost;
    if (cost > state.cost) continue;
    const done = Math.hypot(...dx) < 1e-11 || state.cost - cost < 1e-14;
    return {
      state: { ...fold(pr, state, dx), cost, r: rNew },
      lambda: Math.max(damping / 3, 1e-9),
      done,
    };
  }
  return null;
}

/** One damped Gauss-Newton solve from one start; returns the robust cost and the state. */
function refine(
  pr: Problem,
  start: Pose,
  basePositions: Vec3[],
  robustScalePx: number,
  maxIterations: number
): State | null {
  const q = qnormalize([...start.rotation] as Quat);
  const base =
    pr.variant === 'shared6'
      ? [[...start.position] as Vec3]
      : basePositions.map((b) => [...b] as Vec3);
  const r = residuals(pr, q, base, new Array<number>(paramCount(pr)).fill(0));
  if (!r) return null;
  let state: State = { q, base, cost: robustWeights(r, robustScalePx).cost, r };
  let lambda = 1e-3;
  for (let it = 0; it < maxIterations; it++) {
    const step = dampedIteration(pr, state, lambda, robustScalePx);
    if (!step) break;
    state = step.state;
    lambda = step.lambda;
    if (step.done) break;
  }
  return state;
}

/** The world position of each view's own single-view solve, or null when it fails. */
function ownPositions(
  views: readonly ViewObservation[],
  sizeM: number
): Vec3[] | null {
  const solver = new PlanarPnpSquare();
  const out: Vec3[] = [];
  for (const v of views) {
    const sol = solveQrPose({
      imagePoints: v.corners,
      sizeM,
      intrinsics: v.intrinsics,
      cameraPose: v.cameraWorld,
      solver,
      maxReprojectionErrorPx: Infinity,
    });
    if (!sol) return null;
    out.push([...sol.qrPoseWorld.position] as Vec3);
  }
  return out;
}

function meanPosition(positions: readonly Vec3[]): Vec3 {
  return [0, 1, 2].map(
    (a) => positions.reduce((s, p) => s + p[a]!, 0) / positions.length
  ) as Vec3;
}

/** The per-view positions fixedT holds: the given ones, or each view's own solve. */
function heldPositions(
  views: readonly ViewObservation[],
  sizeM: number,
  fixed: readonly Vec3[] | undefined
): Vec3[] | null {
  if (!fixed) return ownPositions(views, sizeM);
  return fixed.length === views.length
    ? fixed.map((p) => [...p] as Vec3)
    : null;
}

/**
 * The best joint solve over `views` from any of `starts` (world code poses).
 * `null` when there is no view, no start, a view without four corners, or no
 * start that converges.
 */
export function solveMultiView(
  views: readonly ViewObservation[],
  starts: readonly Pose[],
  options: MultiViewOptions
): MultiViewResult | null {
  const { sizeM, variant, robustScalePx = 1, maxIterations = 30 } = options;
  if (views.length === 0 || starts.length === 0) return null;
  if (views.some((v) => v.corners.length !== 4)) return null;
  const own = heldPositions(views, sizeM, options.fixedPositions);
  if (!own) return null;
  const pr: Problem = {
    views: [...views],
    object: buildObjectPoints(sizeM),
    variant,
    fixedPositions: own,
  };
  const best = starts
    .map((start) => refine(pr, start, own, robustScalePx, maxIterations))
    .reduce<State | null>(
      (b, s) => (s && (!b || s.cost < b.cost) ? s : b),
      null
    );
  if (!best) return null;
  return {
    rotationWorld: best.q,
    positionWorld: meanPosition(
      variant === 'rotSharedFixedT' ? own : best.base
    ),
    costPx: rms(best.r),
    views: views.length,
  };
}

/**
 * The world poses of ALL of `view`'s IPPE candidates, split into the REAL
 * ones (the `tau = 1/sigma_max` root, both signs) and those of the invalid
 * root (plan §6 finding 1), recognised by its larger depth.
 */
export function candidateStartsBySet(
  view: ViewObservation,
  sizeM: number
): { real: Pose[]; invalid: Pose[] } {
  const { fx, fy, cx, cy } = view.intrinsics;
  const object = buildObjectPoints(sizeM);
  const H = homographyFromCorrespondences(
    object.map((o) => [o[0], o[1]] as [number, number]),
    view.corners.map(
      (c) => [(c.x - cx) / fx, (c.y - cy) / fy] as [number, number]
    )
  );
  if (!H) return { real: [], invalid: [] };
  const candidates = ippePoseCandidates(H);
  const depth = (t: readonly number[]) => Math.hypot(t[0]!, t[1]!, t[2]!);
  const minDepth = Math.min(...candidates.map((c) => depth(c.t)));
  const toWorld = (c: (typeof candidates)[number]): Pose[] => {
    const fixed = { rvec: rotationToRodrigues(c.R), tvec: c.t };
    const sol = solveQrPose({
      imagePoints: view.corners,
      sizeM,
      intrinsics: view.intrinsics,
      cameraPose: view.cameraWorld,
      solver: { solve: () => fixed },
      maxReprojectionErrorPx: Infinity,
    });
    return sol ? [sol.qrPoseWorld] : [];
  };
  const isReal = (c: (typeof candidates)[number]) =>
    depth(c.t) <= minDepth * (1 + 1e-9);
  return {
    real: candidates.filter(isReal).flatMap(toWorld),
    invalid: candidates.filter((c) => !isReal(c)).flatMap(toWorld),
  };
}

/**
 * The world poses of `view`'s REAL IPPE candidates: the starts a multi-view
 * solve tries (the invalid root is left out).
 */
export function realCandidateStarts(
  view: ViewObservation,
  sizeM: number
): Pose[] {
  return candidateStartsBySet(view, sizeM).real;
}
