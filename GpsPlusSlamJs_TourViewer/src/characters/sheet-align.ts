/**
 * The character-sheet cut, alignment: each pose is cropped, all four are
 * scaled by one common factor, stood on one baseline and centred by their
 * legs in equal cells; `composeSheet` lays the cells side by side as the
 * canonical sheet the visitor's side reads.
 *
 * @see sheet-align.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import { blankImage, drawScaled, type RgbaImage } from "./rgba-image.js";
import type { Cut, FigureRun } from "./sheet-cut.js";

/** The cut as one RGBA picture (the cut colours, the cut alpha). */
function cutImage(cut: Cut, w: number, h: number): RgbaImage {
  const out = blankImage(w, h);
  const od = out.data;
  for (let i = 0, n = w * h; i < n; i++) {
    const p = i * 4;
    od[p] = cut.rgb[p]!;
    od[p + 1] = cut.rgb[p + 1]!;
    od[p + 2] = cut.rgb[p + 2]!;
    od[p + 3] = cut.alpha[i]!;
  }
  return out;
}

/** The horizontal anchor: the median figure column in the bottom quarter
 *  (the legs), so an outstretched arm does not push the body off centre. */
function legAnchor(alpha: Uint8Array, w: number, r: FigureRun): number {
  const yFrom = Math.round(r.y1 - 0.25 * (r.y1 - r.y0));
  const hist = new Uint32Array(r.x1 - r.x0 + 1);
  let total = 0;
  for (let y = yFrom; y <= r.y1; y++) {
    const row = y * w;
    for (let x = r.x0; x <= r.x1; x++) {
      if (alpha[row + x]! >= 128) {
        hist[x - r.x0] = hist[x - r.x0]! + 1;
        total++;
      }
    }
  }
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i]!;
    if (acc >= total / 2) {
      return r.x0 + i;
    }
  }
  return (r.x0 + r.x1) / 2;
}

export interface Aligned {
  /** Four cells of `cellW` x `cellH`, idle, talk-a, talk-b, beckon. */
  readonly frames: RgbaImage[];
  /** The common scale from the picture to the cells. */
  readonly scale: number;
}

/** Crops, scales (one factor for all) and places the four poses: the
 *  tallest fills 92 % of the cell's height, the widest half 47 % of its
 *  width, feet on a baseline at 96 % of the height. */
export function alignFrames(
  cut: Cut,
  w: number,
  h: number,
  runs: readonly FigureRun[],
  s: CutSettings,
): Aligned {
  const src = cutImage(cut, w, h);
  const anchors = runs.map((r) => legAnchor(cut.alpha, w, r));
  const figH = Math.max(...runs.map((r) => r.y1 - r.y0 + 1));
  const halfExt = Math.max(
    ...runs.map((r, i) => Math.max(anchors[i]! - r.x0, r.x1 - anchors[i]!) + 1),
  );
  const scale = Math.min((s.cellH * 0.92) / figH, (s.cellW * 0.47) / halfExt);
  const baseline = Math.round(s.cellH * 0.96);
  const frames = runs.map((r, i) => {
    const cell = blankImage(s.cellW, s.cellH);
    const bw = r.x1 - r.x0 + 1;
    const bh = r.y1 - r.y0 + 1;
    drawScaled(
      src,
      r.x0,
      r.y0,
      bw,
      bh,
      cell,
      s.cellW / 2 - (anchors[i]! - r.x0) * scale,
      baseline - bh * scale,
      bw * scale,
      bh * scale,
    );
    return cell;
  });
  return { frames, scale };
}

/** The canonical sheet: the cells side by side in one row, left to right. */
export function composeSheet(frames: readonly RgbaImage[]): RgbaImage {
  const first = frames[0];
  if (first === undefined) {
    throw new Error("a sheet needs at least one frame");
  }
  const { width: cw, height: ch } = first;
  const sheet = blankImage(cw * frames.length, ch);
  frames.forEach((f, i) => {
    if (f.width !== cw || f.height !== ch) {
      throw new Error("every frame of a sheet has the same size");
    }
    for (let y = 0; y < ch; y++) {
      const from = y * cw * 4;
      sheet.data.set(
        f.data.subarray(from, from + cw * 4),
        (y * sheet.width + i * cw) * 4,
      );
    }
  });
  return sheet;
}
