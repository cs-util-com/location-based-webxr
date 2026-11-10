/**
 * The character-sheet cut, checks: how much of the body moves between the
 * idle and the talking poses (below the head band, after the best small
 * shift), whether the mouth moves, whether the beckon differs and points
 * the right way; and the steady body, the idle frame with only the talking
 * frame's head band blended in.
 *
 * @see sheet-check.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import { blankImage, scaledImage, type RgbaImage } from "./rgba-image.js";

/** Share of figure pixels (the union of both masks, rows `yFrom..yTo`)
 *  that differ between `a(x, y)` and `b(x + dx, y + dy)`. */
export function diffShare(
  a: RgbaImage,
  b: RgbaImage,
  dx: number,
  dy: number,
  yFrom: number,
  yTo: number,
  thr: number,
): number {
  const { width: w, height: h } = a;
  const A = a.data;
  const B = b.data;
  let union = 0;
  let differ = 0;
  for (let y = Math.max(0, yFrom); y <= Math.min(h - 1, yTo); y++) {
    const yb = y + dy;
    for (let x = 0; x < w; x++) {
      const pa = (y * w + x) * 4;
      const xb = x + dx;
      const inB = xb >= 0 && xb < w && yb >= 0 && yb < h;
      const pb = (yb * w + xb) * 4;
      const onA = A[pa + 3]! >= 128;
      const onB = inB && B[pb + 3]! >= 128;
      if (!onA && !onB) {
        continue;
      }
      union++;
      if (onA !== onB || colourDiffers(A, pa, B, pb, thr)) {
        differ++;
      }
    }
  }
  return union > 0 ? differ / union : 0;
}

function colourDiffers(
  A: Uint8ClampedArray,
  pa: number,
  B: Uint8ClampedArray,
  pb: number,
  thr: number,
): boolean {
  return (
    Math.abs(A[pa]! - B[pb]!) > thr ||
    Math.abs(A[pa + 1]! - B[pb + 1]!) > thr ||
    Math.abs(A[pa + 2]! - B[pb + 2]!) > thr
  );
}

interface Shift {
  readonly dx: number;
  readonly dy: number;
  readonly share: number;
}

function bestShift(
  a: RgbaImage,
  b: RgbaImage,
  yFrom: number,
  yTo: number,
  s: CutSettings,
): Shift {
  let best: Shift = { dx: 0, dy: 0, share: Infinity };
  for (let dy = -s.maxShift; dy <= s.maxShift; dy++) {
    for (let dx = -s.maxShift; dx <= s.maxShift; dx++) {
      const share = diffShare(a, b, dx, dy, yFrom, yTo, s.diffThr);
      if (share < best.share) {
        best = { dx, dy, share };
      }
    }
  }
  return best;
}

interface Extents {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The box of pixels with alpha at least half. */
export function extents(img: RgbaImage): Extents {
  const { width: w, height: h, data: d } = img;
  const e: Extents = { top: h, bottom: -1, left: w, right: -1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]! >= 128) {
        e.top = Math.min(e.top, y);
        e.bottom = Math.max(e.bottom, y);
        e.left = Math.min(e.left, x);
        e.right = Math.max(e.right, x);
      }
    }
  }
  return e;
}

type CheckWarning = "mouth" | "beckon-same" | "beckon-left" | "sizes";

export interface FrameCheck {
  /** The larger body difference of the two talking poses (0..1). */
  readonly bodyDiff: number;
  readonly headDiff: number;
  readonly beckonDiff: number;
  /** Per talking pose: body and head difference, and the head's best
   *  shift in cell pixels. */
  readonly talk: readonly {
    readonly body: number;
    readonly head: number;
    readonly headShift: { readonly dx: number; readonly dy: number };
  }[];
  /** The body moves while talking (`bodyDiff > jitterWarn`). */
  readonly jitter: boolean;
  /** The idle figure's top row, height and head band end, in cell pixels. */
  readonly figTop: number;
  readonly figH: number;
  readonly bandEnd: number;
  readonly warnings: readonly CheckWarning[];
}

function beckonWarning(
  ext: readonly Extents[],
  width: number,
  beckonDiff: number,
): CheckWarning | null {
  if (beckonDiff < 0.04) {
    return "beckon-same";
  }
  const idle = ext[0]!;
  const beckon = ext[3]!;
  const cx = width / 2;
  const growR = beckon.right - cx - (idle.right - cx);
  const growL = cx - beckon.left - (cx - idle.left);
  return growL > growR + 0.03 * width && growL > 0.05 * width
    ? "beckon-left"
    : null;
}

/** Checks four aligned frames (at half resolution, for speed). */
export function checkFrames(
  frames: readonly RgbaImage[],
  s: CutSettings,
): FrameCheck {
  const k = 0.5;
  const D = frames.map((f) => scaledImage(f, k));
  const ext = D.map(extents);
  const idle = ext[0]!;
  const figH = idle.bottom - idle.top + 1;
  const bandEnd = Math.round(idle.top + s.headBand * figH);
  const talk = [1, 2].map((i) => {
    const body = bestShift(D[0]!, D[i]!, bandEnd, idle.bottom, s);
    const head = bestShift(D[0]!, D[i]!, idle.top, bandEnd, s);
    return {
      body: body.share,
      head: head.share,
      headShift: { dx: head.dx / k, dy: head.dy / k },
    };
  });
  const bodyDiff = Math.max(talk[0]!.body, talk[1]!.body);
  const headDiff = Math.max(talk[0]!.head, talk[1]!.head);
  const beckonDiff = diffShare(
    D[0]!,
    D[3]!,
    0,
    0,
    idle.top,
    idle.bottom,
    s.diffThr,
  );
  const warnings: CheckWarning[] = [];
  if (headDiff < s.mouthMin) {
    warnings.push("mouth");
  }
  const beckon = beckonWarning(ext, D[0]!.width, beckonDiff);
  if (beckon !== null) {
    warnings.push(beckon);
  }
  const heights = ext.map((e) => e.bottom - e.top + 1);
  if (Math.min(...heights) < 0.85 * Math.max(...heights)) {
    warnings.push("sizes");
  }
  return {
    bodyDiff,
    headDiff,
    beckonDiff,
    talk,
    jitter: bodyDiff > s.jitterWarn,
    figTop: idle.top / k,
    figH: figH / k,
    bandEnd: bandEnd / k,
    warnings,
  };
}

/** The weight of the talking frame at row `y`: 1 above the head band's
 *  feather, 0 below it, smoothstep across it. */
function bandWeight(y: number, y0: number, y1: number): number {
  const t = y <= y0 ? 1 : y >= y1 ? 0 : 1 - (y - y0) / (y1 - y0);
  return t * t * (3 - 2 * t);
}

function blendRow(
  I: Uint8ClampedArray,
  T: Uint8ClampedArray,
  O: Uint8ClampedArray,
  y: number,
  w: number,
  h: number,
  wt: number,
  shift: { readonly dx: number; readonly dy: number },
): void {
  const yt = Math.round(y + shift.dy);
  for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const xt = Math.round(x + shift.dx);
    const inT = wt > 0 && xt >= 0 && xt < w && yt >= 0 && yt < h;
    const q = (yt * w + xt) * 4;
    const ai = I[p + 3]! / 255;
    const at = inT ? T[q + 3]! / 255 : 0;
    const a = at * wt + ai * (1 - wt);
    O[p + 3] = Math.round(a * 255);
    if (a > 0) {
      for (let ch = 0; ch < 3; ch++) {
        O[p + ch] =
          ((inT ? T[q + ch]! * at : 0) * wt + I[p + ch]! * ai * (1 - wt)) / a;
      }
    }
  }
}

/** The steady body: frames 1 and 2 become the idle body with the talking
 *  frame's head band (moved by the head's best shift), feathered into it.
 *  Frames 0 and 3 are returned as they are. */
export function steadyBody(
  frames: readonly RgbaImage[],
  check: FrameCheck,
  s: CutSettings,
): RgbaImage[] {
  const idle = frames[0]!;
  const { width: w, height: h } = idle;
  const feather = Math.max(4, s.featherFrac * check.figH);
  const y0 = check.bandEnd - feather / 2;
  const y1 = check.bandEnd + feather / 2;
  const out: RgbaImage[] = [idle];
  for (const t of [1, 2]) {
    const img = blankImage(w, h);
    const shift = check.talk[t - 1]!.headShift;
    for (let y = 0; y < h; y++) {
      blendRow(
        idle.data,
        frames[t]!.data,
        img.data,
        y,
        w,
        h,
        bandWeight(y, y0, y1),
        shift,
      );
    }
    out.push(img);
  }
  out.push(frames[3]!);
  return out;
}
