/**
 * Pure-JS planar-square PnP — the OpenCV-free `SolvePnpSquare` implementation.
 *
 * Implements `qr-pose.ts`'s injected {@link SolvePnpSquare} for a centered planar
 * square (the `SOLVEPNP_IPPE_SQUARE` case) with no OpenCV, no WASM, no worker and
 * no async: `new PlanarPnpSquare()` and call `solve()` synchronously per frame.
 *
 * Algorithm (see planar-pnp.ts.md and the plan doc for the full derivation):
 *  1. Normalize the 4 image points by K⁻¹ (focal-length-1 plane, y-down).
 *  2. Estimate the exact homography H mapping object (X,Y,1) → normalized image,
 *     via an 8×8 DLT (`solveLinear`) fixing h₃₃ = 1.
 *  3. True IPPE (Collins & Bartoli 2014): from H's first-order expansion at the
 *     model centre, generate the TWO analytic pose candidates (the planar
 *     tilt-flip ambiguity) — NOT a single decomposition plus a heuristic flip.
 *  4. Orthonormalize each candidate (`nearestRotation3x3`) and pick the lowest
 *     reprojection error, rejecting any candidate behind the camera.
 *
 * Output is `OpenCvPnpResult` = `{ rvec, tvec }` in the OpenCV camera frame
 * (+x right, +y DOWN, +z FORWARD, p_cam = R·p_obj + t), byte-for-byte the
 * contract `OpenCvPnpSquare` produced, so `solveQrPose`'s OpenCV→WebXR convert,
 * reprojection gate and composition downstream are unchanged.
 *
 * All linear algebra runs in plain `number` (Float64) — gl-matrix's Float32
 * arrays would erode the sub-pixel accuracy the 4 px reprojection gate relies on.
 */

import type {
  CameraIntrinsics,
  OpenCvPnpResult,
  Point2,
  SolvePnpSquare,
} from './qr-pose.js';
import type { Vector3 } from 'gps-plus-slam-js';

/** A 3×3 matrix in ROW-MAJOR order: [r00,r01,r02, r10,r11,r12, r20,r21,r22]. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** A 3×3 homography in row-major order (same layout as {@link Mat3}). */
export type Homography = Mat3;

/** A candidate rigid pose in the OpenCV camera frame (p_cam = R·p_obj + t). */
export interface PoseCandidate {
  /** Rotation, row-major 3×3. */
  R: Mat3;
  /** Translation (object origin in the OpenCV camera frame), meters. */
  t: Vector3;
}

const EPS = 1e-12;

/**
 * Solve the dense square linear system `A·x = b` by Gaussian elimination with
 * partial pivoting. `A` is `n×n` ROW-MAJOR (length n²), `b` is length n. Returns
 * the solution, or `null` when the matrix is singular (no unique solution).
 */
export function solveLinear(
  A: readonly number[],
  b: readonly number[]
): number[] | null {
  const n = b.length;
  if (A.length !== n * n || n === 0) {
    return null;
  }
  // Work on mutable copies so the inputs stay untouched.
  const m = A.slice();
  const y = b.slice();

  for (let col = 0; col < n; col++) {
    // Partial pivot: largest |value| in this column at or below the diagonal.
    let pivot = col;
    let best = Math.abs(m[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(m[row * n + col]!);
      if (v > best) {
        best = v;
        pivot = row;
      }
    }
    if (best < EPS) {
      return null; // singular
    }
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const tmp = m[col * n + k]!;
        m[col * n + k] = m[pivot * n + k]!;
        m[pivot * n + k] = tmp;
      }
      const tmp = y[col]!;
      y[col] = y[pivot]!;
      y[pivot] = tmp;
    }
    // Eliminate below.
    const diag = m[col * n + col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col]! / diag;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) {
        m[row * n + k] = m[row * n + k]! - factor * m[col * n + k]!;
      }
      y[row] = y[row]! - factor * y[col]!;
    }
  }

  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = y[row]!;
    for (let k = row + 1; k < n; k++) {
      sum -= m[row * n + k]! * x[k]!;
    }
    x[row] = sum / m[row * n + row]!;
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Estimate the exact planar homography H (row-major 3×3, h₃₃ = 1) mapping object
 * plane coords `(X,Y,1)` to NORMALIZED image coords `(x,y,1)` from 4 (or more)
 * correspondences via a DLT. Returns `null` when the configuration is degenerate
 * (collinear points → singular system). `objectXY`/`imageXY` are parallel arrays
 * of `[X,Y]` / `[x,y]`.
 */
export function homographyFromCorrespondences(
  objectXY: ReadonlyArray<readonly [number, number]>,
  imageXY: ReadonlyArray<readonly [number, number]>
): Homography | null {
  const n = objectXY.length;
  if (n < 4 || imageXY.length !== n) {
    return null;
  }
  // 8 unknowns (h00..h21, h22≡1). With exactly 4 points this is square; with
  // more we still take the first 4 (the QR case is always 4 corners).
  const A: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const o = objectXY[i]!;
    const im = imageXY[i]!;
    const X = o[0];
    const Y = o[1];
    const x = im[0];
    const y = im[1];
    A.push(X, Y, 1, 0, 0, 0, -x * X, -x * Y);
    b.push(x);
    A.push(0, 0, 0, X, Y, 1, -y * X, -y * Y);
    b.push(y);
  }
  const h = solveLinear(A, b);
  if (!h) {
    return null;
  }
  const H: Mat3 = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
  return H.every(Number.isFinite) ? H : null;
}

/** Multiply two row-major 3×3 matrices: returns A·B. */
function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3]! * b[c]! +
        a[r * 3 + 1]! * b[3 + c]! +
        a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out as unknown as Mat3;
}

/** Transpose a row-major 3×3 matrix. */
function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Determinant of a row-major 3×3 matrix. */
function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Inverse-transpose of a row-major 3×3 matrix, or `null` if singular. */
function invTranspose3(m: Mat3): Mat3 | null {
  const d = det3(m);
  if (Math.abs(d) < EPS) {
    return null;
  }
  const inv = 1 / d;
  // adjugate (transpose of cofactors), then we want (M⁻¹)ᵀ = (cofactor)/d.
  // cofactor[r][c] / d gives (M⁻¹)ᵀ directly.
  const c00 = m[4] * m[8] - m[5] * m[7];
  const c01 = -(m[3] * m[8] - m[5] * m[6]);
  const c02 = m[3] * m[7] - m[4] * m[6];
  const c10 = -(m[1] * m[8] - m[2] * m[7]);
  const c11 = m[0] * m[8] - m[2] * m[6];
  const c12 = -(m[0] * m[7] - m[1] * m[6]);
  const c20 = m[1] * m[5] - m[2] * m[4];
  const c21 = -(m[0] * m[5] - m[2] * m[3]);
  const c22 = m[0] * m[4] - m[1] * m[3];
  // (M⁻¹)ᵀ row-major = cofactor matrix / d (cofactor[r][c] in row-major).
  return [
    c00 * inv,
    c01 * inv,
    c02 * inv,
    c10 * inv,
    c11 * inv,
    c12 * inv,
    c20 * inv,
    c21 * inv,
    c22 * inv,
  ];
}

/**
 * Project a near-orthogonal 3×3 matrix onto the nearest rotation (SO(3)) by
 * iterative polar decomposition (Higham: `R_{k+1} = ½(R_k + R_k⁻ᵀ)`). Converges
 * quadratically for an already near-orthonormal input; needs no SVD/eigensolver
 * (gl-matrix has neither). Forces `det = +1` by flipping the least-aligned column
 * if the input was left-handed. Returns the input unchanged if it is singular.
 */
export function nearestRotation3x3(input: Mat3): Mat3 {
  let R: Mat3 = input;
  for (let i = 0; i < 12; i++) {
    const invT = invTranspose3(R);
    if (!invT) {
      break;
    }
    const next: Mat3 = [
      0.5 * (R[0] + invT[0]),
      0.5 * (R[1] + invT[1]),
      0.5 * (R[2] + invT[2]),
      0.5 * (R[3] + invT[3]),
      0.5 * (R[4] + invT[4]),
      0.5 * (R[5] + invT[5]),
      0.5 * (R[6] + invT[6]),
      0.5 * (R[7] + invT[7]),
      0.5 * (R[8] + invT[8]),
    ];
    let delta = 0;
    for (let k = 0; k < 9; k++) {
      delta += Math.abs(next[k]! - R[k]!);
    }
    R = next;
    if (delta < 1e-15) {
      break;
    }
  }
  // Guarantee a proper rotation (det = +1). Polar decomposition lands on the
  // orthogonal factor closest to the input; if that factor is a reflection,
  // negate the last column to make it a rotation.
  if (det3(R) < 0) {
    R = [R[0], R[1], -R[2], R[3], R[4], -R[5], R[6], R[7], -R[8]];
  }
  return R;
}

/** Cross product a × b. */
function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Generate the planar-pose candidates from a homography via true IPPE
 * (Collins & Bartoli 2014). Returns up to 4 chirality-valid candidates (the two
 * tilt-flip roots × the z-sign of the in-plane axes); the caller picks the
 * lowest reprojection error. Returns `[]` when the homography is degenerate.
 *
 * Derivation (see planar-pnp.ts.md): with `[r1 r2]` the first two columns of R,
 * the local first-order map at the model origin gives `M·[r1 r2] = t_z·J` where
 * `M = [[1,0,-p],[0,1,-q]]`, `(p,q)` is the origin's normalized image and `J` the
 * 2×2 Jacobian of the homography there. Aligning the origin's ray to +z (rotation
 * `Rv`) reduces this to a 2×2 block `B = τ·g` whose unknown bottom row plus the
 * orthonormality of `[r1 r2]` yields a biquadratic in `τ = t_z`:
 * `D²·τ⁴ − S·τ² + 1 = 0`, with `S = ‖g‖_F²`, `D = det(g)`. Its two roots are the
 * two planar poses (they coincide fronto-parallel — no flip there).
 */
export function ippePoseCandidates(H: Homography): PoseCandidate[] {
  // Normalized image of the model origin (0,0,1) → third column of H.
  const p = H[2];
  const q = H[5];
  // Jacobian of the normalized projection wrt model (X,Y) at the origin.
  const Jxx = H[0] - p * H[6];
  const Jxy = H[1] - p * H[7];
  const Jyx = H[3] - q * H[6];
  const Jyy = H[4] - q * H[7];

  // Rv: rotation taking the ray (p,q,1) onto +z (axis (q,-p,0), angle θ).
  const t = Math.hypot(p, q);
  const s = Math.hypot(p, q, 1);
  let Rv: Mat3;
  if (t < EPS) {
    Rv = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  } else {
    const ax = q / t;
    const ay = -p / t;
    const c = 1 / s;
    const sn = t / s;
    const omc = 1 - c;
    Rv = [
      c + ax * ax * omc,
      ax * ay * omc,
      ay * sn,
      ax * ay * omc,
      c + ay * ay * omc,
      -ax * sn,
      -ay * sn,
      ax * sn,
      c,
    ];
  }
  const RvT = transpose3(Rv);

  // g = (1/w)·Rv[0:2,0:2]·J, w = Rv[2]·(p,q,1).
  const w = Rv[6] * p + Rv[7] * q + Rv[8];
  if (Math.abs(w) < EPS) {
    return [];
  }
  const g00 = (Rv[0] * Jxx + Rv[1] * Jyx) / w;
  const g01 = (Rv[0] * Jxy + Rv[1] * Jyy) / w;
  const g10 = (Rv[3] * Jxx + Rv[4] * Jyx) / w;
  const g11 = (Rv[3] * Jxy + Rv[4] * Jyy) / w;

  const G1 = g00 * g00 + g10 * g10;
  const G2 = g01 * g01 + g11 * g11;
  const G12 = g00 * g01 + g10 * g11;
  const S = G1 + G2;
  const D = g00 * g11 - g01 * g10;

  // Roots of D²·τ⁴ − S·τ² + 1 = 0 in τ² (> 0).
  const tauSquared: number[] = [];
  if (Math.abs(D) < EPS) {
    // Degenerates to −S·τ² + 1 = 0 (e.g. fronto-parallel with no scale split).
    if (S > EPS) {
      tauSquared.push(1 / S);
    }
  } else {
    const disc = Math.max(0, S * S - 4 * D * D);
    const root = Math.sqrt(disc);
    const denom = 2 * D * D;
    const t1 = (S + root) / denom;
    const t2 = (S - root) / denom;
    if (t1 > EPS) tauSquared.push(t1);
    if (t2 > EPS && Math.abs(t2 - t1) > 1e-9 * t1) tauSquared.push(t2);
  }

  const candidates: PoseCandidate[] = [];
  for (const tau2 of tauSquared) {
    const tau = Math.sqrt(tau2);
    const a2 = Math.max(0, 1 - tau2 * G1);
    const b2 = Math.max(0, 1 - tau2 * G2);
    const aMag = Math.sqrt(a2);
    const bMag = Math.sqrt(b2);
    // a·b must equal −τ²·G12; pick the relative sign accordingly. The overall
    // (a,b)→(−a,−b) sign is a genuine second candidate — emit both.
    const wantNeg = -tau2 * G12 < 0;
    for (const signA of [1, -1]) {
      const a = signA * aMag;
      let b = bMag;
      if (wantNeg) b = -b;
      b *= signA;
      const cand = buildCandidate(g00, g10, g01, g11, a, b, tau, Rv, RvT);
      if (cand) candidates.push(cand);
    }
  }
  return candidates;
}

/**
 * The candidates of {@link ippePoseCandidates} that can be the true pose: the
 * smaller-depth root `τ = 1/σ_max(g)`, both signs (the mirror-flip pair). The
 * other root, `τ = 1/σ_min(g)`, has `τ²·(G1 + G2) > 2`, so at least one column
 * would need a negative squared z-component: it is clamped to 0 and the
 * result is a rotation only because `nearestRotation3x3` forces it into one.
 * Its larger depth is what gives it away (QR near-frontal pose plan
 * 2026-09-23-2314, §6 finding 1). Used by the
 * multi-view solve; {@link PlanarPnpSquare} still picks among all candidates.
 */
export function realIppeCandidates(H: Homography): PoseCandidate[] {
  const candidates = ippePoseCandidates(H);
  const depth = (c: PoseCandidate) => Math.hypot(c.t[0], c.t[1], c.t[2]);
  const minDepth = Math.min(...candidates.map(depth));
  return candidates.filter((c) => depth(c) <= minDepth * (1 + 1e-9));
}

/** Assemble a pose candidate from the aligned-frame 2×2 block + z-components. */
function buildCandidate(
  g00: number,
  g10: number,
  g01: number,
  g11: number,
  a: number,
  b: number,
  tau: number,
  Rv: Mat3,
  RvT: Mat3
): PoseCandidate | null {
  // Columns of R in the aligned frame.
  const r1: Vector3 = [tau * g00, tau * g10, a];
  const r2: Vector3 = [tau * g01, tau * g11, b];
  const r3 = cross(r1, r2);
  // R'' (aligned) row-major, columns r1,r2,r3.
  const Rpp: Mat3 = [
    r1[0],
    r2[0],
    r3[0],
    r1[1],
    r2[1],
    r3[1],
    r1[2],
    r2[2],
    r3[2],
  ];
  // Un-align: R = Rvᵀ · R''. Translation t = Rvᵀ · (0,0,τ) = τ · (Rv third row).
  const R = nearestRotation3x3(mul3(RvT, Rpp));
  const tt: Vector3 = [tau * Rv[6], tau * Rv[7], tau * Rv[8]];
  if (!R.every(Number.isFinite) || !tt.every(Number.isFinite)) {
    return null;
  }
  return { R, t: tt };
}

/**
 * Convert a row-major rotation matrix to a Rodrigues vector (axis · angle).
 * Double-precision, no gl-matrix Float32 round-trip.
 */
export function rotationToRodrigues(R: Mat3): Vector3 {
  const trace = R[0] + R[4] + R[8];
  let cosTheta = (trace - 1) / 2;
  cosTheta = Math.min(1, Math.max(-1, cosTheta));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-9) {
    return [0, 0, 0];
  }
  if (Math.PI - theta < 1e-6) {
    // Near 180°: axis from the dominant diagonal of (R + I)/2.
    const xx = (R[0] + 1) / 2;
    const yy = (R[4] + 1) / 2;
    const zz = (R[8] + 1) / 2;
    let ax = Math.sqrt(Math.max(0, xx));
    let ay = Math.sqrt(Math.max(0, yy));
    let az = Math.sqrt(Math.max(0, zz));
    // Fix signs from the off-diagonals relative to the largest component.
    if (ax >= ay && ax >= az) {
      ay = Math.sign(R[1] + R[3]) * ay;
      az = Math.sign(R[2] + R[6]) * az;
    } else if (ay >= az) {
      ax = Math.sign(R[1] + R[3]) * ax;
      az = Math.sign(R[5] + R[7]) * az;
    } else {
      ax = Math.sign(R[2] + R[6]) * ax;
      ay = Math.sign(R[5] + R[7]) * ay;
    }
    const norm = Math.hypot(ax, ay, az) || 1;
    return [(theta * ax) / norm, (theta * ay) / norm, (theta * az) / norm];
  }
  const k = theta / (2 * Math.sin(theta));
  return [k * (R[7] - R[5]), k * (R[2] - R[6]), k * (R[3] - R[1])];
}

/** RMS reprojection error (px) of a candidate against the detected corners. */
function reprojectionError(
  cand: PoseCandidate,
  objectPoints: readonly Vector3[],
  imagePoints: readonly Point2[],
  intr: CameraIntrinsics
): number {
  const { R, t } = cand;
  let sumSq = 0;
  for (let i = 0; i < objectPoints.length; i++) {
    const o = objectPoints[i]!;
    const img = imagePoints[i]!;
    const cx = R[0] * o[0] + R[1] * o[1] + R[2] * o[2] + t[0];
    const cy = R[3] * o[0] + R[4] * o[1] + R[5] * o[2] + t[1];
    const cz = R[6] * o[0] + R[7] * o[1] + R[8] * o[2] + t[2];
    if (!(cz > 0)) {
      return Infinity; // behind the camera → invalid candidate
    }
    const px = intr.cx + (intr.fx * cx) / cz;
    const py = intr.cy + (intr.fy * cy) / cz;
    const dx = px - img.x;
    const dy = py - img.y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / objectPoints.length);
}

/**
 * `SolvePnpSquare` for a centered planar square via pure-JS IPPE. Stateless and
 * synchronous — construct once and reuse, or construct per call; either is fine.
 */
export class PlanarPnpSquare implements SolvePnpSquare {
  solve(
    objectPoints: readonly Vector3[],
    imagePoints: readonly Point2[],
    intrinsics: CameraIntrinsics
  ): OpenCvPnpResult | null {
    if (objectPoints.length !== imagePoints.length || objectPoints.length < 4) {
      return null;
    }
    const { fx, fy, cx, cy } = intrinsics;
    if (
      !(fx > 0) ||
      !(fy > 0) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy)
    ) {
      return null;
    }

    const objectXY: Array<[number, number]> = [];
    const imageXY: Array<[number, number]> = [];
    for (let i = 0; i < objectPoints.length; i++) {
      const o = objectPoints[i]!;
      const im = imagePoints[i]!;
      if (!Number.isFinite(im.x) || !Number.isFinite(im.y)) {
        return null;
      }
      objectXY.push([o[0], o[1]]);
      imageXY.push([(im.x - cx) / fx, (im.y - cy) / fy]);
    }

    const H = homographyFromCorrespondences(objectXY, imageXY);
    if (!H) {
      return null;
    }

    const candidates = ippePoseCandidates(H);
    if (candidates.length === 0) {
      return null;
    }

    let best: PoseCandidate | null = null;
    let bestErr = Infinity;
    for (const cand of candidates) {
      const err = reprojectionError(
        cand,
        objectPoints,
        imagePoints,
        intrinsics
      );
      if (err < bestErr) {
        bestErr = err;
        best = cand;
      }
    }
    if (!best || !Number.isFinite(bestErr)) {
      return null;
    }

    const rvec = rotationToRodrigues(best.R);
    const tvec = best.t;
    if (![...rvec, ...tvec].every(Number.isFinite) || !(tvec[2] > 0)) {
      return null;
    }
    return { rvec, tvec };
  }
}
