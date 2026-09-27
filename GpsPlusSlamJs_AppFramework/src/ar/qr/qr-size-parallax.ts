/**
 * A QR code's printed size from parallax (QR size consensus plan
 * 2026-09-27-0350, §2 and §7, S1): the tracker knows every camera position in
 * metres, so views of the code from different spots fix its scale without
 * the depth sensor. See qr-size-parallax.ts.md.
 *
 * Each view is solved on its own at a nominal size. A wrong size keeps the
 * solved centre on the true viewing ray, scaled about the camera by the size
 * ratio, so the rays still meet at the true centre: the centre is their
 * least-squares point, and the size follows from the distance ratio. This
 * bearing triangulation is used rather than regressing the positions on the
 * cameras, which tracker jitter biases upward (plan §6 #2, §7).
 */

import { PlanarPnpSquare, solveLinear } from './planar-pnp.js';
import type { Vector3 } from 'gps-plus-slam-js';
import { solveQrPose, type Point2 } from './qr-pose.js';
import type { QrFusedEntry } from './qr-fused-window.js';
import { interpolatingMedian as median } from '../../utils/median.js';

export interface QrParallaxSizeOptions {
  /**
   * The least rms spread of the camera positions ACROSS the mean viewing
   * direction, m. Standing still, walking straight at the code or a small
   * step carry no scale and are refused. Default 0.08 (about an even 30 cm
   * step; plan §7).
   */
  minLateralBaselineM?: number;
  /** The least median code edge on screen, px (small codes bias it). Default 40. */
  minEdgePx?: number;
  /** The least number of usable views. Default 5. */
  minViews?: number;
  /** At most this many of the newest entries are used. Default 32. */
  maxEntries?: number;
}

export interface QrParallaxSize {
  /** The printed side length, m. */
  sizeM: number;
  /** The camera spread across the viewing direction, m (the gate's measure). */
  lateralBaselineM: number;
  /** Views used. */
  views: number;
  /** The time span of the window it used (entry timestamps). */
  oldestTimestamp: number;
  newestTimestamp: number;
}

const DEFAULTS = {
  minLateralBaselineM: 0.08,
  minEdgePx: 40,
  minViews: 5,
  maxEntries: 32,
};

/** The size the single-view solves run at; any positive value works (§2). */
const NOMINAL_SIZE_M = 0.16;

const solver = new PlanarPnpSquare();
/**
 * Each entry's own solve at the nominal size, cached on its CORNERS array:
 * `selectQrFusedEntries` builds new entry objects after every detection but
 * keeps the corners by reference (plan §12 #6).
 */
const solvedCentre = new WeakMap<readonly Point2[], Vector3 | null>();

function centreOf(entry: QrFusedEntry): Vector3 | null {
  if (solvedCentre.has(entry.corners)) return solvedCentre.get(entry.corners)!;
  const solution = solveQrPose({
    imagePoints: entry.corners,
    sizeM: NOMINAL_SIZE_M,
    intrinsics: entry.intrinsics,
    cameraPose: entry.cameraPose,
    solver,
  });
  const centre = solution ? solution.qrPoseWorld.position : null;
  solvedCentre.set(entry.corners, centre);
  return centre;
}

const sub = (a: Vector3, b: Vector3): Vector3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: Vector3, b: Vector3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vector3): number => Math.sqrt(dot(a, a));

function meanEdgePx(c: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum / 4;
}

/** The newest epoch's newest entries, oldest first. */
function recentOfNewestEpoch(
  entries: readonly QrFusedEntry[],
  maxEntries: number
): QrFusedEntry[] {
  const newest = entries[entries.length - 1];
  if (!newest) return [];
  const epoch = newest.frameEpoch ?? 0;
  const out: QrFusedEntry[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < maxEntries; i--) {
    const e = entries[i]!;
    if ((e.frameEpoch ?? 0) === epoch) out.push(e);
  }
  return out.reverse();
}

/** The least-squares point of the rays `cams[i] + t * dirs[i]` (unit dirs). */
function raysPoint(cams: Vector3[], dirs: Vector3[]): Vector3 | null {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < cams.length; i++) {
    const d = dirs[i]!;
    const c = cams[i]!;
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const m = (r === k ? 1 : 0) - d[r]! * d[k]!;
        A[r * 3 + k]! += m;
        b[r]! += m * c[k]!;
      }
    }
  }
  const p = solveLinear(A, b);
  return p ? [p[0]!, p[1]!, p[2]!] : null;
}

/** The rms of the camera positions across the mean viewing direction. */
function lateralBaselineM(cams: Vector3[], dirs: Vector3[]): number {
  const mean = (arr: Vector3[]): Vector3 => {
    const s = [0, 0, 0];
    for (const a of arr)
      for (let j = 0; j < 3; j++) s[j]! += a[j]! / arr.length;
    return [s[0]!, s[1]!, s[2]!];
  };
  const md = mean(dirs);
  const len = norm(md);
  const view: Vector3 = [md[0] / len, md[1] / len, md[2] / len];
  const mc = mean(cams);
  let sum = 0;
  for (const c of cams) {
    const d = sub(c, mc);
    const along = dot(d, view);
    sum += dot(d, d) - along * along;
  }
  return Math.sqrt(sum / cams.length);
}

/** The usable views: each camera, its ray direction and its nominal distance. */
function usableViews(entries: QrFusedEntry[]) {
  const cams: Vector3[] = [];
  const dirs: Vector3[] = [];
  const dists: number[] = [];
  const edges: number[] = [];
  for (const e of entries) {
    const centre = centreOf(e);
    if (!centre) continue;
    const cam = e.cameraPose.position;
    const ray = sub(centre, cam);
    const d = norm(ray);
    if (!(d > 0) || !Number.isFinite(d)) continue;
    cams.push(cam);
    dirs.push([ray[0] / d, ray[1] / d, ray[2] / d]);
    dists.push(d);
    edges.push(meanEdgePx(e.corners));
  }
  return { cams, dirs, dists, edges };
}

/**
 * The code's printed size from the parallax of its recent views, or `null`
 * when they carry no scale (too few, too close together across the viewing
 * direction, the code too small on screen, or the rays do not meet in front
 * of the cameras). Only the newest entry's frame epoch is used.
 */
export function estimateQrSizeFromParallax(
  entries: readonly QrFusedEntry[],
  options: QrParallaxSizeOptions = {}
): QrParallaxSize | null {
  const o = { ...DEFAULTS, ...options };
  const recent = recentOfNewestEpoch(entries, o.maxEntries);
  const { cams, dirs, dists, edges } = usableViews(recent);
  if (cams.length < o.minViews) return null;
  if (median(edges) < o.minEdgePx) return null;
  const baseline = lateralBaselineM(cams, dirs);
  if (!(baseline >= o.minLateralBaselineM)) return null;
  const p = raysPoint(cams, dirs);
  if (!p) return null;
  const ratios: number[] = [];
  for (let i = 0; i < cams.length; i++) {
    const toCentre = sub(p, cams[i]!);
    // The centre must lie ahead of every camera, along its own ray.
    if (!(dot(toCentre, dirs[i]!) > 0)) return null;
    ratios.push((NOMINAL_SIZE_M * norm(toCentre)) / dists[i]!);
  }
  const sizeM = median(ratios);
  if (!(sizeM > 0) || !Number.isFinite(sizeM)) return null;
  return {
    sizeM,
    lateralBaselineM: baseline,
    views: cams.length,
    oldestTimestamp: recent[0]!.timestamp,
    newestTimestamp: recent[recent.length - 1]!.timestamp,
  };
}
