/**
 * The 2D media of a character's world views, drawn on canvases: the speech
 * bubble, the far name tag ("pip"), the pop-up's scroll, stage top and
 * backdrop, the blob shadow, and the die-cut front and back of the figure.
 * Ports of the station-blocks-7 prototype's painters
 * (`public/prototypes/station-blocks-7-character/`), at its scale: 1024 px
 * of a bubble or scroll is one metre, so 64 px text reads as 6.25 cm
 * letters. The pop-up's backdrop is the prototype's paper arch without its
 * keep (the keep was that tour's own building).
 *
 * The LAYOUT (word wrap, sizes, where the tail's tip sits) is pure and takes
 * a `measure` function, so it is tested without a canvas; the painters draw
 * what the layout says.
 *
 * @see character-canvas.ts.md
 */

/** The prototype's typefaces. */
const CHARACTER_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const CHARACTER_SERIF = 'ui-serif, Georgia, "Times New Roman", serif';

/** Width in px of `text` in `font` with `spacingPx` letter spacing. */
export type MeasureText = (
  text: string,
  font: string,
  spacingPx?: number,
) => number;

export type BubbleSide = "left" | "right";

/** A painted image and its size in px. */
export interface Painted {
  readonly image: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
}

/** A painted bubble or pip: also where its tail's tip sits (px from left). */
export interface PaintedTail extends Painted {
  readonly tipX: number;
}

export interface WrappedWord {
  readonly i: number;
  readonly x: number;
  readonly w: number;
}

/** Words split on white space (the line as the bubble shows it). */
export function wordsOf(line: string): string[] {
  return typeof line === "string" ? line.split(/\s+/).filter(Boolean) : [];
}

/** Greedy word wrap at `maxW` px (a word wider than that has a line alone). */
export function wrapWords(
  words: readonly string[],
  maxW: number,
  width: (text: string) => number,
): WrappedWord[][] {
  const space = width(" ");
  const lines: WrappedWord[][] = [];
  let cur: WrappedWord[] = [];
  let x = 0;
  words.forEach((word, i) => {
    const w = width(word);
    if (cur.length > 0 && x + space + w > maxW) {
      lines.push(cur);
      cur = [];
      x = 0;
    }
    const at = cur.length > 0 ? x + space : 0;
    cur.push({ i, x: at, w });
    x = at + w;
  });
  if (cur.length > 0) lines.push(cur);
  return lines;
}

const clamp = (v: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, v));

/** The bubble's measures (px), the prototype's. */
export const BUBBLE = {
  pad: 54,
  font: 64,
  lineH: 82,
  nameFont: 36,
  footFont: 38,
  tailH: 58,
  radius: 44,
  minW: 440,
  maxW: 1024,
} as const;

export interface BubbleContent {
  readonly name: string;
  readonly line: string;
  readonly footer: string | null;
  /** Keep a footer row even when there is no footer (no jump when one
   *  comes). */
  readonly reserveFooter: boolean;
  readonly side: BubbleSide;
}

export interface BubbleLayout {
  readonly w: number;
  readonly h: number;
  /** The body's height; the tail hangs below it. */
  readonly bodyH: number;
  readonly lines: WrappedWord[][];
  readonly tipX: number;
}

const bubbleFont = `500 ${String(BUBBLE.font)}px ${CHARACTER_SANS}`;
const nameFont = (px: number): string =>
  `700 ${String(px)}px ${CHARACTER_SANS}`;
const footFont = `500 ${String(BUBBLE.footFont)}px ${CHARACTER_SANS}`;

/** Where a bubble of `w` px puts its tail's tip on `side` (the prototype's
 *  `bubblePath`, drawn at x = 4). */
export function bubbleTipX(w: number, side: BubbleSide): number {
  return side === "left" ? 4 + (w - 8) - 26 : 4 + 26;
}

/** The bubble's size and wrap for `content`. */
export function bubbleLayout(
  content: BubbleContent,
  measure: MeasureText,
): BubbleLayout {
  const { pad, nameFont: nf, footFont: ff, lineH, tailH } = BUBBLE;
  const lines = wrapWords(wordsOf(content.line), 1024 - 2 * pad - 8, (t) =>
    measure(t, bubbleFont),
  );
  let maxLine = 0;
  for (const l of lines) {
    const e = l[l.length - 1]!;
    maxLine = Math.max(maxLine, e.x + e.w);
  }
  const nameW = measure(content.name.toUpperCase(), nameFont(nf), 4);
  const footW = content.footer ? measure(content.footer, footFont) : 0;
  const w = Math.ceil(
    clamp(
      Math.max(maxLine, nameW, footW) + 2 * pad + 8,
      BUBBLE.minW,
      BUBBLE.maxW,
    ),
  );
  const footerRow = content.reserveFooter || content.footer ? ff * 1.9 : 0;
  const bodyH = Math.ceil(
    pad * 0.78 + nf * 1.55 + lines.length * lineH + footerRow + pad * 0.5,
  );
  return {
    w,
    h: bodyH + tailH + 6,
    bodyH,
    lines,
    tipX: bubbleTipX(w, content.side),
  };
}

/** The pip's measures (px). */
export const PIP = {
  w: 560,
  h: 150,
  bodyH: 92,
  tailH: 44,
  radius: 40,
} as const;

/** The pip's plate width, its left edge and its tail's tip for `name`. */
export function pipLayout(
  name: string,
  side: BubbleSide,
  measure: MeasureText,
): { bx: number; bw: number; nameW: number; tipX: number } {
  const nameW = measure(name.toUpperCase(), nameFont(34), 4);
  const bw = Math.min(PIP.w - 8, nameW + 150);
  const bx = side === "left" ? PIP.w - 4 - bw : 4;
  const tipX = side === "left" ? bx + bw - 26 : bx + 26;
  return { bx, bw, nameW, tipX };
}

/** The scroll's measures (px). */
const SCROLL = { w: 1024, pad: 110, font: 58, lineH: 76 } as const;
const scrollFont = `500 ${String(SCROLL.font)}px ${CHARACTER_SERIF}`;

export function scrollLayout(
  line: string,
  footer: string | null,
  measure: MeasureText,
): { w: number; h: number; lines: WrappedWord[][] } {
  const lines = wrapWords(wordsOf(line), SCROLL.w - 2 * SCROLL.pad, (t) =>
    measure(t, scrollFont),
  );
  const h = Math.ceil(
    70 + lines.length * SCROLL.lineH + (footer ? 62 : 18) + 40,
  );
  return { w: SCROLL.w, h, lines };
}

/* ------------------------------------------------------------------ *
 * Painters (need a 2D canvas: a browser; covered by the views' e2e).  *
 * ------------------------------------------------------------------ */

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (ctx === null) throw new Error("no 2D canvas");
  return ctx;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measures with a shared 2D context (the browser's text metrics). */
const canvasMeasure: MeasureText = (text, font, spacingPx = 0) => {
  measureCtx ??= ctxOf(canvas(4, 4));
  measureCtx.font = font;
  measureCtx.letterSpacing = `${String(spacingPx)}px`;
  const w = measureCtx.measureText(text).width;
  measureCtx.letterSpacing = "0px";
  return w;
};

function tailPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  side: BubbleSide,
  tailH: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (side === "left") {
    ctx.lineTo(x + w - 64, y + h);
    ctx.lineTo(x + w - 26, y + h + tailH);
    ctx.lineTo(x + w - 128, y + h);
  } else {
    ctx.lineTo(x + 128, y + h);
    ctx.lineTo(x + 26, y + h + tailH);
    ctx.lineTo(x + 64, y + h);
  }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

const PLATE = "rgba(16,19,26,0.92)";
const PLATE_EDGE = "rgba(255,255,255,0.18)";
const GOLD = "#f2b84b";
const TEXT = "#f4efe6";
const MUTED = "#aaa498";
const INK = "#2b2118";

export function paintBubble(
  content: BubbleContent,
  measure: MeasureText = canvasMeasure,
): PaintedTail {
  const lay = bubbleLayout(content, measure);
  const { pad, nameFont: nf, lineH, tailH, radius } = BUBBLE;
  const c = canvas(lay.w, lay.h);
  const ctx = ctxOf(c);
  tailPath(ctx, 4, 4, lay.w - 8, lay.bodyH - 4, radius, content.side, tailH);
  ctx.fillStyle = PLATE;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PLATE_EDGE;
  ctx.stroke();
  ctx.font = nameFont(nf);
  ctx.letterSpacing = "4px";
  ctx.fillStyle = GOLD;
  ctx.textBaseline = "alphabetic";
  let y = pad * 0.78 + nf;
  ctx.fillText(content.name.toUpperCase(), pad, y);
  ctx.letterSpacing = "0px";
  ctx.font = bubbleFont;
  ctx.fillStyle = TEXT;
  y += nf * 0.55 + lineH * 0.82;
  const words = wordsOf(content.line);
  for (const l of lay.lines) {
    for (const t of l) ctx.fillText(words[t.i]!, pad + t.x, y);
    y += lineH;
  }
  if (content.footer) {
    ctx.font = footFont;
    ctx.fillStyle = MUTED;
    ctx.fillText(content.footer, pad, lay.bodyH - pad * 0.5 - 6);
  }
  return { image: c, w: lay.w, h: lay.h, tipX: lay.tipX };
}

export function paintPip(
  name: string,
  side: BubbleSide,
  measure: MeasureText = canvasMeasure,
): PaintedTail {
  const lay = pipLayout(name, side, measure);
  const c = canvas(PIP.w, PIP.h);
  const ctx = ctxOf(c);
  tailPath(ctx, lay.bx, 4, lay.bw, PIP.bodyH, PIP.radius, side, PIP.tailH);
  ctx.fillStyle = "rgba(16,19,26,0.9)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PLATE_EDGE;
  ctx.stroke();
  ctx.font = nameFont(34);
  ctx.letterSpacing = "4px";
  ctx.fillStyle = GOLD;
  ctx.textBaseline = "middle";
  ctx.fillText(name.toUpperCase(), lay.bx + 34, 52);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = TEXT;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(lay.bx + 34 + lay.nameW + 30 + i * 22, 54, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  return { image: c, w: PIP.w, h: PIP.h, tipX: lay.tipX };
}

/** Faint paper grain (a seeded pattern: the same every time). */
function paperGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  alpha: number,
): void {
  let s = seed * 9301;
  const rnd = (): number => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < (w * h) / 220; i++) {
    ctx.fillStyle = `rgba(90,70,40,${String(alpha * rnd())})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
  }
}

export function paintScroll(
  line: string,
  footer: string | null,
  measure: MeasureText = canvasMeasure,
): Painted {
  const lay = scrollLayout(line, footer, measure);
  const { w: W, h: H } = lay;
  const c = canvas(W, H);
  const ctx = ctxOf(c);
  ctx.fillStyle = "#f2e8d0";
  ctx.beginPath();
  ctx.roundRect(46, 10, W - 92, H - 20, 10);
  ctx.fill();
  paperGrain(ctx, W, H, 5, 0.09);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(46, 10, W - 92, H - 20, 10);
  ctx.stroke();
  for (const x0 of [8, W - 64]) {
    const g = ctx.createLinearGradient(x0, 0, x0 + 56, 0);
    g.addColorStop(0, "#b89a6a");
    g.addColorStop(0.45, "#f4ead4");
    g.addColorStop(1, "#a8885a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x0, 0, 56, H, 22);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.font = scrollFont;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  const words = wordsOf(line);
  let y = 60 + SCROLL.font * 0.8;
  for (const l of lay.lines) {
    const last = l[l.length - 1]!;
    const x0 = (W - (last.x + last.w)) / 2;
    for (const t of l) ctx.fillText(words[t.i]!, x0 + t.x, y);
    y += SCROLL.lineH;
  }
  if (footer) {
    ctx.font = `italic 36px ${CHARACTER_SERIF}`;
    ctx.fillStyle = "rgba(43,33,24,0.65)";
    ctx.textAlign = "center";
    ctx.fillText(footer, W / 2, H - 42);
    ctx.textAlign = "left";
  }
  return { image: c, w: W, h: H };
}

/** The pop-up's base top: paper, a double border, the name in capitals. */
export function paintStageTop(name: string): Painted {
  const W = 1024;
  const H = 560;
  const c = canvas(W, H);
  const x = ctxOf(c);
  x.fillStyle = "#efe4cb";
  x.fillRect(0, 0, W, H);
  paperGrain(x, W, H, 7, 0.08);
  x.strokeStyle = INK;
  x.lineWidth = 6;
  x.strokeRect(22, 22, W - 44, H - 44);
  x.lineWidth = 2.5;
  x.strokeRect(38, 38, W - 76, H - 76);
  x.fillStyle = INK;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `600 58px ${CHARACTER_SERIF}`;
  x.letterSpacing = "8px";
  x.fillText(name.toUpperCase(), W / 2, H - 120);
  x.letterSpacing = "0px";
  x.lineWidth = 2.5;
  x.beginPath();
  x.moveTo(140, H - 70);
  x.lineTo(W - 140, H - 70);
  x.stroke();
  x.save();
  x.translate(W / 2, H - 70);
  x.rotate(Math.PI / 4);
  x.fillRect(-7, -7, 14, 14);
  x.restore();
  return { image: c, w: W, h: H };
}

/** The pop-up's backdrop: a paper arch with sky, ground and a horizon. */
export function paintBackdrop(): Painted {
  const W = 1024;
  const H = 1080;
  const c = canvas(W, H);
  const x = ctxOf(c);
  const arch = (): void => {
    x.beginPath();
    x.moveTo(36, H - 4);
    x.lineTo(36, 430);
    x.bezierCurveTo(36, 120, 300, 30, 512, 30);
    x.bezierCurveTo(724, 30, 988, 120, 988, 430);
    x.lineTo(988, H - 4);
    x.closePath();
  };
  arch();
  x.fillStyle = "#f0e6cf";
  x.fill();
  x.save();
  arch();
  x.clip();
  let g = x.createLinearGradient(0, 30, 0, 700);
  g.addColorStop(0, "rgba(150,180,200,0.55)");
  g.addColorStop(1, "rgba(150,180,200,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  g = x.createLinearGradient(0, 820, 0, H);
  g.addColorStop(0, "rgba(200,160,90,0)");
  g.addColorStop(1, "rgba(200,160,90,0.6)");
  x.fillStyle = g;
  x.fillRect(0, 780, W, H);
  paperGrain(x, W, H, 3, 0.08);
  x.lineJoin = "round";
  x.lineCap = "round";
  x.strokeStyle = INK;
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(36, 900);
  x.lineTo(988, 900);
  x.stroke();
  x.lineWidth = 3;
  for (const [bx, by] of [
    [230, 250],
    [262, 230],
    [770, 210],
    [806, 236],
  ] as const) {
    x.beginPath();
    x.moveTo(bx - 14, by - 6);
    x.quadraticCurveTo(bx - 6, by - 8, bx, by);
    x.quadraticCurveTo(bx + 6, by - 8, bx + 14, by - 6);
    x.stroke();
  }
  x.restore();
  arch();
  x.strokeStyle = INK;
  x.lineWidth = 8;
  x.stroke();
  x.save();
  x.translate(512, H / 2);
  x.scale(0.955, 0.965);
  x.translate(-512, -H / 2);
  arch();
  x.lineWidth = 3;
  x.stroke();
  x.restore();
  return { image: c, w: W, h: H };
}

/** A soft elliptic shadow for under his feet. */
export function paintBlob(): Painted {
  const c = canvas(256, 128);
  const x = ctxOf(c);
  const g = x.createRadialGradient(128, 64, 4, 128, 64, 64);
  g.addColorStop(0, "rgba(20,20,24,0.42)");
  g.addColorStop(1, "rgba(20,20,24,0)");
  x.setTransform(2, 0, 0, 1, 0, 0);
  x.fillStyle = g;
  x.beginPath();
  x.arc(64, 64, 64, 0, Math.PI * 2);
  x.fill();
  return { image: c, w: 256, h: 128 };
}

/** The beckon's gold chevrons, four pointing up (the top runs toward the
 *  next station); the texture repeats along its height and scrolls. */
export function paintChevrons(): Painted {
  const c = canvas(128, 512);
  const x = ctxOf(c);
  for (let i = 0; i < 4; i++) {
    const y = 40 + i * 128;
    x.beginPath();
    x.moveTo(18, y + 64);
    x.lineTo(64, y + 16);
    x.lineTo(110, y + 64);
    x.lineTo(110, y + 92);
    x.lineTo(64, y + 44);
    x.lineTo(18, y + 92);
    x.closePath();
    x.fillStyle = "#f2b84b";
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "rgba(40,26,6,0.55)";
    x.stroke();
  }
  return { image: c, w: 128, h: 512 };
}

/** The chevrons' alpha: faded in at the start and out at the end. */
export function paintFade(): Painted {
  const c = canvas(8, 256);
  const x = ctxOf(c);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#000");
  g.addColorStop(0.25, "#fff");
  g.addColorStop(0.7, "#fff");
  g.addColorStop(1, "#000");
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 256);
  return { image: c, w: 8, h: 256 };
}

/** The tallest die-cut figure drawn (px); a larger image is scaled down. */
const FIGURE_MAX_PX = 1024;

/** The die-cut margin for a figure `h` px high (the prototype's 14 px of
 *  1024), at least 3 px. */
export function dieCutPad(h: number): number {
  return Math.max(3, Math.round((14 / 1024) * h));
}

export interface PaintedFigure {
  readonly front: HTMLCanvasElement;
  readonly back: HTMLCanvasElement;
  /** The figure's own size (px) inside the canvases. */
  readonly figureW: number;
  readonly figureH: number;
  /** The die-cut margin around it on every side (px). */
  readonly pad: number;
}

/** A source the painter draws (the decoded figure). */
export type FigureSource = CanvasImageSource & {
  readonly width: number;
  readonly height: number;
};

function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const x = ctxOf(c);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function stamp(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  r: number,
  n = 28,
): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.drawImage(img, Math.cos(a) * r, Math.sin(a) * r);
  }
}

/**
 * The figure as a die-cut card: a soft dark edge, a white cut edge, then
 * the figure (front); the same edge around a card-brown back with board
 * grain (back). Scaled to at most `FIGURE_MAX_PX` high.
 */
export function paintFigure(source: FigureSource): PaintedFigure {
  const scale =
    source.height > FIGURE_MAX_PX ? FIGURE_MAX_PX / source.height : 1;
  const fw = Math.max(1, Math.round(source.width * scale));
  const fh = Math.max(1, Math.round(source.height * scale));
  const pad = dieCutPad(fh);
  const W = fw + 2 * pad;
  const H = fh + 2 * pad;
  const fig = canvas(W, H);
  ctxOf(fig).drawImage(source, pad, pad, fw, fh);
  const dark = silhouette(fig, "rgba(20,18,16,0.5)");
  const white = silhouette(fig, "#fbf8f2");
  const card = silhouette(fig, "#a98c66");
  const rDark = pad;
  const rWhite = Math.max(2, Math.round((pad * 10) / 14));
  const front = canvas(W, H);
  const f = ctxOf(front);
  stamp(f, dark, rDark);
  stamp(f, white, rWhite);
  f.drawImage(fig, 0, 0);
  const back = canvas(W, H);
  const b = ctxOf(back);
  stamp(b, dark, rDark);
  stamp(b, white, rWhite);
  b.drawImage(card, 0, 0);
  b.globalCompositeOperation = "source-atop";
  b.strokeStyle = "rgba(80,60,40,0.25)";
  b.lineWidth = 2;
  for (let y = 0; y < H; y += 9) {
    b.beginPath();
    b.moveTo(0, y);
    b.lineTo(W, y + 3);
    b.stroke();
  }
  return { front, back, figureW: fw, figureH: fh, pad };
}
