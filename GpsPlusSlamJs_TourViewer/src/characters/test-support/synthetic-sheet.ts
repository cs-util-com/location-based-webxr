/**
 * Test-only: draws a synthetic four-pose character sheet as an image AI
 * would (four outlined figures in a row, not on quarters, feet on one line,
 * white eyes inside the outline), optionally with a soft grey ground shadow
 * under each pose and seeded per-channel noise, and returns the truth the
 * cut is checked against: the figure mask, each pose's lowest row, the eye
 * pixels and the shadow pixels.
 */

import type { RgbaImage } from "../rgba-image.js";

type Rgb = readonly [number, number, number];

export interface SheetSpec {
  readonly width: number;
  readonly height: number;
  /** The figure's height as a share of the picture's height. */
  readonly figureShare?: number;
  readonly background?: Rgb;
  /** Real transparency (background alpha 0, figures at 253). */
  readonly transparent?: boolean;
  readonly fill?: Rgb;
  /** The outline's width in pixels; 0 draws none. */
  readonly outline?: number;
  readonly outlineColour?: Rgb;
  /** A colourless shadow under each pose, its core this grey (0..255);
   *  absent for none. */
  readonly shadowCore?: number;
  /** Uniform noise of at most this, per channel, independently. */
  readonly noise?: number;
  readonly seed?: number;
  /** Shifts each talking pose's body sideways by this many pixels (a body
   *  that jumps while talking). */
  readonly talkJitter?: number;
}

export interface SyntheticSheet {
  readonly image: RgbaImage;
  /** 1 where a figure is (outline included). */
  readonly truth: Uint8Array;
  /** Each pose's lowest figure row, left to right. */
  readonly feet: readonly number[];
  /** Each pose's centre column. */
  readonly centres: readonly number[];
  readonly eyes: readonly number[];
  /** 1 where the shadow is visibly darker than the background. */
  readonly shadow: Uint8Array;
}

/** mulberry32: a small seeded generator, so a failing case reproduces. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Shape = (x: number, y: number, grow: number) => boolean;

const ellipse =
  (cx: number, cy: number, rx: number, ry: number): Shape =>
  (x, y, g) =>
    ((x - cx) / (rx + g)) ** 2 + ((y - cy) / (ry + g)) ** 2 <= 1;

const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y, g) =>
    x >= x0 - g && x <= x1 + g && y >= y0 - g && y <= y1 + g;

interface Pose {
  readonly body: Shape[];
  readonly eyes: Shape[];
  readonly mouth: Shape;
}

/** One pose: head, body, legs and feet; pose 3 also raises an arm to the
 *  right; the mouth opens in poses 1 and 2. The lowest row is `bottom`. */
function pose(
  index: number,
  cx: number,
  bottom: number,
  H: number,
  jitter: number,
): Pose {
  const top = bottom - H + 1;
  const bx = index === 1 || index === 2 ? cx + jitter : cx;
  const body: Shape[] = [
    ellipse(cx, top + 0.16 * H, 0.15 * H, 0.15 * H),
    ellipse(bx, top + 0.5 * H, 0.17 * H, 0.25 * H),
    rect(cx - 0.1 * H, top + 0.65 * H, cx - 0.03 * H, bottom - 0.04 * H),
    rect(cx + 0.03 * H, top + 0.65 * H, cx + 0.1 * H, bottom - 0.04 * H),
    rect(cx - 0.13 * H, bottom - 0.05 * H, cx - 0.02 * H, bottom),
    rect(cx + 0.02 * H, bottom - 0.05 * H, cx + 0.13 * H, bottom),
  ];
  if (index === 3) {
    body.push(rect(cx + 0.1 * H, top + 0.3 * H, cx + 0.3 * H, top + 0.42 * H));
  }
  const open = index === 1 ? 0.5 : index === 2 ? 1 : 0.15;
  return {
    body,
    eyes: [
      ellipse(cx - 0.06 * H, top + 0.13 * H, 0.03 * H, 0.03 * H),
      ellipse(cx + 0.06 * H, top + 0.13 * H, 0.03 * H, 0.03 * H),
    ],
    mouth: ellipse(cx, top + 0.23 * H, 0.05 * H, Math.max(1, open * 0.04 * H)),
  };
}

function setPixel(d: Uint8ClampedArray, i: number, c: Rgb, a = 255): void {
  d[i * 4] = c[0];
  d[i * 4 + 1] = c[1];
  d[i * 4 + 2] = c[2];
  d[i * 4 + 3] = a;
}

function paintShadow(
  d: Uint8ClampedArray,
  shadow: Uint8Array,
  w: number,
  h: number,
  centres: readonly number[],
  bottom: number,
  H: number,
  bg: number,
  core: number,
): void {
  const rx = 0.25 * H;
  const ry = 0.04 * H;
  for (const cx of centres) {
    for (let y = Math.floor(bottom - ry); y <= Math.ceil(bottom + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (x < 0 || x >= w || y < 0 || y >= h) {
          continue;
        }
        const r2 = ((x - cx) / rx) ** 2 + ((y - bottom) / ry) ** 2;
        if (r2 >= 1) {
          continue;
        }
        const v = Math.round(bg - (bg - core) * (1 - r2));
        const i = y * w + x;
        setPixel(d, i, [v, v, v]);
        if (bg - v >= 3) {
          shadow[i] = 1;
        }
      }
    }
  }
}

/** Draws the sheet. Poses sit off their quarters on purpose (an AI follows
 *  the layout only roughly). */
export function syntheticSheet(spec: SheetSpec): SyntheticSheet {
  const { width: w, height: h } = spec;
  const H = Math.round((spec.figureShare ?? 0.55) * h);
  const bgc = spec.background ?? [254, 254, 254];
  const fill = spec.fill ?? [214, 122, 48];
  const outline = spec.outline ?? Math.max(2, Math.round(H / 150));
  const ink = spec.outlineColour ?? [34, 26, 20];
  const bottom = Math.round(h * 0.86);
  const offsets = [0.035, 0.0, -0.02, -0.04];
  const centres = offsets.map((o, i) => Math.round(((i + 0.5) / 4 + o) * w));
  const d = new Uint8ClampedArray(w * h * 4);
  const truth = new Uint8Array(w * h);
  const shadow = new Uint8Array(w * h);
  const eyes: number[] = [];
  for (let i = 0; i < w * h; i++) {
    setPixel(d, i, bgc, spec.transparent === true ? 0 : 255);
  }
  if (spec.shadowCore !== undefined) {
    paintShadow(d, shadow, w, h, centres, bottom, H, bgc[1], spec.shadowCore);
  }
  const alpha = spec.transparent === true ? 253 : 255;
  centres.forEach((cx, k) => {
    const p = pose(k, cx, bottom, H, spec.talkJitter ?? 0);
    // The widest part (pose 4's raised arm) reaches 0.3 * H from the centre;
    // the window adds the outline, or the arm's tip would be left open.
    const x0 = Math.max(0, Math.floor(cx - 0.3 * H) - outline - 1);
    const x1 = Math.min(w - 1, Math.ceil(cx + 0.3 * H) + outline + 1);
    for (let y = bottom - H - outline - 1; y <= bottom + outline; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!p.body.some((s) => s(x, y, outline))) {
          continue;
        }
        truth[i] = 1;
        shadow[i] = 0;
        const inner = p.body.some((s) => s(x, y, 0));
        const eye = inner && p.eyes.some((s) => s(x, y, 0));
        const colour: Rgb = !inner
          ? ink
          : eye
            ? [255, 255, 255]
            : p.mouth(x, y, 0)
              ? [70, 22, 22]
              : fill;
        setPixel(d, i, colour, alpha);
        if (eye) {
          eyes.push(i);
        }
      }
    }
  });
  addNoise(d, spec.noise ?? 0, spec.seed ?? 1);
  return {
    image: { width: w, height: h, data: d },
    truth,
    feet: centres.map(() => bottom + outline),
    centres,
    eyes,
    shadow,
  };
}

function addNoise(d: Uint8ClampedArray, amp: number, seed: number): void {
  if (amp <= 0) {
    return;
  }
  const rand = seeded(seed);
  for (let p = 0; p < d.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      d[p + c] = d[p + c]! + Math.round((rand() * 2 - 1) * amp);
    }
  }
}

/** Figure pixels (alpha > 0) outside the truth grown by one pixel, and the
 *  number of separate pieces they form, counted 4- and 8-connected (the
 *  count depends on the method, so both are reported). */
export function leaks(
  alpha: Uint8Array,
  truth: Uint8Array,
  w: number,
): { pixels: number; pieces4: number; pieces8: number } {
  const n = alpha.length;
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (truth[i] === 1) {
      const x = i % w;
      for (const j of [i, i - w, i + w]) {
        if (j < 0 || j >= n) {
          continue;
        }
        near[j] = 1;
        if (x > 0) {
          near[j - 1] = 1;
        }
        if (x < w - 1) {
          near[j + 1] = 1;
        }
      }
    }
  }
  const out = new Uint8Array(n);
  let pixels = 0;
  for (let i = 0; i < n; i++) {
    if (alpha[i]! > 0 && near[i] === 0) {
      out[i] = 1;
      pixels++;
    }
  }
  return {
    pixels,
    pieces4: pieces(out, w, false),
    pieces8: pieces(out, w, true),
  };
}

function pieces(mask: Uint8Array, w: number, diagonal: boolean): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== 1 || seen[s] === 1) {
      continue;
    }
    count++;
    seen[s] = 1;
    stack.push(s);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!diagonal && dx !== 0 && dy !== 0)) {
            continue;
          }
          const xx = x + dx;
          const j = i + dy * w + dx;
          if (xx >= 0 && xx < w && j >= 0 && j < mask.length) {
            if (mask[j] === 1 && seen[j] === 0) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
    }
  }
  return count;
}
