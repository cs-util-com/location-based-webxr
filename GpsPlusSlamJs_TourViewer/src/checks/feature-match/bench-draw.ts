/**
 * The benchmark's result picture: both frames side by side at one scale,
 * every keypoint as a dot and the matches as lines, drawn on a canvas of
 * bounded size.
 *
 * @see bench-draw.ts.md
 */
import { toFramePoint } from "./bench-image";
import type { SizeSample } from "./bench-run";

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the two frames go on the canvas; both share `scale`. */
export interface PairLayout {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Left edge of frame B. */
  readonly bx: number;
}

/**
 * Frames A and B side by side with `gap` pixels between them, both at the
 * one scale that fits the canvas in `maxWidth` (never enlarged), so a line
 * between them leans only as much as the scene does.
 */
export function sideBySide(
  a: Size,
  b: Size,
  maxWidth: number,
  gap: number,
): PairLayout {
  const scale = Math.min(1, Math.max(1, maxWidth - gap) / (a.width + b.width));
  const aw = Math.max(1, Math.round(a.width * scale));
  const bw = Math.max(1, Math.round(b.width * scale));
  const height = Math.max(1, Math.round(Math.max(a.height, b.height) * scale));
  return {
    width: Math.min(maxWidth, aw + gap + bw),
    height,
    scale,
    bx: aw + gap,
  };
}

/**
 * Which of `n` lines to draw when at most `cap` fit: all of them, or
 * `cap` spread evenly from the first, so a dense method stays readable and
 * the lines shown are not only the strongest.
 */
export function pickLines(n: number, cap: number): number[] {
  const count = Math.max(0, Math.min(n, Math.floor(cap)));
  return Array.from({ length: count }, (_, i) => Math.floor((i * n) / count));
}

/** The parts of a 2D canvas context the picture uses. */
export interface DrawContext {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  drawImage(image: never, x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

export interface MatchPicture {
  readonly layout: PairLayout;
  /** Anything the context can draw (a canvas holding the frame). */
  readonly imageA: unknown;
  readonly imageB: unknown;
  /** The frames as captured; the images are drawn at this size x scale. */
  readonly frameA: Size;
  readonly frameB: Size;
  /** The size the keypoints were computed at. */
  readonly size: Size;
  readonly sample: SizeSample;
  readonly lineCap: number;
}

const KEYPOINT_A = "#ffd400";
const KEYPOINT_B = "#00e0ff";

/**
 * Draws the picture and returns how many match lines it drew. Keypoints
 * are mapped from the size computed to the captured frame, then scaled;
 * a point at pixel centre v lands at (v + 0.5) x scale.
 */
export function drawMatches(ctx: DrawContext, p: MatchPicture): number {
  const { layout: l, size, sample } = p;
  const s = l.scale;
  const ax = (x: number) =>
    (toFramePoint(x, size.width, p.frameA.width) + 0.5) * s;
  const ay = (y: number) =>
    (toFramePoint(y, size.height, p.frameA.height) + 0.5) * s;
  const bx = (x: number) =>
    l.bx + (toFramePoint(x, size.width, p.frameB.width) + 0.5) * s;
  const by = (y: number) =>
    (toFramePoint(y, size.height, p.frameB.height) + 0.5) * s;
  ctx.drawImage(
    p.imageA as never,
    0,
    0,
    Math.round(p.frameA.width * s),
    Math.round(p.frameA.height * s),
  );
  ctx.drawImage(
    p.imageB as never,
    l.bx,
    0,
    Math.round(p.frameB.width * s),
    Math.round(p.frameB.height * s),
  );
  const dots = (
    pts: SizeSample["a"],
    fx: typeof ax,
    fy: typeof ay,
    colour: string,
  ) => {
    ctx.fillStyle = colour;
    for (let i = 0; i < pts.x.length; i++) {
      ctx.fillRect(fx(pts.x[i]!) - 1, fy(pts.y[i]!) - 1, 2, 2);
    }
  };
  dots(sample.a, ax, ay, KEYPOINT_A);
  dots(sample.b, bx, by, KEYPOINT_B);
  const picked = pickLines(sample.pairs.length / 2, p.lineCap);
  ctx.lineWidth = 1;
  for (const [k, m] of picked.entries()) {
    const ia = sample.pairs[2 * m]!;
    const ib = sample.pairs[2 * m + 1]!;
    // One hue per line, so crossing lines can be told apart.
    ctx.strokeStyle = `hsl(${String((k * 47) % 360)} 90% 55%)`;
    ctx.beginPath();
    ctx.moveTo(ax(sample.a.x[ia]!), ay(sample.a.y[ia]!));
    ctx.lineTo(bx(sample.b.x[ib]!), by(sample.b.y[ib]!));
    ctx.stroke();
  }
  return picked.length;
}
