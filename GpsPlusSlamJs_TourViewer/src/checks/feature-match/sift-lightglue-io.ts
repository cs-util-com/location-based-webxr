/**
 * Input plumbing of the SIFT + LightGlue matcher: sift.js output as the
 * ten float inputs of the COLMAP `sift-lightglue.onnx` export (RootSIFT
 * descriptors, keypoints, image sizes, scales and orientations).
 *
 * @see sift-lightglue-io.ts.md
 */

const DIM = 128;

/** What sift.js `detectSift` returns, scale and orientation included. */
export interface SiftKeypoints {
  readonly n: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  /** Detection sigma in frame pixels. */
  readonly scale: ArrayLike<number>;
  /** Dominant orientation in radians, image y down. */
  readonly angle: ArrayLike<number>;
  /** RootSIFT, quantized: round(512 * sqrt(h / |h|_1)), 128 bytes a row. */
  readonly desc: Uint8Array;
}

/** The matcher's inputs, in the order the export declares them. */
export const LIGHTGLUE_SIFT_INPUTS = [
  "kpts0",
  "kpts1",
  "desc0",
  "desc1",
  "image_size0",
  "image_size1",
  "scales0",
  "scales1",
  "oris0",
  "oris1",
] as const;

/**
 * Unit-length RootSIFT rows from sift.js bytes. sift.js root-normalizes
 * before it quantizes, so only the quantization scale is undone (an L2
 * normalization, as COLMAP does); rooting again would distort it. An
 * all-zero row stays zero.
 *
 * @throws RangeError when `desc` holds fewer than `n` rows.
 */
export function rootSiftFloat(desc: Uint8Array, n: number): Float32Array {
  if (!Number.isInteger(n) || n < 0 || desc.length < n * DIM) {
    throw new RangeError(
      `descriptors: ${String(desc.length)} bytes for ${String(n)} rows`,
    );
  }
  const out = new Float32Array(n * DIM);
  for (let i = 0; i < n; i++) {
    let ss = 0;
    for (let k = 0; k < DIM; k++) {
      const v = desc[i * DIM + k]!;
      ss += v * v;
    }
    if (ss === 0) {
      continue;
    }
    const inv = 1 / Math.sqrt(ss);
    for (let k = 0; k < DIM; k++) {
      out[i * DIM + k] = desc[i * DIM + k]! * inv;
    }
  }
  return out;
}

/**
 * An angle in (-pi, pi], the range of the atan2 orientations COLMAP feeds
 * the matcher (sift.js gives [0, 2 pi)).
 *
 * @throws RangeError for a non-finite angle.
 */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) {
    throw new RangeError(`angle must be finite, got ${String(a)}`);
  }
  const twoPi = 2 * Math.PI;
  const w = Math.PI - ((((Math.PI - a) % twoPi) + twoPi) % twoPi);
  return w <= -Math.PI ? w + twoPi : w;
}

/** One frame's matcher inputs. */
export interface LightGlueSiftFrame {
  readonly count: number;
  /** x, y per keypoint, frame pixels, pixel centres at integers. */
  readonly keypoints: Float32Array;
  readonly descriptors: Float32Array;
  readonly scales: Float32Array;
  readonly oris: Float32Array;
  readonly width: number;
  readonly height: number;
}

function hasLength(v: ArrayLike<number> | undefined, n: number): boolean {
  return v !== undefined && v !== null && typeof v.length === "number"
    ? v.length >= n
    : false;
}

/**
 * A sift.js result as matcher inputs, cut to the first `max` keypoints
 * (strongest first). Positions are kept as they are: sift.js already puts
 * pixel centres at integers, the convention LightGlue reads (COLMAP
 * subtracts 0.5 from its own corner-origin keypoints to get there).
 *
 * @throws Error naming the field when a buffer is missing or short;
 *   RangeError for a non-positive frame size.
 */
export function lightGlueSiftFrame(
  r: SiftKeypoints,
  max: number,
  width: number,
  height: number,
): LightGlueSiftFrame {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(
      `frame size must be positive, got ${String(width)}x${String(height)}`,
    );
  }
  // Infinity keeps every keypoint.
  if (!(max >= 1) || (Number.isFinite(max) && !Number.isInteger(max))) {
    throw new RangeError(
      `max must be a whole number from 1 or Infinity, got ${String(max)}`,
    );
  }
  if (!Number.isInteger(r.n) || r.n < 0) {
    throw new Error(`sift.js: malformed result (n=${String(r.n)})`);
  }
  for (const [name, v] of [
    ["x", r.x],
    ["y", r.y],
    ["scale", r.scale],
    ["angle", r.angle],
  ] as const) {
    if (!hasLength(v, r.n)) {
      throw new Error(`sift.js: no ${name} for every keypoint`);
    }
  }
  const n = Math.min(r.n, max);
  const keypoints = new Float32Array(n * 2);
  const scales = new Float32Array(n);
  const oris = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    keypoints[i * 2] = r.x[i]!;
    keypoints[i * 2 + 1] = r.y[i]!;
    scales[i] = r.scale[i]!;
    oris[i] = wrapAngle(r.angle[i]!);
  }
  return {
    count: n,
    keypoints,
    descriptors: rootSiftFloat(r.desc, n),
    scales,
    oris,
    width,
    height,
  };
}

/** One named float input and its shape. */
export interface FloatFeed {
  readonly name: (typeof LIGHTGLUE_SIFT_INPUTS)[number];
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

/** The pair as the matcher's ten inputs, batch 1, image sizes as (w, h). */
export function lightGlueSiftFeeds(
  a: LightGlueSiftFrame,
  b: LightGlueSiftFrame,
): FloatFeed[] {
  const size = (f: LightGlueSiftFrame) => new Float32Array([f.width, f.height]);
  return [
    { name: "kpts0", data: a.keypoints, dims: [1, a.count, 2] },
    { name: "kpts1", data: b.keypoints, dims: [1, b.count, 2] },
    { name: "desc0", data: a.descriptors, dims: [1, a.count, DIM] },
    { name: "desc1", data: b.descriptors, dims: [1, b.count, DIM] },
    { name: "image_size0", data: size(a), dims: [1, 2] },
    { name: "image_size1", data: size(b), dims: [1, 2] },
    { name: "scales0", data: a.scales, dims: [1, a.count] },
    { name: "scales1", data: b.scales, dims: [1, b.count] },
    { name: "oris0", data: a.oris, dims: [1, a.count] },
    { name: "oris1", data: b.oris, dims: [1, b.count] },
  ];
}
