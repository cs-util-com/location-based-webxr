/**
 * What a picture's world parts paint on canvases: the framed print's plate
 * (its year large, its caption in three lines, its credit small and a
 * quiet "i" mark that says a tap shows more), its cream mat, and the
 * cut-out's foot tag. The look is the chosen picture prototype's
 * (`public/prototypes/station-blocks-3-pictures`), number for number.
 *
 * The parts take these as `PicturePainters` so their tests run without a
 * canvas (`test-support/fake-picture-painters.ts`); the cut of the words is
 * `plate.ts`'s, tested on its own.
 *
 * @see picture-paint.ts.md
 */

import { plateLines, tagLine } from "./plate.js";

/** A painted panel and its size in the world (metres). */
export interface PaintedPanel {
  readonly image: HTMLCanvasElement;
  readonly widthM: number;
  readonly heightM: number;
}

/** The plate's words. */
export interface PlateWords {
  readonly year?: string | undefined;
  readonly caption?: string | undefined;
  readonly credit?: string | undefined;
}

/** The tag's words. */
export interface TagWords {
  readonly year?: string | undefined;
  readonly title?: string | undefined;
  readonly caption?: string | undefined;
}

/** What the picture parts paint with. */
export interface PicturePainters {
  /** The plate under a framed print `widthM` wide (its frame's outer
   *  width): its height follows its lines. */
  plate(words: PlateWords, widthM: number): PaintedPanel;
  /** The mat `innerW` x `innerH` (m) round a print `w` x `h` (m). */
  mat(innerW: number, innerH: number, w: number, h: number): HTMLCanvasElement;
  /** The cut-out's foot tag, `TAG_WIDTH_M` x `TAG_HEIGHT_M`. */
  tag(words: TagWords): HTMLCanvasElement;
  /** A soft round shadow, black fading out from its middle (its alpha is
   *  the shadow). */
  shadow(): HTMLCanvasElement;
}

/** The tag's size in the world (m). */
export const TAG_WIDTH_M = 0.62;
export const TAG_HEIGHT_M = 0.215;

const SERIF =
  '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif';
const SANS =
  'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const AMBER = "#e9b872";
const INK = "#f4ede1";
const MUTED = "#a99d8a";

/** A canvas of at least 1 x 1 px. */
function canvasOf(
  doc: Document,
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("no 2D canvas to paint a picture's plate");
  return { canvas, g };
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** `text` cut from its end until it fits `maxW` px, with an ellipsis when
 *  cut. */
function fitLine(
  g: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  let t = text;
  while (g.measureText(t).width > maxW && t.length > 4) t = t.slice(0, -2);
  return t === text ? t : `${t.trimEnd()}…`;
}

/** A small seeded random stream (the mat's grain is the same each time). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The plate, painted at 520 px a metre. */
function paintPlate(
  doc: Document,
  words: PlateWords,
  widthM: number,
): PaintedPanel {
  const ppm = 520;
  const W = Math.round(widthM * ppm);
  const pad = 0.06 * ppm;
  const measure = canvasOf(doc, 4, 4).g;
  const year = words.year?.trim() ?? "";
  measure.font = `600 ${String(0.15 * ppm)}px ${SERIF}`;
  const yearW = year === "" ? 0 : measure.measureText(year).width;
  const colX = pad + (year === "" ? 0 : yearW + 0.09 * ppm);
  const colW = W - colX - pad - 0.05 * ppm;
  const fs = 0.08 * ppm;
  measure.font = `${String(fs)}px ${SERIF}`;
  const { lines } = plateLines(
    words.caption,
    (line) => measure.measureText(line).width <= colW,
  );
  const lh = fs * 1.24;
  const cfs = 0.04 * ppm;
  const credit = words.credit?.trim() ?? "";
  const H = Math.round(
    Math.max(
      year === "" ? 0 : 0.18 * ppm,
      lines.length * lh + (credit === "" ? 0 : cfs * 2.1),
    ) +
      2 * pad,
  );
  const { canvas, g } = canvasOf(doc, W, H);
  g.fillStyle = "rgba(19,16,13,0.9)";
  roundRect(g, 0, 0, W, H, 0.035 * ppm);
  g.fill();
  if (year !== "") {
    g.fillStyle = AMBER;
    g.font = `600 ${String(0.15 * ppm)}px ${SERIF}`;
    g.fillText(year, pad, pad + 0.12 * ppm);
    g.fillStyle = "rgba(233,184,114,0.35)";
    g.fillRect(
      pad + yearW + 0.045 * ppm,
      pad + 0.01 * ppm,
      Math.max(2, 0.004 * ppm),
      H - 2 * pad - 0.02 * ppm,
    );
  }
  g.fillStyle = INK;
  g.font = `${String(fs)}px ${SERIF}`;
  lines.forEach((l, i) => {
    g.fillText(l, colX, pad + fs * 0.9 + i * lh);
  });
  if (credit !== "") {
    g.fillStyle = MUTED;
    g.font = `${String(cfs)}px ${SANS}`;
    g.fillText(
      fitLine(g, credit, colW),
      colX,
      pad + lines.length * lh + cfs * 1.3,
    );
  }
  // A quiet "more" mark: a tap opens the sheet.
  const ix = W - pad * 0.9;
  const iy = H - pad * 0.95;
  g.strokeStyle = "rgba(233,184,114,0.85)";
  g.lineWidth = 0.006 * ppm;
  g.beginPath();
  g.arc(ix, iy, 0.024 * ppm, 0, 2 * Math.PI);
  g.stroke();
  g.fillStyle = "rgba(233,184,114,0.95)";
  g.font = `600 ${String(0.03 * ppm)}px ${SERIF}`;
  g.textAlign = "center";
  g.fillText("i", ix, iy + 0.011 * ppm);
  return { image: canvas, widthM, heightM: H / ppm };
}

/** The mat, painted at 420 px a metre: cream with a faint grain, a white
 *  bevel round the print and a shadow under the frame's top and left. */
function paintMat(
  doc: Document,
  innerW: number,
  innerH: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const ppm = 420;
  const W = Math.round(innerW * ppm);
  const H = Math.round(innerH * ppm);
  const { canvas, g } = canvasOf(doc, W, H);
  const r = seeded(3);
  g.fillStyle = "#ebe3d1";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 70; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "120,100,70"},${String(0.05 * r())})`;
    g.fillRect(r() * W, r() * H, 1.5, 1.5);
  }
  const x0 = ((innerW - w) / 2) * ppm;
  const y0 = ((innerH - h) / 2) * ppm;
  const ww = w * ppm;
  const hh = h * ppm;
  const b = Math.max(3, 0.007 * ppm);
  g.fillStyle = "#fbf7ee";
  g.fillRect(x0 - b, y0 - b, ww + 2 * b, hh + 2 * b);
  g.fillStyle = "#c9bea8";
  g.beginPath();
  g.moveTo(x0 + ww + b, y0 - b);
  g.lineTo(x0 + ww + b, y0 + hh + b);
  g.lineTo(x0 - b, y0 + hh + b);
  g.lineTo(x0, y0 + hh);
  g.lineTo(x0 + ww, y0 + hh);
  g.lineTo(x0 + ww, y0);
  g.closePath();
  g.fill();
  const s = 0.035 * ppm;
  let gr = g.createLinearGradient(0, 0, 0, s);
  gr.addColorStop(0, "rgba(40,28,16,0.28)");
  gr.addColorStop(1, "rgba(40,28,16,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, s);
  gr = g.createLinearGradient(0, 0, s, 0);
  gr.addColorStop(0, "rgba(40,28,16,0.2)");
  gr.addColorStop(1, "rgba(40,28,16,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, H);
  return canvas;
}

/** The foot tag, painted at 560 px a metre: the year, the tag line and
 *  "Tap for the story". */
function paintTag(doc: Document, words: TagWords): HTMLCanvasElement {
  const ppm = 560;
  const W = Math.round(TAG_WIDTH_M * ppm);
  const H = Math.round(TAG_HEIGHT_M * ppm);
  const { canvas, g } = canvasOf(doc, W, H);
  const pad = 0.045 * ppm;
  g.fillStyle = "rgba(19,16,13,0.92)";
  roundRect(g, 0, 0, W, H, 0.03 * ppm);
  g.fill();
  const y = pad;
  let x = pad;
  g.textBaseline = "top";
  const year = words.year?.trim() ?? "";
  if (year !== "") {
    g.fillStyle = AMBER;
    g.font = `600 ${String(0.1 * ppm)}px ${SERIF}`;
    g.fillText(year, x, y);
    x += g.measureText(year).width + 0.035 * ppm;
  }
  const maxW = W - x - pad;
  g.fillStyle = INK;
  g.font = `600 ${String(0.05 * ppm)}px ${SANS}`;
  g.fillText(
    fitLine(g, tagLine(words.title, words.caption), maxW),
    x,
    y + 0.008 * ppm,
  );
  g.fillStyle = "#bcb09c";
  g.font = `${String(0.04 * ppm)}px ${SANS}`;
  g.fillText(fitLine(g, "Tap for the story", maxW), x, y + 0.064 * ppm);
  return canvas;
}

/** The contact shadow: a radial fade, 128 px. */
function paintShadow(doc: Document): HTMLCanvasElement {
  const { canvas, g } = canvasOf(doc, 128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,1)");
  gr.addColorStop(0.5, "rgba(0,0,0,0.55)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return canvas;
}

/** The painters on `doc`'s canvases. */
export function canvasPicturePainters(
  doc: Document = document,
): PicturePainters {
  return {
    plate: (words, widthM) => paintPlate(doc, words, widthM),
    mat: (innerW, innerH, w, h) => paintMat(doc, innerW, innerH, w, h),
    tag: (words) => paintTag(doc, words),
    shadow: () => paintShadow(doc),
  };
}
