/**
 * Host-side pre- and post-processing of the XFeat LiteRT model: the input
 * normalization, and the keypoints, scores and descriptors made from its
 * three dense output maps.
 *
 * @see xfeat-decode.ts.md
 */
import { fitInside } from "./bench-image";

/** The model's stride: one output cell per 8 x 8 input pixels. */
const CELL = 8;
/** Half the side of the non-maximum suppression window (5 x 5). */
const NMS_RADIUS = 2;

/** The input image size of a [1, H, W, 1] or [1, 1, H, W] input shape. */
export function xfeatInputSize(shape: ArrayLike<number>): {
  width: number;
  height: number;
} {
  const s = Array.from(shape);
  if (s.length === 4 && s[0] === 1 && s[3] === 1) {
    return { width: s[2]!, height: s[1]! };
  }
  if (s.length === 4 && s[0] === 1 && s[1] === 1) {
    return { width: s[3]!, height: s[2]! };
  }
  throw new Error(`unexpected XFeat input shape [${s.join(", ")}]`);
}

/**
 * The model input: the grey frame fitted (never enlarged) into the top-left
 * of a `width` x `height` image, normalized to zero mean and unit variance
 * over the frame, the padding 0 (the frame's mean after normalization).
 */
export function xfeatInput(
  gray: Float32Array,
  frameWidth: number,
  frameHeight: number,
  width: number,
  height: number,
): {
  data: Float32Array;
  validWidth: number;
  validHeight: number;
  scale: number;
} {
  const fit = fitInside(frameWidth, frameHeight, width, height);
  const vw = fit.width;
  const vh = fit.height;
  const data = new Float32Array(width * height);
  let sum = 0;
  for (let y = 0; y < vh; y++) {
    const sy = Math.min(
      frameHeight - 1,
      Math.floor(((y + 0.5) * frameHeight) / vh),
    );
    for (let x = 0; x < vw; x++) {
      const sx = Math.min(
        frameWidth - 1,
        Math.floor(((x + 0.5) * frameWidth) / vw),
      );
      const v = gray[sy * frameWidth + sx]!;
      data[y * width + x] = v;
      sum += v;
    }
  }
  const n = vw * vh;
  const mean = sum / n;
  let sq = 0;
  for (let y = 0; y < vh; y++) {
    for (let x = 0; x < vw; x++) {
      const d = data[y * width + x]! - mean;
      sq += d * d;
    }
  }
  const inv = 1 / Math.sqrt(sq / n + 1e-5);
  for (let y = 0; y < vh; y++) {
    for (let x = 0; x < vw; x++) {
      data[y * width + x] = (data[y * width + x]! - mean) * inv;
    }
  }
  return { data, validWidth: vw, validHeight: vh, scale: fit.scale };
}

/** A dense model output of one image: `channels` maps of height x width. */
export interface DenseMap {
  readonly data: Float32Array;
  readonly channels: number;
  readonly height: number;
  readonly width: number;
  readonly layout: "nchw" | "nhwc";
}

/** Wraps an output tensor, its layout told by where `channels` sits. */
export function denseMap(
  data: Float32Array,
  shape: ArrayLike<number>,
  channels: number,
): DenseMap {
  const s = Array.from(shape);
  if (s.length === 4 && s[1] === channels) {
    return { data, channels, height: s[2]!, width: s[3]!, layout: "nchw" };
  }
  if (s.length === 4 && s[3] === channels) {
    return { data, channels, height: s[1]!, width: s[2]!, layout: "nhwc" };
  }
  throw new Error(
    `no output with ${String(channels)} channels in shape [${s.join(", ")}]`,
  );
}

function at(m: DenseMap, c: number, y: number, x: number): number {
  return m.layout === "nchw"
    ? m.data[(c * m.height + y) * m.width + x]!
    : m.data[(y * m.width + x) * m.channels + c]!;
}

/** An IEEE 754 half float (its 16 bits) as a number. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) {
    return sign * frac * 2 ** -24;
  }
  if (exp === 0x1f) {
    return frac ? NaN : sign * Infinity;
  }
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** Keypoints in model input pixels and their L2-normalized descriptors. */
export interface XFeatPoints {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly desc: Float32Array;
  readonly dim: number;
}

/** Full-resolution keypoint probability: per-cell softmax over 65, dustbin dropped. */
function keypointHeat(logits: DenseMap): Float32Array {
  const W = logits.width * CELL;
  const heat = new Float32Array(W * logits.height * CELL);
  const p = new Float64Array(65);
  for (let cy = 0; cy < logits.height; cy++) {
    for (let cx = 0; cx < logits.width; cx++) {
      let max = -Infinity;
      for (let c = 0; c < 65; c++) {
        p[c] = at(logits, c, cy, cx);
        max = Math.max(max, p[c]!);
      }
      let sum = 0;
      for (let c = 0; c < 65; c++) {
        p[c] = Math.exp(p[c]! - max);
        sum += p[c]!;
      }
      for (let c = 0; c < 64; c++) {
        const y = cy * CELL + (c >> 3);
        const x = cx * CELL + (c & 7);
        heat[y * W + x] = p[c]! / sum;
      }
    }
  }
  return heat;
}

function isLocalMax(
  heat: Float32Array,
  W: number,
  H: number,
  x: number,
  y: number,
): boolean {
  const v = heat[y * W + x]!;
  for (let dy = -NMS_RADIUS; dy <= NMS_RADIUS; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= H) {
      continue;
    }
    for (let dx = -NMS_RADIUS; dx <= NMS_RADIUS; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < W && heat[yy * W + xx]! > v) {
        return false;
      }
    }
  }
  return true;
}

/** Bilinear sample of channel `c` at input pixel (x, y), cell centres aligned. */
function sampleAt(m: DenseMap, c: number, x: number, y: number): number {
  const fx = Math.min(m.width - 1, Math.max(0, (x + 0.5) / CELL - 0.5));
  const fy = Math.min(m.height - 1, Math.max(0, (y + 0.5) / CELL - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(m.width - 1, x0 + 1);
  const y1 = Math.min(m.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = at(m, c, y0, x0) * (1 - tx) + at(m, c, y0, x1) * tx;
  const bottom = at(m, c, y1, x0) * (1 - tx) + at(m, c, y1, x1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * XFeat's decoding: keypoint heat at full resolution, 5 x 5 suppression,
 * a floor on the heat, a score of heat x reliability, the `topK` best
 * inside the valid (unpadded) region, and their bilinear-sampled,
 * L2-normalized descriptors.
 */
export function decodeXFeat(
  feats: DenseMap,
  logits: DenseMap,
  reliability: DenseMap,
  opts: {
    topK: number;
    threshold: number;
    validWidth: number;
    validHeight: number;
  },
): XFeatPoints {
  const W = logits.width * CELL;
  const H = logits.height * CELL;
  const heat = keypointHeat(logits);
  const cand: { x: number; y: number; score: number }[] = [];
  const maxX = Math.min(W, opts.validWidth);
  const maxY = Math.min(H, opts.validHeight);
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < maxX; x++) {
      const v = heat[y * W + x]!;
      if (v > opts.threshold && isLocalMax(heat, W, H, x, y)) {
        cand.push({ x, y, score: v * sampleAt(reliability, 0, x, y) });
      }
    }
  }
  cand.sort((p, q) => q.score - p.score);
  const count = Math.min(Math.max(0, Math.floor(opts.topK)), cand.length);
  const dim = feats.channels;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const desc = new Float32Array(count * dim);
  for (let i = 0; i < count; i++) {
    const k = cand[i]!;
    x[i] = k.x;
    y[i] = k.y;
    let n2 = 0;
    for (let c = 0; c < dim; c++) {
      const v = sampleAt(feats, c, k.x, k.y);
      desc[i * dim + c] = v;
      n2 += v * v;
    }
    const inv = n2 > 0 ? 1 / Math.sqrt(n2) : 0;
    for (let c = 0; c < dim; c++) {
      desc[i * dim + c] = desc[i * dim + c]! * inv;
    }
  }
  return { count, x, y, desc, dim };
}
