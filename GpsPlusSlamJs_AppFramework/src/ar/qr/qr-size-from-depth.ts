/**
 * QR size from depth — Note 4 of the QR-tracking follow-up plan
 * (docs `2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md`).
 *
 * MEASURE a QR's printed physical size directly from the depth map, so the
 * QR content + printed size are irrelevant and `qr.physicalSizeM` need not be
 * hand-authored. The 4 corner pixels (and a few interior samples to catch edge
 * depth-bleed) are unprojected to 3D via the existing `createDepthUnprojector`
 * (depth + projection + camera pose → raw-WebXR points); the pairwise side
 * lengths of the unprojected square give a per-observation size estimate WITH
 * metric scale from depth — no `solvePnP` scale assumption needed.
 *
 * Two pieces:
 * - {@link estimateQrSizeFromDepth} — one observation → `{ sizeM, quality }`.
 *   `quality ∈ [0,1]` falls as the 4 sides disagree, the diagonals deviate from
 *   `√2·side`, or the corners/interior points are non-planar (depth noise / not
 *   a planar square facing us). A caller rejects low-quality reads.
 * - {@link createQrSizeAccumulator} — a robust running MEDIAN over accepted
 *   observations, reporting the Note 3 size lifecycle (`unknown → measuring →
 *   estimated`). The median is robust to depth noise; the lifecycle gate
 *   (min sample count + low spread) is what later promotes a measured size to
 *   drive size-dependent features.
 *
 * The size-estimate VALUE types ({@link QrSizeStatus}, {@link QrSizeEstimate})
 * live here (not in the `qrDetected` state slice) so the slice can import them
 * WITHOUT the `ar` layer ever importing `state` — that would close a cycle.
 *
 * @see depth-unprojection.ts — `createDepthUnprojector` (the unprojection it composes).
 * @see ../state/qr-detected-slice.ts — consumes `QrSizeEstimate` (the size lifecycle).
 */

import { vec3 } from 'gl-matrix';
import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../../types/ar-types.js';
import type { DepthUnprojector } from '../depth-unprojection.js';
import { clamp01 } from '../../utils/clamp01.js';
import { interpolatingMedian } from '../../utils/median.js';

/** Where the size lifecycle currently sits for one marker (Note 3 / Note 4). */
export type QrSizeStatus =
  /** No size authored and none measured yet — size-dependent features blocked. */
  | 'unknown'
  /** Measurements are accumulating but the estimate has not converged. */
  | 'measuring'
  /** A reliably-estimated (or authored) size — size-dependent features unlock. */
  | 'estimated';

/** Per-marker physical-size estimate (drives the Note 3 size lifecycle). */
export interface QrSizeEstimate {
  status: QrSizeStatus;
  /** Running median side length, meters, or `null` while unknown. */
  estimateM: number | null;
  /** How many accepted samples back the estimate. */
  sampleCount: number;
  /**
   * Robust confidence half-width of the estimate, meters (`1.4826·MAD/√N`), so
   * it TIGHTENS as samples accumulate (WS-B) — not the raw max−min. 0 when <2
   * samples. The HUD renders this as the shrinking `±mm`.
   */
  spreadM: number;
}

/** One per-observation size read from a single detection's depth samples. */
export interface QrSizeObservation {
  /** Median of the 4 unprojected edge lengths, meters. */
  sizeM: number;
  /** Consistency score in [0,1]; 1 = a perfect planar square facing the camera. */
  quality: number;
}

const EPS = 1e-9;

/**
 * Absolute floor (meters) for the robust plane-fit inlier band, used when the
 * MAD-derived σ is ~0 (a near-perfect plane). Comfortably above float round-
 * trip noise yet far below a real depth outlier at QR scale. See WS-A.
 */
const PLANE_INLIER_FLOOR_M = 0.005;

function dist(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Estimate a QR's physical side length from one detection's depth samples.
 *
 * @param corners - the 4 corner depth samples, ordered TL, TR, BR, BL (matching
 *   `buildObjectPoints` / the detector corner-order normalization).
 * @param interiorSamples - a few interior depth samples (may be empty); used
 *   only to strengthen the planarity check against corner edge depth-bleed.
 * @param unprojector - built once per depth sample via `createDepthUnprojector`.
 * @returns `{ sizeM, quality }`, or `null` when a corner cannot be unprojected
 *   or the quad is degenerate (collinear / zero-area).
 */
export function estimateQrSizeFromDepth(
  corners: readonly [DepthPoint, DepthPoint, DepthPoint, DepthPoint],
  interiorSamples: readonly DepthPoint[],
  unprojector: DepthUnprojector
): QrSizeObservation | null {
  const world: Vector3[] = [];
  for (const c of corners) {
    const p = unprojector.unproject(c);
    if (!p) return null;
    world.push(p);
  }
  const [c0, c1, c2, c3] = world as [Vector3, Vector3, Vector3, Vector3];

  // Consecutive edges (TL-TR, TR-BR, BR-BL, BL-TL) and the two diagonals.
  const edges: [number, number, number, number] = [
    dist(c0, c1),
    dist(c1, c2),
    dist(c2, c3),
    dist(c3, c0),
  ];
  const meanEdge = (edges[0] + edges[1] + edges[2] + edges[3]) / 4;
  if (!(meanEdge > EPS)) return null; // degenerate / zero-size

  // Plane through three adjacent corners (c0 as origin, c1 & c3 as in-plane
  // axes). A collinear triple has a zero-length normal → degenerate quad.
  const u = vec3.subtract(
    vec3.create(),
    [c1[0], c1[1], c1[2]],
    [c0[0], c0[1], c0[2]]
  );
  const v = vec3.subtract(
    vec3.create(),
    [c3[0], c3[1], c3[2]],
    [c0[0], c0[1], c0[2]]
  );
  const normal = vec3.cross(vec3.create(), u, v);
  const normalLen = vec3.length(normal);
  if (!(normalLen > EPS)) return null;
  vec3.scale(normal, normal, 1 / normalLen);

  const planeOffset = (p: Vector3): number =>
    Math.abs(
      normal[0] * (p[0] - c0[0]) +
        normal[1] * (p[1] - c0[1]) +
        normal[2] * (p[2] - c0[2])
    );

  // Planarity: c2 (the corner NOT on the defining plane) plus every interior
  // sample should lie on the plane; the largest offset bounds the error.
  let maxPlaneOffset = planeOffset(c2);
  for (const s of interiorSamples) {
    const p = unprojector.unproject(s);
    if (!p) continue; // a single bad interior read shouldn't void the estimate
    maxPlaneOffset = Math.max(maxPlaneOffset, planeOffset(p));
  }

  // Relative-error components, all normalized by the mean edge so `quality` is
  // scale-free: edge agreement, diagonal ≈ √2·edge, and planarity.
  const edgeErr =
    Math.max(...edges.map((e) => Math.abs(e - meanEdge))) / meanEdge;
  const expectedDiag = meanEdge * Math.SQRT2;
  const diagErr =
    Math.max(
      Math.abs(dist(c0, c2) - expectedDiag),
      Math.abs(dist(c1, c3) - expectedDiag)
    ) / expectedDiag;
  const planeErr = maxPlaneOffset / meanEdge;

  const relErr = Math.max(edgeErr, diagErr, planeErr);
  const quality = clamp01(1 - relErr);

  return { sizeM: interpolatingMedian(edges), quality };
}

// --- Dense plane-fit size estimate (WS-A) ------------------------------
//
// The corner-only estimate above unprojects the 4 corner depth reads directly.
// On a SMALL QR over a coarse depth source the corners share one borrowed depth
// (a fronto-parallel guess that loses tilt and is wrong whenever the nearest
// read sits off the QR). The dense path instead fits the QR PLANE to many
// interior depth reads and recovers the corners by intersecting their pixel
// rays with that plane — decoupling "where depth exists" from "where the corners
// are." See `2026-06-17-1020-qr-size-accuracy-and-thin-demo-plan.md` WS-A.

/** A normalized screen position (top-left origin), depth-free. */
export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

/** A robustly-fitted plane: a point on it, a unit normal, and fit diagnostics. */
export interface PlaneFit {
  /** Centroid of the inlier points (a point on the plane). */
  point: Vector3;
  /** Unit normal. */
  normal: Vector3;
  /** How many points were kept as inliers. */
  inlierCount: number;
  /** RMS orthogonal residual of the inliers, meters. */
  rms: number;
}

/**
 * Least-squares plane through a point set, refined from a seed normal. Avoids a
 * full eigensolver: the seed (from LMS) picks which axis is most aligned with
 * the normal, that axis becomes the dependent variable of a 2-parameter linear
 * fit through the centroid (well-conditioned precisely because the plane is not
 * near-vertical in that axis), and the 2×2 normal equations are solved in closed
 * form. Returns `null` for fewer than 3 points or a singular (collinear) fit.
 */
function fitPlaneLeastSquares(
  points: readonly Vector3[],
  seedNormal: Vector3
): { centroid: Vector3; normal: Vector3 } | null {
  const n = points.length;
  if (n < 3) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= n;
  cy /= n;
  cz /= n;

  // Dependent axis = the one the seed normal points along most strongly.
  const ax = Math.abs(seedNormal[0]);
  const ay = Math.abs(seedNormal[1]);
  const az = Math.abs(seedNormal[2]);
  const dep = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  // (u, w) are the two independent axes; d is the dependent axis.
  const split = (p: Vector3): [number, number, number] =>
    dep === 0
      ? [p[1] - cy, p[2] - cz, p[0] - cx]
      : dep === 1
        ? [p[0] - cx, p[2] - cz, p[1] - cy]
        : [p[0] - cx, p[1] - cy, p[2] - cz];

  let Suu = 0;
  let Suw = 0;
  let Sww = 0;
  let Sud = 0;
  let Swd = 0;
  for (const p of points) {
    const [u, w, d] = split(p);
    Suu += u * u;
    Suw += u * w;
    Sww += w * w;
    Sud += u * d;
    Swd += w * d;
  }
  const det = Suu * Sww - Suw * Suw;
  if (Math.abs(det) < EPS) return null; // collinear → ill-conditioned

  // d ≈ a·u + b·w → plane normal (coefficients of u, w, d) = (-a, -b, 1).
  const a = (Sud * Sww - Swd * Suw) / det;
  const b = (Swd * Suu - Sud * Suw) / det;
  const nUWD: [number, number, number] = [-a, -b, 1];
  // Map the (u, w, d) normal back to (x, y, z) by the chosen split.
  const nxyz: Vector3 =
    dep === 0
      ? [nUWD[2], nUWD[0], nUWD[1]]
      : dep === 1
        ? [nUWD[0], nUWD[2], nUWD[1]]
        : [nUWD[0], nUWD[1], nUWD[2]];
  const len = Math.hypot(nxyz[0], nxyz[1], nxyz[2]);
  if (!(len > EPS)) return null;
  // Orient to agree with the seed (sign is otherwise arbitrary).
  const dot =
    nxyz[0] * seedNormal[0] + nxyz[1] * seedNormal[1] + nxyz[2] * seedNormal[2];
  const sign = dot < 0 ? -1 : 1;
  const normal: Vector3 = [
    (sign * nxyz[0]) / len,
    (sign * nxyz[1]) / len,
    (sign * nxyz[2]) / len,
  ];
  return { centroid: [cx, cy, cz], normal };
}

/**
 * Robustly fit a plane to 3D points. A plain least-squares (PCA) plane is
 * fragile here: one gross depth outlier (edge depth-bleed, a stray background
 * read) can dominate the off-plane variance and flip which axis PCA calls the
 * normal, so MAD rejection then runs against a wrong normal. Instead we use
 * Least-Median-of-Squares — pick the candidate plane (from a point triple) that
 * minimizes the MEDIAN squared orthogonal residual (≈50% breakdown, no
 * threshold) — derive a robust scale from that median, select inliers, then
 * least-squares refit on the inliers for an accurate normal/centroid.
 *
 * Deterministic (fixed-seed triple sampling) so property tests are
 * reproducible. Returns `null` for fewer than 3 points or a degenerate
 * (collinear / coincident) set where no non-degenerate triple exists.
 */
export function fitPlaneRobust(points: readonly Vector3[]): PlaneFit | null {
  const n = points.length;
  if (n < 3) return null;

  // LMS: search candidate planes from point triples for the minimum median
  // squared residual. Deterministic LCG so the same input always samples the
  // same triples.
  let best: { normal: Vector3; p0: Vector3; medSq: number } | null = null;
  let rng = 0x2545f491;
  const nextIdx = (): number => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng % n;
  };
  const TRIALS = 200;
  for (let t = 0; t < TRIALS; t++) {
    const i = nextIdx();
    const j = nextIdx();
    const k = nextIdx();
    if (i === j || j === k || i === k) continue;
    const a = points[i] as Vector3;
    const b = points[j] as Vector3;
    const c = points[k] as Vector3;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > EPS)) continue; // degenerate (collinear) triple
    nx /= len;
    ny /= len;
    nz /= len;
    const sq = points.map((p) => {
      const d = nx * (p[0] - a[0]) + ny * (p[1] - a[1]) + nz * (p[2] - a[2]);
      return d * d;
    });
    const medSq = interpolatingMedian(sq);
    if (!best || medSq < best.medSq) {
      best = { normal: [nx, ny, nz], p0: a, medSq };
    }
  }
  if (!best) return null; // every triple degenerate → collinear set

  // Robust LMS scale; keep points within 2.5σ, with an absolute floor so a
  // near-perfect plane (medSq≈0) keeps its clean points (float round-trip
  // noise ≪ 5 mm) while gross dm-scale outliers stay rejected.
  const sigma = 1.4826 * (1 + 5 / Math.max(1, n - 3)) * Math.sqrt(best.medSq);
  const band = Math.max(2.5 * sigma, PLANE_INLIER_FLOOR_M);
  const { normal: bn, p0 } = best;
  let inliers = points.filter(
    (p) =>
      Math.abs(
        bn[0] * (p[0] - p0[0]) + bn[1] * (p[1] - p0[1]) + bn[2] * (p[2] - p0[2])
      ) <= band
  );
  if (inliers.length < 3) inliers = [...points];

  const refit = fitPlaneLeastSquares(inliers, bn);
  if (!refit) return null;
  const refitDist = (p: Vector3): number =>
    refit.normal[0] * (p[0] - refit.centroid[0]) +
    refit.normal[1] * (p[1] - refit.centroid[1]) +
    refit.normal[2] * (p[2] - refit.centroid[2]);
  const rms = Math.sqrt(
    inliers.reduce((acc, p) => acc + refitDist(p) ** 2, 0) / inliers.length
  );

  return {
    point: refit.centroid,
    normal: refit.normal,
    inlierCount: inliers.length,
    rms,
  };
}

/**
 * Intersect the camera ray through a normalized screen point with a plane.
 * The ray is recovered by unprojecting the screen point at two distinct depths
 * (both lie on the corner's pixel ray); no explicit camera center is needed.
 * Returns the metric 3D intersection, or `null` for a parallel/degenerate ray.
 */
function intersectScreenRayWithPlane(
  screen: ScreenPoint,
  plane: PlaneFit,
  unprojector: DepthUnprojector
): Vector3 | null {
  const a = unprojector.unproject({ ...screen, depthM: 1 });
  const b = unprojector.unproject({ ...screen, depthM: 2 });
  if (!a || !b) return null;
  const dir: Vector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const { normal: n, point: pp } = plane;
  const denom = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
  if (Math.abs(denom) < EPS) return null; // ray parallel to plane
  const t =
    (n[0] * (pp[0] - a[0]) + n[1] * (pp[1] - a[1]) + n[2] * (pp[2] - a[2])) /
    denom;
  const hit: Vector3 = [
    a[0] + t * dir[0],
    a[1] + t * dir[1],
    a[2] + t * dir[2],
  ];
  return hit.every((v) => Number.isFinite(v)) ? hit : null;
}

/**
 * Estimate a QR's physical side length by fitting the QR plane to many interior
 * depth reads and intersecting the 4 corner pixel rays with that plane.
 *
 * @param cornerScreens - the 4 corner screen positions, ordered TL, TR, BR, BL.
 * @param samples - interior (and optionally corner) depth reads across the QR
 *   face used for the robust plane fit. Need ≥3 non-collinear usable reads.
 * @param unprojector - built once per depth sample via `createDepthUnprojector`.
 * @returns `{ sizeM, quality }`, or `null` when the plane is under-determined
 *   (too few/collinear reads) or a corner ray cannot meet the plane.
 */
export function estimateQrSizeFromDepthDense(
  cornerScreens: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  samples: readonly DepthPoint[],
  unprojector: DepthUnprojector
): QrSizeObservation | null {
  const points: Vector3[] = [];
  for (const s of samples) {
    const p = unprojector.unproject(s);
    if (p) points.push(p);
  }
  const plane = fitPlaneRobust(points);
  if (!plane) return null;

  const corners: Vector3[] = [];
  for (const screen of cornerScreens) {
    const hit = intersectScreenRayWithPlane(screen, plane, unprojector);
    if (!hit) return null;
    corners.push(hit);
  }
  const [c0, c1, c2, c3] = corners as [Vector3, Vector3, Vector3, Vector3];

  const edges: [number, number, number, number] = [
    dist(c0, c1),
    dist(c1, c2),
    dist(c2, c3),
    dist(c3, c0),
  ];
  const meanEdge = (edges[0] + edges[1] + edges[2] + edges[3]) / 4;
  if (!(meanEdge > EPS)) return null;

  const edgeErr =
    Math.max(...edges.map((e) => Math.abs(e - meanEdge))) / meanEdge;
  const expectedDiag = meanEdge * Math.SQRT2;
  const diagErr =
    Math.max(
      Math.abs(dist(c0, c2) - expectedDiag),
      Math.abs(dist(c1, c3) - expectedDiag)
    ) / expectedDiag;
  // Plane-fit residual, normalized by the edge so `quality` stays scale-free.
  const planeErr = plane.rms / meanEdge;

  const relErr = Math.max(edgeErr, diagErr, planeErr);
  const quality = clamp01(1 - relErr);

  return { sizeM: interpolatingMedian(edges), quality };
}

// --- Running-median accumulator (the Note 3 size lifecycle) ------------

export interface QrSizeAccumulatorOptions {
  /** Minimum observation quality to ACCEPT a sample. Default 0.8. */
  qualityThreshold?: number;
  /** Accepted samples required before the estimate can be `estimated`. Default 8. */
  minSamples?: number;
  /**
   * Max confidence half-width (`spreadM`, m) allowed for the `estimated` status.
   * Default 0.01. `spreadM` is a robust standard-error (`1.4826·MAD/√N`) that
   * TIGHTENS as samples accumulate — not the raw max−min — so it converges
   * instead of being pinned by one early stray.
   */
  maxSpreadM?: number;
  /**
   * Optional cap on retained accepted sizes. **Default: unbounded** (lifelong
   * refinement — WS-B). The QR's physical size never changes, so keeping the
   * full session history lets the robust median tighten the longer the QR is
   * seen. Set a finite cap only if memory/perf demands a bounded window; the
   * estimate then becomes a sliding-window median again.
   */
  maxSamples?: number;
}

export interface QrSizeAccumulator {
  /**
   * Offer one observation (or `null` for a failed read). Low-quality / null
   * observations are ignored. Returns the updated {@link QrSizeEstimate}.
   */
  add(observation: QrSizeObservation | null): QrSizeEstimate;
  /** The current estimate without adding a sample. */
  current(): QrSizeEstimate;
  /** Drop all samples back to `unknown`. */
  reset(): void;
}

const UNKNOWN: QrSizeEstimate = {
  status: 'unknown',
  estimateM: null,
  sampleCount: 0,
  spreadM: 0,
};

export function createQrSizeAccumulator(
  options: QrSizeAccumulatorOptions = {}
): QrSizeAccumulator {
  const {
    qualityThreshold = 0.8,
    minSamples = 8,
    maxSpreadM = 0.01,
    maxSamples = Infinity,
  } = options;

  let sizes: number[] = [];
  // Latch: once the estimate has converged it STAYS `estimated` while refinement
  // continues (WS-B) — `estimated` is a confidence signal, not a terminal state,
  // so a later noisy frame can't flip it back to `measuring`.
  let everConverged = false;

  function estimate(): QrSizeEstimate {
    if (sizes.length === 0) return { ...UNKNOWN };
    // The point estimate is the median — robust to a minority of bad frames
    // (a late burst of outliers can't pull it while the history is majority-good).
    const med = interpolatingMedian(sizes);
    // Robust dispersion: MAD about the median → σ ≈ 1.4826·MAD. The reported
    // `spreadM` is the standard-error of that σ, so it shrinks ~1/√N as evidence
    // accumulates (the "converges to a very exact value the longer it is seen").
    const mad = interpolatingMedian(sizes.map((s) => Math.abs(s - med)));
    const sigma = 1.4826 * mad;
    const spreadM = sigma / Math.sqrt(sizes.length);
    if (sizes.length >= minSamples && spreadM <= maxSpreadM)
      everConverged = true;
    return {
      status: everConverged ? 'estimated' : 'measuring',
      estimateM: med,
      sampleCount: sizes.length,
      spreadM,
    };
  }

  return {
    add(observation: QrSizeObservation | null): QrSizeEstimate {
      if (
        observation &&
        Number.isFinite(observation.sizeM) &&
        observation.sizeM > 0 &&
        observation.quality >= qualityThreshold
      ) {
        sizes.push(observation.sizeM);
        if (sizes.length > maxSamples) sizes = sizes.slice(-maxSamples);
      }
      return estimate();
    },
    current: estimate,
    reset(): void {
      sizes = [];
      everConverged = false;
    },
  };
}
