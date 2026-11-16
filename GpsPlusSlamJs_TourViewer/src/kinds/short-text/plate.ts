/**
 * A short text's plate: its words laid out and painted on a canvas, as a
 * sign's board or a pin's head shows them (`SIGN_PLATE`, `PIN_PLATE`):
 * a sign's board has the role's accent band across the top, a pin's
 * head a pointer below it. The role's icon left of the caption, the caption in bold and the
 * description smaller and quieter under it. Laid out in canvas pixels at
 * a fixed number of pixels per letter height (`PLATE_PX_PER_EM`), so the
 * world size is the layout times the letter height a reading distance
 * asks for (`shortTextLetterHeightM`).
 *
 * The layout is pure (a `measure` function stands in for the canvas), so
 * it is tested in Node; a page with no canvas (a test, a worker) gets the
 * layout with an estimated measure and no picture.
 *
 * @see plate.ts.md
 */

import type { TourShortTextRole } from "gps-plus-slam-app-framework/ar/tour-short-text";

/** Canvas pixels per letter height. */
export const PLATE_PX_PER_EM = 112;

/** Each role's accent: the band, the icon, the turning glyph. */
export const SHORT_TEXT_ACCENT: Readonly<Record<TourShortTextRole, string>> = {
  instruction: "#5fe3c9",
  label: "#f1d79c",
  warning: "#ffb02e",
};

/** A short text's role where it names none. */
export const SHORT_TEXT_DEFAULT_ROLE: TourShortTextRole = "label";

/** A short text's reading distance where it names none (m). */
export const SHORT_TEXT_DEFAULT_READ_AT_M = 4;

/** The plate's paint. */
const FILL = "rgba(17,21,27,0.95)";
const CAPTION_INK = "#f7f4ec";
const DESCRIPTION_INK = "#c3c8cf";
const ICON_INK = "#13171c";
const FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A plate's proportions, in letter heights: the caption's weight, its
 *  widest line, the padding, the corner radius, the accent band across
 *  the top and the pointer under the board (each as a share of a
 *  letter height; 0: none). */
export interface PlateStyle {
  readonly weight: number;
  readonly maxEm: number;
  readonly padX: number;
  readonly padY: number;
  readonly radius: number;
  readonly band: number;
  readonly pointer: number;
}

/** A sign's board: square corners, the role's band across the top. */
export const SIGN_PLATE: PlateStyle = {
  weight: 650,
  maxEm: 8.6,
  padX: 0.55,
  padY: 0.42,
  radius: 0.12,
  band: 0.17,
  pointer: 0,
};

/** A pin's head: a rounded tag with a pointer under it, toward its stem,
 *  and no band (its ring on the ground carries the role's colour). */
export const PIN_PLATE: PlateStyle = {
  weight: 650,
  maxEm: 9.5,
  padX: 0.5,
  padY: 0.34,
  radius: 0.5,
  band: 0,
  pointer: 0.42,
};
/** Description letters against the caption's. */
const DESC_EM = 0.62;
/** The most description lines shown; the last ends in " ...". */
const DESC_MAX_LINES = 6;

const P = PLATE_PX_PER_EM;

/** Text widths in px for a CSS `font`. */
export type Measure = (font: string, text: string) => number;

/** An estimate of a text's width without a canvas: about half a letter
 *  height per character. */
export const ESTIMATED_MEASURE: Measure = (font, text) => {
  const px = Number(/(\d+(?:\.\d+)?)px/u.exec(font)?.[1] ?? P);
  return [...text].length * 0.56 * px;
};

/**
 * `text` wrapped into lines no wider than `maxW` px: at spaces, and a word
 * wider than a line broken between its characters. Never empty: a blank
 * text is one blank line.
 */
export function wrapText(
  text: string,
  maxW: number,
  width: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let cur = "";
  const breakLong = (word: string): string => {
    let part = "";
    for (const ch of word) {
      if (part !== "" && width(part + ch) > maxW) {
        lines.push(part);
        part = ch;
      } else part += ch;
    }
    return part;
  };
  for (const word of text.split(/\s+/u).filter((w) => w !== "")) {
    const next = cur === "" ? word : `${cur} ${word}`;
    if (width(next) <= maxW) {
      cur = next;
      continue;
    }
    if (cur !== "") lines.push(cur);
    cur = width(word) > maxW ? breakLong(word) : word;
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [" "];
}

/** A plate's layout, in canvas px. */
export interface PlateLayout {
  readonly style: PlateStyle;
  readonly font: string;
  readonly descFont: string;
  readonly lines: readonly string[];
  readonly descLines: readonly string[];
  /** The board's size, and the clear margin round it on the canvas (for
   *  its shadow). */
  readonly bodyW: number;
  readonly bodyH: number;
  readonly margin: number;
  readonly band: number;
  /** The pointer's height under the board (0: none); the canvas holds it
   *  below the board's bottom margin. */
  readonly pointer: number;
  /** The role icon's centre on the canvas. */
  readonly iconX: number;
  readonly iconY: number;
  readonly canvasW: number;
  readonly canvasH: number;
}

/** The sign plate of `caption` and `description` (none: no second
 *  block). */
export function layoutSignPlate(
  caption: string,
  description: string | undefined,
  measure: Measure,
): PlateLayout {
  return layoutPlate(SIGN_PLATE, caption, description, measure);
}

/** The plate of `caption` and `description` in `style`. */
export function layoutPlate(
  style: PlateStyle,
  caption: string,
  description: string | undefined,
  measure: Measure,
): PlateLayout {
  const font = `${String(style.weight)} ${String(P)}px ${FONT}`;
  const descFont = `450 ${String(Math.round(DESC_EM * P))}px ${FONT}`;
  const lines = wrapText(caption, style.maxEm * P, (t) => measure(font, t));
  const capW = Math.max(1, ...lines.map((l) => measure(font, l)));
  let descLines: string[] = [];
  let descW = 0;
  if (description !== undefined && description.trim() !== "") {
    descLines = wrapText(
      description,
      Math.min((style.maxEm + 2) * P, Math.max(capW, 8 * P)),
      (t) => measure(descFont, t),
    );
    if (descLines.length > DESC_MAX_LINES) {
      descLines = descLines.slice(0, DESC_MAX_LINES);
      const last = descLines[DESC_MAX_LINES - 1] ?? "";
      descLines[DESC_MAX_LINES - 1] = `${last.replace(/\s*\S*$/u, "")} ...`;
    }
    descW = Math.max(...descLines.map((l) => measure(descFont, l)));
  }
  const lh = 1.17 * P;
  const dlh = 1.3 * DESC_EM * P;
  const gap = 0.36 * P;
  const capH = lh * (lines.length - 1) + 1.02 * P;
  const descH = descLines.length > 0 ? gap + dlh * descLines.length : 0;
  const margin = Math.round(0.36 * P);
  const band = style.band * P;
  const pointer = Math.round(style.pointer * P);
  const iconW = 1.22 * P;
  const bodyW = Math.ceil(style.padX * P * 2 + iconW + Math.max(capW, descW));
  const bodyH = Math.ceil(style.padY * P * 2 + capH + descH + band);
  const contentTop = margin + band + style.padY * P;
  return {
    style,
    font,
    descFont,
    lines,
    descLines,
    bodyW,
    bodyH,
    margin,
    band,
    pointer,
    iconX: margin + style.padX * P + 0.47 * P,
    iconY: contentTop + 0.5 * P + (lh * (lines.length - 1)) / 2,
    canvasW: bodyW + 2 * margin,
    canvasH: bodyH + 2 * margin + pointer,
  };
}

/** The 2D calls a plate is painted with. */
type Paint = CanvasRenderingContext2D;

/** The role's icon, `r` px round `(cx, cy)`: a warning triangle, an
 *  instruction's target (no direction: a painted arrow cannot know where
 *  the point is; the turning glyph does that), a label's diamond. */
function paintRoleIcon(
  g: Paint,
  role: TourShortTextRole,
  cx: number,
  cy: number,
  r: number,
): void {
  const a = SHORT_TEXT_ACCENT[role];
  g.save();
  if (role === "warning") {
    const h = r * 1.9;
    const w = r * 2.15;
    const top = cy - h * 0.55;
    g.fillStyle = a;
    g.strokeStyle = a;
    g.lineJoin = "round";
    g.lineWidth = r * 0.28;
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx + w / 2, top + h);
    g.lineTo(cx - w / 2, top + h);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#16191e";
    g.fillRect(cx - r * 0.11, top + h * 0.32, r * 0.22, h * 0.36);
    g.beginPath();
    g.arc(cx, top + h * 0.83, r * 0.13, 0, Math.PI * 2);
    g.fill();
  } else if (role === "instruction") {
    g.fillStyle = a;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ICON_INK;
    g.lineWidth = r * 0.2;
    g.beginPath();
    g.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = ICON_INK;
    g.beginPath();
    g.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
    g.fill();
  } else {
    g.strokeStyle = a;
    g.lineWidth = r * 0.2;
    g.beginPath();
    g.moveTo(cx, cy - r * 0.85);
    g.lineTo(cx + r * 0.85, cy);
    g.lineTo(cx, cy + r * 0.85);
    g.lineTo(cx - r * 0.85, cy);
    g.closePath();
    g.stroke();
    g.fillStyle = a;
    g.beginPath();
    g.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Paints `lay` onto `g` (a canvas of the layout's size): the shadowed
 *  board and its pointer, its top sheen, the accent band, the rim, the
 *  icon (none where a turning glyph takes its place) and the words. */
function paintPlate(
  g: Paint,
  lay: PlateLayout,
  role: TourShortTextRole,
  options: { readonly icon: boolean },
): void {
  const { margin: x0, margin: y0, bodyW, bodyH } = lay;
  const { style } = lay;
  const radius = Math.min(style.radius * P, bodyH / 2);
  // The pointer: a triangle from just inside the board's bottom edge to
  // its tip under the board's centre.
  const pointer = (): void => {
    const cx = x0 + bodyW / 2;
    g.beginPath();
    g.moveTo(cx - 0.32 * P, y0 + bodyH - 2);
    g.lineTo(cx, y0 + bodyH + lay.pointer);
    g.lineTo(cx + 0.32 * P, y0 + bodyH - 2);
    g.closePath();
    g.fill();
  };
  g.clearRect(0, 0, lay.canvasW, lay.canvasH);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.36)";
  g.shadowBlur = 0.3 * P;
  g.shadowOffsetY = 0.07 * P;
  g.fillStyle = FILL;
  g.beginPath();
  g.roundRect(x0, y0, bodyW, bodyH, radius);
  g.fill();
  if (lay.pointer > 0) pointer();
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x0, y0, bodyW, bodyH, radius);
  g.clip();
  const sheen = g.createLinearGradient(0, y0, 0, y0 + bodyH);
  sheen.addColorStop(0, "rgba(255,255,255,0.075)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  g.fillRect(x0, y0, bodyW, bodyH);
  if (lay.band > 0) {
    g.fillStyle = SHORT_TEXT_ACCENT[role];
    g.fillRect(x0, y0, bodyW, lay.band);
  }
  g.restore();
  const lw = 0.03 * P;
  g.lineWidth = lw;
  g.strokeStyle = "rgba(255,255,255,0.17)";
  g.beginPath();
  g.roundRect(
    x0 + lw / 2,
    y0 + lw / 2,
    bodyW - lw,
    bodyH - lw,
    Math.max(1, radius - lw / 2),
  );
  g.stroke();
  // Over the rim where the pointer leaves the board, so the join carries
  // no line.
  if (lay.pointer > 0) {
    g.fillStyle = FILL;
    pointer();
  }
  if (options.icon) paintRoleIcon(g, role, lay.iconX, lay.iconY, 0.42 * P);
  const left = x0 + style.padX * P + 1.22 * P;
  const top = y0 + lay.band + style.padY * P;
  const lh = 1.17 * P;
  const capH = lh * (lay.lines.length - 1) + 1.02 * P;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.font = lay.font;
  g.fillStyle = CAPTION_INK;
  lay.lines.forEach((line, i) => {
    g.fillText(line, left, top + 0.8 * P + i * lh);
  });
  g.font = lay.descFont;
  g.fillStyle = DESCRIPTION_INK;
  const dlh = 1.3 * DESC_EM * P;
  lay.descLines.forEach((line, i) => {
    g.fillText(line, left, top + capH + 0.36 * P + 0.8 * DESC_EM * P + i * dlh);
  });
}

/** A canvas of `w` x `h` px and its 2D context, or null on a page with
 *  none (Node, a canvas the browser refuses). */
export function makeCanvas(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  let g: CanvasRenderingContext2D | null;
  try {
    g = canvas.getContext("2d");
  } catch {
    g = null;
  }
  return g === null ? null : { canvas, g };
}

/** The measure of a real canvas, or the estimate on a page with none. */
export function canvasMeasure(): Measure {
  const probe = makeCanvas(1, 1);
  if (probe === null) return ESTIMATED_MEASURE;
  const { g } = probe;
  return (font, text) => {
    g.font = font;
    return g.measureText(text).width;
  };
}

/** A plate laid out and painted. */
export interface Plate {
  readonly layout: PlateLayout;
  readonly canvas: HTMLCanvasElement | null;
}

/** The plate of a text in `style`, laid out and painted: its canvas is
 *  null on a page with none (the layout still sizes the board). */
export function paintedPlate(
  style: PlateStyle,
  caption: string,
  description: string | undefined,
  role: TourShortTextRole,
  options: { readonly icon: boolean },
): Plate {
  const layout = layoutPlate(style, caption, description, canvasMeasure());
  const made = makeCanvas(layout.canvasW, layout.canvasH);
  if (made === null) return { layout, canvas: null };
  paintPlate(made.g, layout, role, options);
  return { layout, canvas: made.canvas };
}

/** The sign plate of a text (`paintedPlate` in `SIGN_PLATE`). */
export function signPlate(
  caption: string,
  description: string | undefined,
  role: TourShortTextRole,
  options: { readonly icon: boolean },
): Plate {
  return paintedPlate(SIGN_PLATE, caption, description, role, options);
}

/** The turning glyph: a disc in the role's accent with a dark arrow
 *  pointing up its canvas (128 px), or null on a page with no canvas. */
export function glyphCanvas(role: TourShortTextRole): HTMLCanvasElement | null {
  const made = makeCanvas(128, 128);
  if (made === null) return null;
  const { canvas, g } = made;
  g.fillStyle = SHORT_TEXT_ACCENT[role];
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ICON_INK;
  g.lineWidth = 15;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(64, 98);
  g.lineTo(64, 32);
  g.moveTo(38, 56);
  g.lineTo(64, 30);
  g.lineTo(90, 56);
  g.stroke();
  return canvas;
}
