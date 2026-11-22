/**
 * Input and output plumbing of the DINOv2-S/14 global descriptor: the
 * frame as the model's 224 x 224 input, its CLS token, and the cosine of
 * two descriptors.
 *
 * @see dino-io.ts.md
 */
import { resizeFrame, type Frame } from "./bench-image";
import { halfToFloat } from "./xfeat-decode";

/** The model's preprocessor config: shortest edge 256, centre crop 224. */
const DINO_RESIZE = 256;
export const DINO_CROP = 224;
export const DINO_MEAN = [0.485, 0.456, 0.406] as const;
export const DINO_STD = [0.229, 0.224, 0.225] as const;

/**
 * The frame as `pixel_values` (1 x 3 x 224 x 224, channels first): the
 * shortest edge resized to 256 (bilinear after box halving; the reference
 * preprocessor is bicubic), the centre 224 x 224 cropped, then each channel
 * scaled to 0..1 and normalized with the ImageNet mean and std.
 */
export function dinoInput(frame: Frame): Float32Array {
  const scale = DINO_RESIZE / Math.min(frame.width, frame.height);
  const w = Math.max(DINO_CROP, Math.round(frame.width * scale));
  const h = Math.max(DINO_CROP, Math.round(frame.height * scale));
  const sized = resizeFrame(frame, w, h);
  const x0 = Math.floor((w - DINO_CROP) / 2);
  const y0 = Math.floor((h - DINO_CROP) / 2);
  const n = DINO_CROP * DINO_CROP;
  const out = new Float32Array(3 * n);
  const s = sized.rgba;
  for (let y = 0; y < DINO_CROP; y++) {
    for (let x = 0; x < DINO_CROP; x++) {
      const src = ((y0 + y) * w + (x0 + x)) * 4;
      const dst = y * DINO_CROP + x;
      for (let c = 0; c < 3; c++) {
        out[c * n + dst] = (s[src + c]! / 255 - DINO_MEAN[c]!) / DINO_STD[c]!;
      }
    }
  }
  return out;
}

/**
 * The CLS token (the first) of `last_hidden_state`, shape [1, tokens, dim];
 * the model applies its final layer norm before this output.
 *
 * @throws Error when the shape and the data disagree.
 */
export function clsVector(
  data: Float32Array,
  dims: readonly number[],
): Float32Array {
  const [batch, tokens, dim] = dims;
  if (
    dims.length !== 3 ||
    batch !== 1 ||
    !tokens ||
    !dim ||
    data.length < tokens * dim
  ) {
    throw new Error(
      `DINOv2: unexpected output shape [${dims.join(", ")}] for ${String(data.length)} values`,
    );
  }
  return data.slice(0, dim);
}

/**
 * The cosine of two vectors; NaN when either is all zero.
 *
 * @throws RangeError for vectors of different length.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `vectors differ in length: ${String(a.length)} and ${String(b.length)}`,
    );
  }
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  if (aa === 0 || bb === 0) {
    return NaN;
  }
  return Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb)));
}

/**
 * Output data as float32: float32 as is, float16 (a `Float16Array`, or the
 * raw 16-bit values onnxruntime-web gives where that type is missing)
 * widened.
 *
 * @throws Error for any other data.
 */
export function floatValues(data: unknown): Float32Array {
  if (data instanceof Float32Array) {
    return data;
  }
  const f16 = (globalThis as { Float16Array?: new () => unknown }).Float16Array;
  if (f16 && data instanceof f16) {
    return Float32Array.from(data as ArrayLike<number>);
  }
  if (data instanceof Uint16Array) {
    return Float32Array.from(data, halfToFloat);
  }
  throw new Error("DINOv2: expected float32 or float16 output");
}
