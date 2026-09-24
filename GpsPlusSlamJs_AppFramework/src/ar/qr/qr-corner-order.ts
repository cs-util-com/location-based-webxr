/**
 * Canonical QR corner order (TL, TR, BR, BL of the SYMBOL) from the image,
 * whatever order the detector reported (QR near-frontal pose plan
 * 2026-09-23-2314, M1c; "Cause A" of 2026-06-20-0030). See
 * qr-corner-order.ts.md.
 *
 * A QR symbol has a finder pattern at three of its corners (TL, TR, BL); the
 * corner without one is BR. Each corner's diagonal is sampled inward and
 * tested for the finder's dark-light-dark-light-dark run profile (1:1:3:1:1).
 * Pure; no DOM.
 */

import type { Point2 } from './qr-pose.js';
import type { RgbaImage } from './qr-frontend.js';

type Quad = [Point2, Point2, Point2, Point2];

export interface CornerOrderResult {
  /** The corners, rotated into symbol order when `confident`. */
  corners: Quad;
  /** Exactly one corner lacked a finder pattern, so the order is known. */
  confident: boolean;
}

/** How far along each half-diagonal to sample (0 = corner, 1 = centre). */
const PROFILE_EXTENT = 0.8;
/** A run within these factors of its expected length still counts. */
const RING_TOLERANCE: readonly [number, number] = [0.5, 1.6];
const CORE_TOLERANCE: readonly [number, number] = [2, 4.2];
/** Leading light samples tolerated before the first dark run (corner offset). */
const MAX_LEADING_LIGHT = 0.12;

const UNIT_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Closed-form projective map of the unit square onto `q` (0,0)->q0 ... (0,1)->q3. */
function squareToQuad(q: Quad): (u: number, v: number) => Point2 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** Bilinear luminance at a continuous pixel position; NaN outside the image. */
function luminanceAt(image: RgbaImage, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= image.width || y0 + 1 >= image.height) {
    return Number.NaN;
  }
  const tx = fx - x0;
  const ty = fy - y0;
  const lum = (i: number, j: number): number => {
    const o = (j * image.width + i) * 4;
    const d = image.data;
    return 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!;
  };
  return (
    (1 - ty) * ((1 - tx) * lum(x0, y0) + tx * lum(x0 + 1, y0)) +
    ty * ((1 - tx) * lum(x0, y0 + 1) + tx * lum(x0 + 1, y0 + 1))
  );
}

/** Luminance along corner `k`'s half-diagonal, corner first; null if it leaves the image. */
function diagonalProfile(
  image: RgbaImage,
  map: (u: number, v: number) => Point2,
  k: number
): number[] | null {
  const [cu, cv] = UNIT_CORNERS[k]!;
  const start = map(cu, cv);
  const endU = cu + (0.5 - cu) * PROFILE_EXTENT;
  const endV = cv + (0.5 - cv) * PROFILE_EXTENT;
  const far = map(endU, endV);
  const lengthPx = Math.hypot(far.x - start.x, far.y - start.y);
  const n = Math.max(40, Math.ceil(lengthPx * 3));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const p = map(cu + (endU - cu) * s, cv + (endV - cv) * s);
    const l = luminanceAt(image, p.x, p.y);
    if (!Number.isFinite(l)) return null;
    out.push(l);
  }
  return out;
}

/** Run lengths of the dark/light sequence, starting at the first dark sample. */
function darkFirstRuns(
  profile: readonly number[],
  threshold: number
): number[] | null {
  let i = 0;
  while (i < profile.length && profile[i]! >= threshold) i++;
  if (i > profile.length * MAX_LEADING_LIGHT) return null;
  const runs: number[] = [];
  let dark = true;
  let len = 0;
  for (; i < profile.length; i++) {
    const isDark = profile[i]! < threshold;
    if (isDark === dark) {
      len++;
    } else {
      runs.push(len);
      dark = isDark;
      len = 1;
    }
  }
  runs.push(len);
  return runs;
}

function within(
  value: number,
  expected: number,
  [lo, hi]: readonly [number, number]
): boolean {
  return value >= expected * lo && value <= expected * hi;
}

/** The first five runs look like a finder's diagonal: 1:1:3:1:1. */
function isFinderProfile(runs: readonly number[] | null): boolean {
  if (!runs || runs.length < 6) return false; // five finder runs + what follows
  const [a, b, c, d, e] = runs as [number, number, number, number, number];
  const unit = (a + b + c + d + e) / 7;
  return (
    within(a, unit, RING_TOLERANCE) &&
    within(b, unit, RING_TOLERANCE) &&
    within(c, unit * 3, [CORE_TOLERANCE[0] / 3, CORE_TOLERANCE[1] / 3]) &&
    within(d, unit, RING_TOLERANCE) &&
    within(e, unit, RING_TOLERANCE)
  );
}

/** Midpoint of the 10th and 90th percentiles of all samples. */
function darkLightThreshold(profiles: readonly (readonly number[])[]): number {
  const all = profiles.flat().sort((x, y) => x - y);
  const at = (p: number): number =>
    all[Math.min(all.length - 1, Math.floor(p * all.length))]!;
  return (at(0.1) + at(0.9)) / 2;
}

function rotated(q: Quad, k: number): Quad {
  return [q[k % 4]!, q[(k + 1) % 4]!, q[(k + 2) % 4]!, q[(k + 3) % 4]!];
}

/**
 * Put the corners into symbol order (TL, TR, BR, BL) using the finder
 * patterns. Only a cyclic rotation is ever applied; unless exactly one
 * corner lacks a finder, the input comes back unchanged with
 * `confident: false`.
 */
export function canonicalizeCorners(
  image: RgbaImage,
  corners: readonly Point2[]
): CornerOrderResult {
  const input = [...corners] as Quad;
  const unsure = { corners: input, confident: false };
  if (corners.length !== 4 || image.width < 2 || image.height < 2)
    return unsure;
  const map = squareToQuad(input);
  const profiles: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const p = diagonalProfile(image, map, k);
    if (!p) return unsure;
    profiles.push(p);
  }
  const threshold = darkLightThreshold(profiles);
  const finder = profiles.map((p) =>
    isFinderProfile(darkFirstRuns(p, threshold))
  );
  const missing = finder.flatMap((f, k) => (f ? [] : [k]));
  if (missing.length !== 1) return unsure;
  // Rotate so the corner without a finder (BR) lands at index 2.
  return { corners: rotated(input, (missing[0]! + 2) % 4), confident: true };
}

export interface CornerOrderCanonicalizerOptions {
  now?: () => number;
  /** How long a confident order stays usable for unsure frames, ms. Default 500. */
  memoryMs?: number;
}

/**
 * {@link canonicalizeCorners} plus a short per-code memory: an unsure frame
 * takes the cyclic shift closest, in image space, to the last confident
 * order of the same code, while that is younger than `memoryMs`; otherwise
 * it keeps the detector's order.
 */
export function createCornerOrderCanonicalizer(
  options: CornerOrderCanonicalizerOptions = {}
): {
  canonicalize(
    text: string,
    image: RgbaImage,
    corners: readonly Point2[]
  ): CornerOrderResult;
} {
  const now = options.now ?? (() => performance.now());
  const memoryMs = options.memoryMs ?? 500;
  const memory = new Map<string, { corners: Quad; at: number }>();
  return {
    canonicalize(text, image, corners) {
      const result = canonicalizeCorners(image, corners);
      const t = now();
      if (result.confident) {
        memory.set(text, { corners: result.corners, at: t });
        return result;
      }
      const last = memory.get(text);
      if (!last || t - last.at > memoryMs || corners.length !== 4)
        return result;
      let best = result.corners;
      let bestCost = Infinity;
      for (let k = 0; k < 4; k++) {
        const candidate = rotated(result.corners, k);
        const cost = candidate.reduce(
          (sum, p, i) =>
            sum +
            Math.hypot(p.x - last.corners[i]!.x, p.y - last.corners[i]!.y),
          0
        );
        if (cost < bestCost) {
          bestCost = cost;
          best = candidate;
        }
      }
      return { corners: best, confident: false };
    },
  };
}
