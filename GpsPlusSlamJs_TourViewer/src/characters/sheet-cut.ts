/**
 * The character-sheet cut, first half: the background goes (real alpha, or
 * a flat background flood-filled from the border so light pixels inside a
 * figure stay), then the poses are found as groups of figure columns
 * separated by empty gaps (never by cutting at quarters). Plain typed-array
 * code: it runs in a Worker and in Node tests alike.
 *
 * @see sheet-cut.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import type { RgbaImage } from "./rgba-image.js";

/** The step of the cut a refusal belongs to (the page names the step). */
export type CutPhase = "read" | "background" | "poses" | "align" | "check";

export type CutErrorCode =
  | "not-image"
  | "decode"
  | "too-big"
  | "too-small"
  | "checkerboard"
  | "busy"
  | "empty"
  | "joined"
  | "extra"
  | "missing";

/** A refusal with words for the author, and the step that refused. */
export class CutError extends Error {
  readonly phase: CutPhase;
  readonly code: CutErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(
    phase: CutPhase,
    code: CutErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CutError";
    this.phase = phase;
    this.code = code;
    this.detail = detail;
  }
}

/** The cut-out: one alpha per pixel, and the colours with the background
 *  taken out of the soft edge (no white halo). */
export interface Cut {
  readonly alpha: Uint8Array;
  readonly rgb: Uint8ClampedArray;
  readonly mode: "alpha" | "white";
  /** The border's median colour (flat-background pictures only). */
  readonly bg?: readonly [number, number, number];
  /** Separate figure specks the island filter turned into background. */
  readonly specks: number;
}

function median(values: readonly number[]): number {
  const a = [...values].sort((x, y) => x - y);
  return a.length > 0 ? a[a.length >> 1]! : 0;
}

/** Share of every seventh pixel that is not opaque: over 1 % means the
 *  picture has real transparency. */
function hasTransparency(d: Uint8ClampedArray): boolean {
  let sampled = 0;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4 * 7) {
    sampled++;
    if (d[i]! < 250) {
      transparent++;
    }
  }
  return sampled > 0 && transparent / sampled > 0.01;
}

function checkForeground(fg: number, n: number): void {
  if (fg / n < 0.005) {
    throw new CutError(
      "background",
      "empty",
      "No figure was found in this picture.",
    );
  }
  if (fg / n > 0.85) {
    throw new CutError(
      "background",
      "busy",
      "The background could not be separated from the figures.",
    );
  }
}

function cutByAlpha(img: RgbaImage, s: CutSettings): Cut {
  const d = img.data;
  const n = img.width * img.height;
  const alpha = new Uint8Array(n);
  let fg = 0;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3]!;
    // A figure's alpha can top out just under 255 (253 in a real AI
    // output): near-opaque snaps to opaque.
    const v = a < s.alphaThr ? 0 : a >= 240 ? 255 : a;
    alpha[i] = v;
    if (v > 0) {
      fg++;
    }
  }
  checkForeground(fg, n);
  return { alpha, rgb: new Uint8ClampedArray(d), mode: "alpha", specks: 0 };
}

/** Indices of every border pixel (each once). */
function borderIndices(w: number, h: number): Int32Array {
  const out: number[] = [];
  for (let x = 0; x < w; x++) {
    out.push(x, (h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    out.push(y * w, y * w + w - 1);
  }
  return Int32Array.from(out);
}

type Rgb = readonly [number, number, number];

/** Largest channel distance of pixel `i` from `bg`. */
function distance(d: Uint8ClampedArray, i: number, bg: Rgb): number {
  const p = i * 4;
  return Math.max(
    Math.abs(d[p]! - bg[0]),
    Math.abs(d[p + 1]! - bg[1]),
    Math.abs(d[p + 2]! - bg[2]),
  );
}

/** Refuses a border that is not one flat colour, naming a checkerboard
 *  painted as fake transparency when that is what it is. */
function checkFlatBorder(
  d: Uint8ClampedArray,
  border: Int32Array,
  bg: Rgb,
  tol: number,
): void {
  const others: number[] = [];
  for (const i of border) {
    if (distance(d, i, bg) > tol) {
      others.push(i);
    }
  }
  const share = 1 - others.length / border.length;
  if (share >= 0.7) {
    return;
  }
  const lum = (i: number): number =>
    0.3 * d[i * 4]! + 0.59 * d[i * 4 + 1]! + 0.11 * d[i * 4 + 2]!;
  const otherLum = median(others.map(lum));
  const bgLum = 0.3 * bg[0] + 0.59 * bg[1] + 0.11 * bg[2];
  if (others.length / border.length > 0.2 && otherLum > 140 && bgLum > 140) {
    throw new CutError(
      "background",
      "checkerboard",
      "The background is a grey and white checkerboard drawn into the picture, not real transparency.",
    );
  }
  throw new CutError(
    "background",
    "busy",
    "The background is not one flat colour, so the figures cannot be cut out.",
    { share },
  );
}

/** Flood fill from the border through every pixel `passes` accepts: what
 *  it reaches is background (1). Light pixels the fill cannot reach (eye
 *  whites, teeth inside a figure's outline) stay figure. */
function floodBackground(
  w: number,
  h: number,
  border: Int32Array,
  passes: (i: number) => boolean,
): Uint8Array {
  const n = w * h;
  const bgMask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (i: number): void => {
    if (bgMask[i] === 0 && passes(i)) {
      bgMask[i] = 1;
      queue[tail++] = i;
    }
  };
  for (const i of border) {
    push(i);
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    if (x > 0) {
      push(i - 1);
    }
    if (x < w - 1) {
      push(i + 1);
    }
    if (i >= w) {
      push(i - w);
    }
    if (i < n - w) {
      push(i + w);
    }
  }
  return bgMask;
}

function touchesBackground(bgMask: Uint8Array, i: number, w: number): boolean {
  const x = i % w;
  return (
    (x > 0 && bgMask[i - 1] === 1) ||
    (x < w - 1 && bgMask[i + 1] === 1) ||
    (i >= w && bgMask[i - w] === 1) ||
    (i + w < bgMask.length && bgMask[i + w] === 1)
  );
}

/** Softens the cut edge: an edge pixel's alpha follows its distance from
 *  the background, and the background colour is taken out of it. */
function softenEdge(
  img: RgbaImage,
  bgMask: Uint8Array,
  alpha: Uint8Array,
  rgb: Uint8ClampedArray,
  bg: Rgb,
  s: CutSettings,
): void {
  const d = img.data;
  const tol = s.whiteTol;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 0 || !touchesBackground(bgMask, i, img.width)) {
      continue;
    }
    const p = i * 4;
    const a = Math.min(
      1,
      Math.max(0.08, (distance(d, i, bg) - tol * 0.5) / s.edgeSoft),
    );
    alpha[i] = Math.round(a * 255);
    for (let c = 0; c < 3; c++) {
      rgb[p + c] = (d[p + c]! - bg[c]! * (1 - a)) / a;
    }
  }
}

/** A light, colourless pixel: a soft ground shadow on a light background
 *  (every channel at least `shadowFloor`, channels within `shadowSpread`). */
function shadowy(d: Uint8ClampedArray, i: number, s: CutSettings): boolean {
  const p = i * 4;
  const r = d[p]!;
  const g = d[p + 1]!;
  const b = d[p + 2]!;
  const lo = Math.min(r, g, b);
  return lo >= s.shadowFloor && Math.max(r, g, b) - lo <= s.shadowSpread;
}

/** Turns every separate figure piece (8-connected) of fewer than `min`
 *  pixels into background; returns how many pieces it removed. Pieces
 *  inside a figure (eye whites) belong to the figure's piece and stay. */
function dropIslands(bgMask: Uint8Array, w: number, min: number): number {
  if (min <= 0) {
    return 0;
  }
  const n = bgMask.length;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const piece: number[] = [];
  let removed = 0;
  for (let start = 0; start < n; start++) {
    if (bgMask[start] === 1 || seen[start] === 1) {
      continue;
    }
    piece.length = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const i = stack[--top]!;
      if (piece.length < min) {
        piece.push(i);
      }
      const x = i % w;
      for (let dy = -w; dy <= w; dy += w) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy + dx;
          if (
            j < 0 ||
            j >= n ||
            (dx === -1 && x === 0) ||
            (dx === 1 && x === w - 1) ||
            bgMask[j] === 1 ||
            seen[j] === 1
          ) {
            continue;
          }
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (piece.length < min) {
      for (const i of piece) {
        bgMask[i] = 1;
      }
      removed++;
    }
  }
  return removed;
}

function cutFlat(img: RgbaImage, s: CutSettings): Cut {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const border = borderIndices(w, h);
  const channel = (c: number): number[] =>
    Array.from(border, (i) => d[i * 4 + c]!);
  const bg: Rgb = [median(channel(0)), median(channel(1)), median(channel(2))];
  const tol = s.whiteTol;
  checkFlatBorder(d, border, bg, tol);
  const bgMask = floodBackground(
    w,
    h,
    border,
    (i) => distance(d, i, bg) <= tol || (s.shadowOn && shadowy(d, i, s)),
  );
  const specks = dropIslands(bgMask, w, s.islandMin);
  const alpha = new Uint8Array(n);
  let fg = 0;
  for (let i = 0; i < n; i++) {
    if (bgMask[i] === 0) {
      alpha[i] = 255;
      fg++;
    }
  }
  const rgb = new Uint8ClampedArray(d);
  softenEdge(img, bgMask, alpha, rgb, bg, s);
  checkForeground(fg, n);
  return { alpha, rgb, mode: "white", bg, specks };
}

/** Cuts the background away: real transparency where the picture has it
 *  (colour under alpha 0 is ignored), else a flat background flood-filled
 *  from the border. Throws `CutError` for a busy background, a painted
 *  checkerboard, or nothing (or nearly everything) left as figure. */
export function cutBackground(img: RgbaImage, s: CutSettings): Cut {
  return hasTransparency(img.data) ? cutByAlpha(img, s) : cutFlat(img, s);
}

/** One pose: its column range, its rows, and its pixel mass. */
export interface FigureRun {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  mass: number;
}

export interface Figures {
  readonly runs: FigureRun[];
  /** Empty columns between neighbouring poses. */
  readonly gaps: number[];
  /** The narrowest empty run that still splits two poses. */
  readonly minGap: number;
}

/** Figure pixels (alpha at least half) per column. */
function columnCounts(alpha: Uint8Array, w: number, h: number): Uint32Array {
  const col = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x]! >= 128) {
        col[x] = col[x]! + 1;
      }
    }
  }
  return col;
}

/** Runs of columns holding at least `minCol` figure pixels, merged across
 *  empty runs narrower than `minGap`. */
function columnRuns(
  col: Uint32Array,
  minCol: number,
  minGap: number,
): FigureRun[] {
  const merged: FigureRun[] = [];
  let start = -1;
  for (let x = 0; x <= col.length; x++) {
    const on = x < col.length && col[x]! >= minCol;
    if (on && start < 0) {
      start = x;
    }
    if (!on && start >= 0) {
      const last = merged[merged.length - 1];
      if (last !== undefined && start - last.x1 - 1 < minGap) {
        last.x1 = x - 1;
      } else {
        merged.push({ x0: start, x1: x - 1, y0: -1, y1: -1, mass: 0 });
      }
      start = -1;
    }
  }
  for (const r of merged) {
    for (let x = r.x0; x <= r.x1; x++) {
      r.mass += col[x]!;
    }
  }
  return merged;
}

/** The first and last row with at least two figure pixels in the run's
 *  columns (a single speck does not move a pose's bottom). */
function rowExtent(alpha: Uint8Array, w: number, h: number, r: FigureRun) {
  r.y0 = -1;
  r.y1 = -1;
  for (let y = 0; y < h; y++) {
    let c = 0;
    const row = y * w;
    for (let x = r.x0; x <= r.x1 && c < 2; x++) {
      if (alpha[row + x]! >= 128) {
        c++;
      }
    }
    if (c >= 2) {
      if (r.y0 < 0) {
        r.y0 = y;
      }
      r.y1 = y;
    }
  }
}

/** The poses, left to right, as groups of figure columns. A group with less
 *  than `specFrac` of the biggest one's pixels is dropped as a speck. */
export function findFigures(
  alpha: Uint8Array,
  w: number,
  h: number,
  s: CutSettings,
): Figures {
  const col = columnCounts(alpha, w, h);
  const minCol = Math.max(1, Math.round(h * 0.002));
  const minGap = Math.max(2, Math.round(w * s.minGapFrac));
  const merged = columnRuns(col, minCol, minGap);
  const maxMass = Math.max(0, ...merged.map((r) => r.mass));
  const runs = merged.filter((r) => r.mass >= s.specFrac * maxMass);
  for (const r of runs) {
    rowExtent(alpha, w, h, r);
  }
  const gaps: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    gaps.push(runs[i]!.x0 - runs[i - 1]!.x1 - 1);
  }
  return { runs, gaps, minGap };
}

/** Why the count is not four: none, too many, two poses touching (a run
 *  far wider than the narrowest; `joined` lists them), or poses missing. */
export function diagnoseCount(runs: readonly FigureRun[]): {
  code: "empty" | "extra" | "joined" | "missing";
  joined: number[];
} {
  if (runs.length === 0) {
    return { code: "empty", joined: [] };
  }
  if (runs.length > 4) {
    return { code: "extra", joined: [] };
  }
  const widths = runs.map((r) => r.x1 - r.x0 + 1);
  const narrow = Math.min(...widths);
  const joined: number[] = [];
  widths.forEach((wd, i) => {
    if (wd > 1.6 * narrow) {
      joined.push(i);
    }
  });
  return { code: joined.length > 0 ? "joined" : "missing", joined };
}

/** The refusal for a count other than four, in the author's words. */
export function countError(figures: Figures, w: number, h: number): CutError {
  const n = figures.runs.length;
  const dg = diagnoseCount(figures.runs);
  const message =
    dg.code === "joined"
      ? `Found ${n} instead of 4: two poses touch`
      : dg.code === "extra"
        ? `Found ${n} shapes instead of 4`
        : dg.code === "empty"
          ? "Found no pose"
          : `Found only ${n} poses`;
  return new CutError("poses", dg.code, message, {
    runs: figures.runs.map((r) => ({ ...r })),
    joined: dg.joined,
    w,
    h,
  });
}
