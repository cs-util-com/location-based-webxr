/**
 * Frames and their resizing for the feature matching benchmark.
 *
 * @see bench-image.ts.md
 */

/** An RGBA image, row-major, 4 bytes per pixel. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/** @throws RangeError when the buffer does not hold width x height pixels. */
export function makeFrame(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Frame {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError(`bad frame size ${String(width)}x${String(height)}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(
      `frame buffer holds ${String(rgba.length)} bytes, ${String(width * height * 4)} expected`,
    );
  }
  return { width, height, rgba };
}

function isPositiveInteger(v: number): boolean {
  return Number.isInteger(v) && v > 0;
}

/**
 * The size whose long edge is `longEdge`, the aspect kept; with
 * `multiple` > 1 both sides are rounded to the nearest multiple (at least
 * one), for a model whose input must be divisible by its stride.
 *
 * @throws RangeError for a non-positive or non-finite argument.
 */
export function sizeForLongEdge(
  width: number,
  height: number,
  longEdge: number,
  multiple = 1,
): { width: number; height: number } {
  for (const v of [width, height, longEdge, multiple]) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`size arguments must be positive, got ${String(v)}`);
    }
  }
  const scale = longEdge / Math.max(width, height);
  const round = (v: number) =>
    Math.max(multiple, Math.round((v * scale) / multiple) * multiple);
  return { width: round(width), height: round(height) };
}

/**
 * The largest size of the frame's aspect that fits inside `maxW` x `maxH`
 * without upscaling (a model with a fixed input gets the frame padded,
 * never enlarged).
 */
export function fitInside(
  width: number,
  height: number,
  maxW: number,
  maxH: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxW / width, maxH / height);
  return {
    width: Math.min(maxW, Math.round(width * scale)),
    height: Math.min(maxH, Math.round(height * scale)),
    scale,
  };
}

/**
 * A coordinate in an image of size `fromSize` mapped to the same point in
 * the image resized to `toSize` (pixel centres at integers).
 */
export function toFramePoint(
  v: number,
  fromSize: number,
  toSize: number,
): number {
  return ((v + 0.5) * toSize) / fromSize - 0.5;
}

/**
 * Resizes a frame: halves with a 2x2 box while the target is less than
 * half the size (so a large shrink averages instead of aliasing), then
 * samples bilinearly.
 */
export function resizeFrame(
  frame: Frame,
  width: number,
  height: number,
): Frame {
  let src = frame;
  while (src.width >= 2 * width && src.height >= 2 * height) {
    src = halve(src);
  }
  if (src.width === width && src.height === height) {
    return src;
  }
  return bilinear(src, width, height);
}

function halve(frame: Frame): Frame {
  const w = frame.width >> 1;
  const h = frame.height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  const s = frame.rgba;
  const sw = frame.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = (2 * y * sw + 2 * x) * 4;
      const i1 = i0 + sw * 4;
      for (let c = 0; c < 4; c++) {
        out[(y * w + x) * 4 + c] =
          (s[i0 + c]! + s[i0 + 4 + c]! + s[i1 + c]! + s[i1 + 4 + c]! + 2) >> 2;
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

function bilinear(frame: Frame, width: number, height: number): Frame {
  const out = new Uint8ClampedArray(width * height * 4);
  const { width: sw, height: sh, rgba: s } = frame;
  for (let y = 0; y < height; y++) {
    const fy = clamp(toFramePoint(y, height, sh), 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = clamp(toFramePoint(x, width, sw), 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * sw + x0) * 4 + c]!;
        const b = s[(y0 * sw + x1) * 4 + c]!;
        const d = s[(y1 * sw + x0) * 4 + c]!;
        const e = s[(y1 * sw + x1) * 4 + c]!;
        const top = a + (b - a) * tx;
        const bottom = d + (e - d) * tx;
        out[(y * width + x) * 4 + c] = Math.round(top + (bottom - top) * ty);
      }
    }
  }
  return { width, height, rgba: out };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Grey in [0, 1], Rec. 601 luma weights. */
export function toGray(frame: Frame): Float32Array {
  const n = frame.width * frame.height;
  const g = new Float32Array(n);
  const s = frame.rgba;
  for (let i = 0; i < n; i++) {
    g[i] =
      (0.299 * s[i * 4]! + 0.587 * s[i * 4 + 1]! + 0.114 * s[i * 4 + 2]!) / 255;
  }
  return g;
}
