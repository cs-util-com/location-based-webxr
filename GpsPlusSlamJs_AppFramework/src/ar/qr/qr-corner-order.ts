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

/**
 * Where a detection's corner order came from (near-frontal pose plan §39
 * F0a): the finder patterns (`confident`), the canonicaliser's memory of the
 * last confident order, or the detector's own (image) order.
 */
export type CornerOrderSource = 'finder' | 'memory' | 'native';

export interface CornerOrderResult {
  /** The corners, rotated into symbol order when `confident`. */
  corners: Quad;
  /** Exactly one corner lacked a finder pattern, so the order is known. */
  confident: boolean;
  source: CornerOrderSource;
  /**
   * On a finder frame with a live chain (plan §42 S4): whether the chain
   * would have chosen the same order (`agree` / `disagree`) or would have
   * ended (`reject`) - the chain's error rate, measured on the phone.
   */
  audit?: 'agree' | 'disagree' | 'reject';
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

/** Run lengths from the first dark sample on, and where that sample is. */
interface DarkFirstRuns {
  lead: number;
  runs: number[];
}

function darkFirstRuns(
  profile: readonly number[],
  threshold: number
): DarkFirstRuns | null {
  let i = 0;
  while (i < profile.length && profile[i]! >= threshold) i++;
  if (i > profile.length * MAX_LEADING_LIGHT) return null;
  const lead = i;
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
  return { lead, runs };
}

function within(
  value: number,
  expected: number,
  [lo, hi]: readonly [number, number]
): boolean {
  return value >= expected * lo && value <= expected * hi;
}

/** Five consecutive runs in a finder's 1:1:3:1:1 proportion. */
function isFinderRatio(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number
): boolean {
  const unit = (a + b + c + d + e) / 7;
  return (
    within(a, unit, RING_TOLERANCE) &&
    within(b, unit, RING_TOLERANCE) &&
    within(c, unit * 3, [CORE_TOLERANCE[0] / 3, CORE_TOLERANCE[1] / 3]) &&
    within(d, unit, RING_TOLERANCE) &&
    within(e, unit, RING_TOLERANCE)
  );
}

/** The first five runs look like a finder's diagonal: 1:1:3:1:1. */
function isFinderProfile(fr: DarkFirstRuns | null): fr is DarkFirstRuns {
  if (!fr || fr.runs.length < 6) return false; // five finder runs + what follows
  const [a, b, c, d, e] = fr.runs as [number, number, number, number, number];
  return isFinderRatio(a, b, c, d, e);
}

/**
 * Cross-check a finder candidate the way zxing does: scan through the centre
 * of its core along both symbol axes; a real finder reads 1:1:3:1:1 centred
 * there in every direction. The alignment pattern plus data modules near BR
 * can mimic a finder along the DIAGONAL (milestone review 2026-09-24,
 * finding 1), but not across it.
 */
function crossChecks(
  image: RgbaImage,
  map: (u: number, v: number) => Point2,
  k: number,
  fr: DarkFirstRuns,
  diagonalSamples: number,
  threshold: number
): boolean {
  const [cu, cv] = UNIT_CORNERS[k]!;
  const [a, b, c, d, e] = fr.runs as [number, number, number, number, number];
  // Profile sample i sits at fraction i / (n - 1) of the half-diagonal, which
  // moves 0.5 * PROFILE_EXTENT along each symbol axis.
  const perSample = (0.5 * PROFILE_EXTENT) / (diagonalSamples - 1);
  const coreMid = fr.lead + a + b + c / 2;
  const centreU = cu + Math.sign(0.5 - cu) * coreMid * perSample;
  const centreV = cv + Math.sign(0.5 - cv) * coreMid * perSample;
  const module = ((a + b + c + d + e) * perSample) / 7;
  return (
    crossScanIsFinder(
      image,
      map,
      [centreU, centreV],
      [1, 0],
      module,
      threshold
    ) &&
    crossScanIsFinder(image, map, [centreU, centreV], [0, 1], module, threshold)
  );
}

/** One cross-scan: 1:1:3:1:1 with the core run containing the centre. */
function crossScanIsFinder(
  image: RgbaImage,
  map: (u: number, v: number) => Point2,
  centre: readonly [number, number],
  axis: readonly [number, number],
  module: number,
  threshold: number
): boolean {
  const half = 6 * module;
  const from = map(centre[0] - axis[0] * half, centre[1] - axis[1] * half);
  const to = map(centre[0] + axis[0] * half, centre[1] + axis[1] * half);
  const n =
    Math.max(40, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 3)) | 1;
  const runs: { dark: boolean; start: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = -half + (2 * half * i) / (n - 1);
    const pt = map(centre[0] + axis[0] * t, centre[1] + axis[1] * t);
    const l = luminanceAt(image, pt.x, pt.y);
    if (!Number.isFinite(l)) return false;
    const dark = l < threshold;
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.len++;
    else runs.push({ dark, start: i, len: 1 });
  }
  const mid = (n - 1) / 2;
  const at = runs.findIndex((r) => mid >= r.start && mid < r.start + r.len);
  if (at < 2 || at + 2 >= runs.length || !runs[at]!.dark) return false;
  const [l2, l1, core, r1, r2] = runs.slice(at - 2, at + 3).map((r) => r.len);
  return isFinderRatio(l2!, l1!, core!, r1!, r2!);
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
  const unsure: CornerOrderResult = {
    corners: input,
    confident: false,
    source: 'native',
  };
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
  const finder = profiles.map((p, k) => {
    const fr = darkFirstRuns(p, threshold);
    return (
      isFinderProfile(fr) && crossChecks(image, map, k, fr, p.length, threshold)
    );
  });
  const missing = finder.flatMap((f, k) => (f ? [] : [k]));
  if (missing.length !== 1) return unsure;
  // Rotate so the corner without a finder (BR) lands at index 2.
  return {
    corners: rotated(input, (missing[0]! + 2) % 4),
    confident: true,
    source: 'finder',
  };
}

export interface CornerOrderCanonicalizerOptions {
  now?: () => number;
  /**
   * The longest gap between two detections of a code that the chained
   * order survives, ms (plan §42 S1: a max GAP, not a lifetime from the
   * last finder frame). Default 500.
   */
  memoryMs?: number;
  /**
   * The largest roll between two detections the chain accepts, deg (plan
   * §42 S2). Beyond it a roll cannot be told from a relabel, and the chain
   * ends. Default 30.
   */
  maxRollDeg?: number;
  /**
   * The largest jump of the code's centre between two detections, in the
   * code's edge lengths (a second print of the same payload); beyond it the
   * chain ends. Default 1.5.
   */
  maxJumpEdges?: number;
  /** The single-frame orderer; injectable so tests and sweeps need no images. */
  orderFrame?: (
    image: RgbaImage,
    corners: readonly Point2[]
  ) => CornerOrderResult;
}

/** The chain's per-code state: the last known order and where it was seen. */
interface ChainEntry {
  corners: Quad;
  at: number;
  width: number;
  height: number;
}

function centroid(q: readonly Point2[]): Point2 {
  return {
    x: (q[0]!.x + q[1]!.x + q[2]!.x + q[3]!.x) / 4,
    y: (q[0]!.y + q[1]!.y + q[2]!.y + q[3]!.y) / 4,
  };
}

function meanEdge(q: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum / 4;
}

/**
 * The roll (deg, in (-180, 180]) that best maps the centred quad `from`
 * onto the centred quad `to`, corner i to corner i (a least-squares fit of
 * the rotation angle). It ignores translation, so a pan never reads as a
 * roll.
 */
function quadRollDeg(from: readonly Point2[], to: readonly Point2[]): number {
  const a = centroid(from);
  const b = centroid(to);
  let cross = 0;
  let dot = 0;
  for (let i = 0; i < 4; i++) {
    const u = { x: from[i]!.x - a.x, y: from[i]!.y - a.y };
    const v = { x: to[i]!.x - b.x, y: to[i]!.y - b.y };
    cross += u.x * v.y - u.y * v.x;
    dot += u.x * v.x + u.y * v.y;
  }
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/**
 * What the chain would make of `corners` given the last known order: the
 * cyclic shift whose roll from it is smallest - if that roll is within
 * `maxRollDeg` and the centre did not jump - else null (the chain ends).
 */
function chainPick(
  last: ChainEntry,
  corners: Quad,
  maxRollDeg: number,
  maxJumpEdges: number
): Quad | null {
  const edge = meanEdge(last.corners);
  const from = centroid(last.corners);
  const to = centroid(corners);
  if (!(Math.hypot(to.x - from.x, to.y - from.y) <= maxJumpEdges * edge))
    return null;
  let best: Quad | null = null;
  let bestRoll = Infinity;
  for (let k = 0; k < 4; k++) {
    const candidate = rotated(corners, k);
    const roll = Math.abs(quadRollDeg(last.corners, candidate));
    if (roll < bestRoll) {
      bestRoll = roll;
      best = candidate;
    }
  }
  return bestRoll <= maxRollDeg ? best : null;
}

function sameOrder(a: readonly Point2[], b: readonly Point2[]): boolean {
  return a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y);
}

/**
 * {@link canonicalizeCorners} plus a per-code CHAIN (near-frontal pose plan
 * §42): an unsure frame takes the cyclic shift of its corners with the
 * smallest roll from the code's last known order (a finder frame or an
 * earlier chained one) and becomes the new memory - while the previous
 * detection is under `memoryMs` old, on the same capture size, the roll is
 * within `maxRollDeg` and the centre did not jump. Otherwise the chain ends
 * and the frame keeps the detector's order. A finder frame always
 * re-anchors the chain, and reports whether the live chain would have
 * agreed (`audit`).
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
  const maxRollDeg = options.maxRollDeg ?? 30;
  const maxJumpEdges = options.maxJumpEdges ?? 1.5;
  const orderFrame = options.orderFrame ?? canonicalizeCorners;
  const memory = new Map<string, ChainEntry>();

  /** The live chain of `text` for this frame, pruning stale entries. */
  function liveChain(
    text: string,
    image: RgbaImage,
    t: number
  ): ChainEntry | null {
    for (const [key, entry] of memory) {
      if (t - entry.at > memoryMs) memory.delete(key);
    }
    const last = memory.get(text);
    if (!last) return null;
    return last.width === image.width && last.height === image.height
      ? last
      : null;
  }

  return {
    canonicalize(text, image, corners) {
      const result = orderFrame(image, corners);
      const t = now();
      const last = corners.length === 4 ? liveChain(text, image, t) : null;
      const remember = (q: Quad) =>
        memory.set(text, {
          corners: q,
          at: t,
          width: image.width,
          height: image.height,
        });
      if (result.confident) {
        const audit = last
          ? auditOf(
              chainPick(last, [...corners] as Quad, maxRollDeg, maxJumpEdges),
              result.corners
            )
          : undefined;
        remember(result.corners);
        return audit ? { ...result, audit } : result;
      }
      const pick = last
        ? chainPick(last, result.corners, maxRollDeg, maxJumpEdges)
        : null;
      if (!pick) {
        memory.delete(text);
        return result;
      }
      remember(pick);
      return { corners: pick, confident: false, source: 'memory' };
    },
  };
}

function auditOf(
  pick: Quad | null,
  finder: readonly Point2[]
): CornerOrderResult['audit'] {
  if (!pick) return 'reject';
  return sameOrder(pick, finder) ? 'agree' : 'disagree';
}
