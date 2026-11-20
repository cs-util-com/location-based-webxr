/**
 * Paints a narrated text's words into a 2D canvas, the one visible box of
 * the travel mode: on the plate under the sign, in flight and at the dock.
 *
 * The painter knows nothing about the DOM. The narration box measures its
 * own (invisible) layout once and hands a {@link WordsPaintLayout} over;
 * each frame adds the voice time, the lit word, the scroll and the hint
 * ({@link WordsPaintFrame}). {@link wordsPaintKey} says when a repaint is
 * due, so a paused voice costs no paints and no texture uploads.
 */

import { thumbGeometry } from "./narration-box-timeline";

/** The 2D context subset the painter uses (a recorder stands in in tests). */
export type WordsPaintContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "setTransform"
  | "clearRect"
  | "beginPath"
  | "roundRect"
  | "rect"
  | "clip"
  | "fill"
  | "stroke"
  | "fillText"
  | "measureText"
  | "createLinearGradient"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

/** A run of text the box laid out: the name, a disclosure part or a word. */
export interface WordsPaintRun {
  readonly kind: "who" | "disc" | "word";
  readonly text: string;
  /** Left edge in CSS px, relative to the text column. */
  readonly x: number;
  /** Line index from the first line of the text. */
  readonly line: number;
  /** Word index for kind "word", -1 otherwise. */
  readonly word: number;
}

/** A rectangle in the box's CSS px. */
interface WordsPaintRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the box measured once per text, in its CSS px. */
export interface WordsPaintLayout {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** The text window: the rows the box shows, with the scrollbar slot. */
  readonly win: WordsPaintRect;
  /** The head row for the hint, or null when the box has none. */
  readonly head: WordsPaintRect | null;
  /** The words' font size (px): one em, 0.136 m on the plate. */
  readonly fontPx: number;
  readonly lineHeight: number;
  readonly rows: number;
  readonly lines: number;
  readonly fonts: {
    readonly word: string;
    readonly who: string;
    readonly disc: string;
    readonly hint: string;
  };
  readonly whoColor: string;
  /** Alpha of a word not yet said, and of the disclosure. */
  readonly grey: number;
  /** Alpha of the box's dark glass. */
  readonly tint: number;
  readonly runs: readonly WordsPaintRun[];
  /** Start time of each word, ms into the voice. */
  readonly startsMs: readonly number[];
}

/** What changes from frame to frame. */
export interface WordsPaintFrame {
  readonly voiceMs: number;
  /** The last word said, -1 before the first. */
  readonly lit: number;
  /** Scroll in lines. */
  readonly scroll: number;
  readonly scrubbing: boolean;
  readonly hint: string;
}

export interface WordsPaintModel {
  readonly layout: WordsPaintLayout;
  readonly frame: WordsPaintFrame;
}

/** The fade of a said word: it starts this long after the word... */
const FADE_DELAY_MS = 120;
/** ...and takes this long; a scrub lights a word in FADE_SCRUB_MS. */
const FADE_MS = 550;
const FADE_SCRUB_MS = 120;
/** A fade is painted in this many steps, so it costs 8 paints, not 33. */
const FADE_STEPS = 8;
const HINT_ALPHA = 0.7;
const TRACK_ALPHA = 0.1;
const THUMB_ALPHA = 0.5;
const THUMB_SCRUB_ALPHA = 0.9;
/** Where the alphabetic baseline sits under a line's middle, in ems,
 *  when the context reports no font metrics (a common sans's
 *  (ascent - descent) / 2). */
const FALLBACK_BASELINE_DROP_EM = 0.35;
const BAR_W = 3;
const BAR_INSET = 2;

function white(alpha: number): string {
  return `rgba(255,255,255,${String(Math.round(alpha * 1e4) / 1e4)})`;
}

/** The fade of word `i` in eighths: 0 grey .. FADE_STEPS white. */
function fadeStep(l: WordsPaintLayout, f: WordsPaintFrame, i: number): number {
  if (i > f.lit) return 0;
  const start = l.startsMs[i] ?? 0;
  const t = f.scrubbing
    ? (f.voiceMs - start) / FADE_SCRUB_MS
    : (f.voiceMs - start - FADE_DELAY_MS) / FADE_MS;
  return Math.round(Math.min(1, Math.max(0, t)) * FADE_STEPS);
}

/** The paint scale (device px a CSS px) for a screen's device pixel
 *  ratio: 2.5 to 3, so the plate stays sharp when the sign grows 1.6
 *  times and on a 3x phone, and the texture never outgrows a weak GPU on
 *  a 4x screen. A ratio that is not a finite number counts as 1. */
export function wordsPaintScale(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return Math.min(3, Math.max(2.5, dpr));
}

/** The canvas size in device px for a layout painted at `scale`. */
export function wordsCanvasSize(
  layout: WordsPaintLayout,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.ceil(layout.width * scale),
    height: Math.ceil(layout.height * scale),
  };
}

/**
 * A string that changes exactly when the painted image would: the lit
 * word, the fade steps of the fading tail, the scroll (to half a px), a
 * scrub and the hint. The layout is the caller's to compare (it changes
 * per text).
 *
 * The tail runs back from the lit word to the first word whose fade has
 * ended: the words start in order, so every word before that one ended
 * its fade earlier and can no longer change. The key's length is bounded
 * by the fade, not by the text.
 */
export function wordsPaintKey(
  layout: WordsPaintLayout,
  frame: WordsPaintFrame,
): string {
  let tail = "";
  for (let i = frame.lit; i >= 0; i--) {
    const step = fadeStep(layout, frame, i);
    tail += String(step);
    if (step === FADE_STEPS) break;
  }
  return [
    frame.lit,
    tail,
    Math.round(frame.scroll * layout.lineHeight * 2),
    frame.scrubbing ? 1 : 0,
    frame.hint,
  ].join("|");
}

function paintGlass(g: WordsPaintContext, l: WordsPaintLayout): void {
  const grad = g.createLinearGradient(0, 0, 0, l.height);
  grad.addColorStop(0, `rgba(52,58,80,${String(l.tint)})`);
  grad.addColorStop(1, `rgba(20,24,36,${String(l.tint)})`);
  g.beginPath();
  g.roundRect(0.5, 0.5, l.width - 1, l.height - 1, l.radius);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.26)";
  g.lineWidth = 1;
  g.stroke();
}

function runStyle(
  l: WordsPaintLayout,
  f: WordsPaintFrame,
  run: WordsPaintRun,
): { font: string; fill: string } {
  if (run.kind === "who") return { font: l.fonts.who, fill: l.whoColor };
  if (run.kind === "disc") return { font: l.fonts.disc, fill: white(l.grey) };
  const q = fadeStep(l, f, run.word) / FADE_STEPS;
  return { font: l.fonts.word, fill: white(l.grey + (1 - l.grey) * q) };
}

/** How far the words' alphabetic baseline sits under a line's middle:
 * the browser centres the font's ascent + descent on the line, so it is
 * (ascent - descent) / 2 of the word font. */
function baselineDrop(g: WordsPaintContext, l: WordsPaintLayout): number {
  g.font = l.fonts.word;
  const m = typeof g.measureText === "function" ? g.measureText("Hg") : null;
  const ascent = m?.fontBoundingBoxAscent;
  const descent = m?.fontBoundingBoxDescent;
  return ascent !== undefined &&
    descent !== undefined &&
    Number.isFinite(ascent) &&
    Number.isFinite(descent)
    ? (ascent - descent) / 2
    : FALLBACK_BASELINE_DROP_EM * l.fontPx;
}

/** Every run of a line on the line's one baseline, as in the box: the
 *  smaller disclosure sits on the words' baseline, not on its own middle. */
function paintRuns(
  g: WordsPaintContext,
  l: WordsPaintLayout,
  f: WordsPaintFrame,
): void {
  const { win, lineHeight: lh } = l;
  g.save();
  g.beginPath();
  g.rect(win.x, win.y, win.w, win.h);
  g.clip();
  const baseline = lh / 2 + baselineDrop(g, l);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  for (const run of l.runs) {
    const top = win.y + (run.line - f.scroll) * lh;
    if (top >= win.y + win.h || top + lh <= win.y) continue;
    const style = runStyle(l, f, run);
    g.font = style.font;
    g.fillStyle = style.fill;
    g.fillText(run.text, win.x + run.x, top + baseline);
  }
  g.restore();
}

function paintScrollbar(
  g: WordsPaintContext,
  l: WordsPaintLayout,
  f: WordsPaintFrame,
): void {
  if (l.lines <= l.rows) return;
  const x = l.win.x + l.win.w - BAR_W - 1;
  const y = l.win.y + BAR_INSET;
  const track = l.rows * l.lineHeight - 2 * BAR_INSET;
  const thumb = thumbGeometry(f.scroll, l.lines, l.rows, track);
  g.beginPath();
  g.roundRect(x, y, BAR_W, track, BAR_W / 2);
  g.fillStyle = white(TRACK_ALPHA);
  g.fill();
  g.beginPath();
  g.roundRect(x, y + thumb.offset, BAR_W, thumb.height, BAR_W / 2);
  g.fillStyle = white(f.scrubbing ? THUMB_SCRUB_ALPHA : THUMB_ALPHA);
  g.fill();
}

function paintHint(
  g: WordsPaintContext,
  l: WordsPaintLayout,
  f: WordsPaintFrame,
): void {
  if (l.head === null || f.hint === "") return;
  g.save();
  g.font = l.fonts.hint;
  g.fillStyle = white(HINT_ALPHA);
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.fillText(f.hint, l.head.x + l.head.w, l.head.y + l.head.h / 2);
  g.restore();
}

/**
 * Paints the box at `scale` device px per CSS px. The canvas must have
 * the size {@link wordsCanvasSize} gives.
 */
export function paintNarrationWords(
  g: WordsPaintContext,
  model: WordsPaintModel,
  scale: number,
): void {
  const { layout: l, frame: f } = model;
  g.save();
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, l.width, l.height);
  paintGlass(g, l);
  paintRuns(g, l, f);
  paintScrollbar(g, l, f);
  paintHint(g, l, f);
  g.restore();
}
