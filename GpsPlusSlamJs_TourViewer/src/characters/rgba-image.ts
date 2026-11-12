/**
 * The picture shape the character-sheet cut works on: width, height and
 * RGBA bytes, row-major, four per pixel. `ImageData` has this shape, so a
 * decoded canvas passes straight in; a Node test builds one from a typed
 * array. Also the one resampler the cut uses, so scaling needs no canvas.
 *
 * @see rgba-image.ts.md
 */

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes, R G B A per pixel. */
  readonly data: Uint8ClampedArray;
}

/** A transparent picture of `width` x `height`. */
export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Accumulates one source pixel, weighted, into premultiplied sums. */
function addPixel(
  acc: Float64Array,
  src: Uint8ClampedArray,
  p: number,
  weight: number,
): void {
  const a = (src[p + 3]! / 255) * weight;
  acc[0] = acc[0]! + src[p]! * a;
  acc[1] = acc[1]! + src[p + 1]! * a;
  acc[2] = acc[2]! + src[p + 2]! * a;
  acc[3] = acc[3]! + a;
  acc[4] = acc[4]! + weight;
}

/**
 * Area-averages the rectangle `sx, sy, sw, sh` of `src` into the rectangle
 * `dx, dy, dw, dh` of `dst` (fractional source and target edges are
 * weighted by their overlap). Colours are averaged premultiplied by alpha,
 * so a transparent pixel's colour never bleeds into the edge. Target pixels
 * outside `dst` are skipped; target pixels the rectangle does not cover are
 * left as they are.
 */
export function drawScaled(
  src: RgbaImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dst: RgbaImage,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) {
    return;
  }
  const kx = sw / dw;
  const ky = sh / dh;
  const acc = new Float64Array(5);
  const tx0 = Math.max(0, Math.floor(dx));
  const ty0 = Math.max(0, Math.floor(dy));
  const tx1 = Math.min(dst.width, Math.ceil(dx + dw));
  const ty1 = Math.min(dst.height, Math.ceil(dy + dh));
  for (let ty = ty0; ty < ty1; ty++) {
    // The target pixel's span inside the target rectangle, mapped to source.
    const v0 = Math.max(ty, dy);
    const v1 = Math.min(ty + 1, dy + dh);
    if (v1 <= v0) {
      continue;
    }
    const ys0 = sy + (v0 - dy) * ky;
    const ys1 = sy + (v1 - dy) * ky;
    for (let tx = tx0; tx < tx1; tx++) {
      const u0 = Math.max(tx, dx);
      const u1 = Math.min(tx + 1, dx + dw);
      if (u1 <= u0) {
        continue;
      }
      const xs0 = sx + (u0 - dx) * kx;
      const xs1 = sx + (u1 - dx) * kx;
      acc.fill(0);
      accumulate(src, xs0, xs1, ys0, ys1, acc);
      // The share of the target pixel the rectangle covers.
      const cover = (v1 - v0) * (u1 - u0);
      writePixel(dst, (ty * dst.width + tx) * 4, acc, cover);
    }
  }
}

/** Sums the source area `[xs0, xs1) x [ys0, ys1)` into `acc`. */
function accumulate(
  src: RgbaImage,
  xs0: number,
  xs1: number,
  ys0: number,
  ys1: number,
  acc: Float64Array,
): void {
  const yA = Math.max(0, Math.floor(ys0));
  const yB = Math.min(src.height, Math.ceil(ys1));
  const xA = Math.max(0, Math.floor(xs0));
  const xB = Math.min(src.width, Math.ceil(xs1));
  for (let y = yA; y < yB; y++) {
    const wy = Math.min(y + 1, ys1) - Math.max(y, ys0);
    if (wy <= 0) {
      continue;
    }
    for (let x = xA; x < xB; x++) {
      const wx = Math.min(x + 1, xs1) - Math.max(x, xs0);
      if (wx > 0) {
        addPixel(acc, src.data, (y * src.width + x) * 4, wx * wy);
      }
    }
  }
}

/** Writes the averaged pixel, composited over what `dst` holds when the
 *  rectangle covers only part of the target pixel. */
function writePixel(
  dst: RgbaImage,
  p: number,
  acc: Float64Array,
  cover: number,
): void {
  const weight = acc[4]!;
  if (weight <= 0) {
    return;
  }
  const a = (acc[3]! / weight) * cover;
  const d = dst.data;
  const under = d[p + 3]! / 255;
  const outA = a + under * (1 - a);
  if (outA <= 0) {
    d[p + 3] = 0;
    return;
  }
  for (let c = 0; c < 3; c++) {
    const mine = acc[3]! > 0 ? acc[c]! / acc[3]! : 0;
    d[p + c] = (mine * a + d[p + c]! * under * (1 - a)) / outA;
  }
  d[p + 3] = Math.round(outA * 255);
}

/** `img` scaled by `k` (both sides rounded), area-averaged. */
export function scaledImage(img: RgbaImage, k: number): RgbaImage {
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const out = blankImage(w, h);
  drawScaled(img, 0, 0, img.width, img.height, out, 0, 0, w, h);
  return out;
}
