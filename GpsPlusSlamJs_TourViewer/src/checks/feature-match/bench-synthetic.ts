/**
 * The benchmark's synthetic image pair: a procedural texture and the same
 * texture seen through a known warp, so a run without a camera is
 * repeatable and has a ground truth.
 *
 * @see bench-synthetic.ts.md
 */
import { mulberry32 } from "gps-plus-slam-app-framework/utils/mulberry32";

import { makeFrame, type Frame } from "./bench-image";

/**
 * A rotation and scale about the frame centre, then a shift. The shift is
 * a fraction of the frame width, so the warp means the same at every size.
 */
export interface Warp {
  readonly angleRad: number;
  readonly scale: number;
  readonly shiftX: number;
  readonly shiftY: number;
}

/** A step to the side and a slight turn: 8 degrees, 0.9 scale. */
export const DEFAULT_WARP: Warp = {
  angleRad: (8 * Math.PI) / 180,
  scale: 0.9,
  shiftX: 0.04,
  shiftY: -0.02,
};

/** Where a point of A (pixel coordinates of a w x h frame) lands in B. */
export function warpPoint(
  warp: Warp,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const c = Math.cos(warp.angleRad) * warp.scale;
  const s = Math.sin(warp.angleRad) * warp.scale;
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + c * dx - s * dy + warp.shiftX * w,
    cy + s * dx + c * dy + warp.shiftY * w,
  ];
}

/** The point of A that lands at (x, y) of B. */
export function unwarpPoint(
  warp: Warp,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const k = 1 / warp.scale;
  const c = Math.cos(warp.angleRad) * k;
  const s = Math.sin(warp.angleRad) * k;
  const dx = x - cx - warp.shiftX * w;
  const dy = y - cy - warp.shiftY * w;
  return [cx + c * dx + s * dy, cy - s * dx + c * dy];
}

/**
 * A corner-rich grey texture: three octaves of value noise, then random
 * discs, rectangles and lines in random greys. Same seed, same pixels.
 */
export function syntheticTexture(
  width: number,
  height: number,
  seed: number,
): Frame {
  const rand = mulberry32(seed);
  const g = new Float32Array(width * height);
  addValueNoise(g, width, height, rand);
  for (let i = 0; i < 60; i++) {
    drawShape(g, width, height, rand);
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < g.length; i++) {
    const v = Math.round(Math.min(255, Math.max(0, g[i]!)));
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return makeFrame(width, height, rgba);
}

function addValueNoise(
  g: Float32Array,
  width: number,
  height: number,
  rand: () => number,
): void {
  for (const [cell, amp] of [
    [48, 110],
    [16, 60],
    [6, 40],
  ] as const) {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const grid = Float32Array.from({ length: gw * gh }, () => rand());
    for (let y = 0; y < height; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const a = grid[y0 * gw + x0]!;
        const b = grid[y0 * gw + x0 + 1]!;
        const c = grid[(y0 + 1) * gw + x0]!;
        const d = grid[(y0 + 1) * gw + x0 + 1]!;
        const v = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
        g[y * width + x] = g[y * width + x]! + v * amp;
      }
    }
  }
}

function drawShape(
  g: Float32Array,
  width: number,
  height: number,
  rand: () => number,
): void {
  const kind = Math.floor(rand() * 3);
  const value = rand() * 255;
  const cx = rand() * width;
  const cy = rand() * height;
  const r = (0.01 + rand() * 0.06) * Math.max(width, height);
  if (kind === 2) {
    drawLine(g, width, height, cx, cy, rand() * Math.PI, r * 2, value);
    return;
  }
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r * (kind === 1 ? 0.6 : 1)));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const inside = kind === 1 || (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      if (inside) {
        g[y * width + x] = value;
      }
    }
  }
}

function drawLine(
  g: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  value: number,
): void {
  const steps = Math.ceil(length);
  for (let i = -steps; i <= steps; i++) {
    const t = i / 2;
    for (const off of [-1, 0, 1]) {
      const x = Math.round(cx + Math.cos(angle) * t - Math.sin(angle) * off);
      const y = Math.round(cy + Math.sin(angle) * t + Math.cos(angle) * off);
      if (x >= 0 && y >= 0 && x < width && y < height) {
        g[y * width + x] = value;
      }
    }
  }
}

/** B drawn as A seen through `warp`, bilinear; outside A is mid grey. */
function warpFrame(a: Frame, warp: Warp): Frame {
  const { width: w, height: h, rgba: s } = a;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = unwarpPoint(warp, x, y, w, h);
      const v = sampleGrey(s, w, h, sx, sy);
      const o = (y * w + x) * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return makeFrame(w, h, out);
}

function sampleGrey(
  s: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) {
    return 128;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = s[(y0 * w + x0) * 4]!;
  const b = s[(y0 * w + x1) * 4]!;
  const c = s[(y1 * w + x0) * 4]!;
  const d = s[(y1 * w + x1) * 4]!;
  const top = a + (b - a) * tx;
  return Math.round(top + (c + (d - c) * tx - top) * ty);
}

/** The synthetic pair: A, B = A through `DEFAULT_WARP`, and the warp. */
export function syntheticPair(
  width = 640,
  height = 480,
  seed = 1,
): { a: Frame; b: Frame; warp: Warp } {
  const a = syntheticTexture(width, height, seed);
  return { a, b: warpFrame(a, DEFAULT_WARP), warp: DEFAULT_WARP };
}

/** Keypoint positions of one frame, pixel coordinates. */
export interface Points {
  readonly x: Float32Array;
  readonly y: Float32Array;
}

/**
 * How many matched pairs (flat `[ia, ib, ...]`) put B's point within
 * `tolPx` of where the warp sends A's point, in a w x h frame.
 */
export function countCorrect(
  pairs: Int32Array,
  a: Points,
  b: Points,
  warp: Warp,
  w: number,
  h: number,
  tolPx: number,
): number {
  let n = 0;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const ia = pairs[i]!;
    const ib = pairs[i + 1]!;
    const [x, y] = warpPoint(warp, a.x[ia]!, a.y[ia]!, w, h);
    if (Math.hypot(x - b.x[ib]!, y - b.y[ib]!) <= tolPx) {
      n++;
    }
  }
  return n;
}
