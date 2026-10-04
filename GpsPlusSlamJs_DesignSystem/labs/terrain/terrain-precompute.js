/**
 * The terrain lab's per-region precompute (terrain plan 2026-09-27-0605 §4
 * "Precompute", §9 findings 13-14; research 2026-09-27-0600 §6-§7): the
 * gradient, the local relief at a large and a small scale, the relief
 * spread, the sky-view factor, and their packing into the two textures the
 * shader reads.
 *
 * WHY ON THE CPU, from full-precision heights: half floats step 1 m at
 * 1024-2048 m, which differenced over 500 m posts is a slope error the
 * slope boost then multiplies (research §4.3). The shader reads slopes, it
 * never derives them.
 *
 * Grids are row-major, `side * side`, row 0 at the SOUTH edge (the order
 * OsmDemo's `buildHeightfieldData` samples in), columns west to east.
 * Dependency-free, so it runs in the worker and under `node --test`.
 *
 * @see terrain-precompute.js.md
 */

/**
 * The RGBA8 texture's encodings, shared with the shader's decode.
 * - R: the relief spread (standard deviation, m) / `reliefStdSpanM`;
 * - G: the small-scale relief, signed about 128, `reliefSmallMPerStep` m a
 *   step (so +-256 m);
 * - B: the sky-view factor, 0-1;
 * - A: 255 where the height is data, 0 where it is the heightfield's fill.
 */
export const AUX_ENCODING = Object.freeze({
  reliefStdSpanM: 1000,
  reliefSmallMPerStep: 2,
});

const clampIndex = (i, side) => (i < 0 ? 0 : i >= side ? side - 1 : i);

/**
 * The height gradient in metres per metre: `gx` east, `gy` north. Sobel's
 * smoothing (1-2-1 across the difference), with a one-sided difference on
 * the outer rows and columns, so a plane comes back exactly everywhere.
 *
 * @param {ArrayLike<number>} h
 * @param {number} side
 * @param {number} spacingM
 */
export function gradient(h, side, spacingM) {
  const gx = new Float32Array(side * side);
  const gy = new Float32Array(side * side);
  const last = side - 1;
  const dx = (c, r) => {
    const row = r * side;
    if (c === 0) return (h[row + 1] - h[row]) / spacingM;
    if (c === last) return (h[row + last] - h[row + last - 1]) / spacingM;
    return (h[row + c + 1] - h[row + c - 1]) / (2 * spacingM);
  };
  const dy = (c, r) => {
    if (r === 0) return (h[side + c] - h[c]) / spacingM;
    if (r === last)
      return (h[last * side + c] - h[(last - 1) * side + c]) / spacingM;
    return (h[(r + 1) * side + c] - h[(r - 1) * side + c]) / (2 * spacingM);
  };
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const up = clampIndex(r + 1, side);
      const down = clampIndex(r - 1, side);
      const right = clampIndex(c + 1, side);
      const left = clampIndex(c - 1, side);
      gx[r * side + c] = (dx(c, down) + 2 * dx(c, r) + dx(c, up)) / 4;
      gy[r * side + c] = (dy(left, r) + 2 * dy(c, r) + dy(right, r)) / 4;
    }
  }
  return { gx, gy };
}

/** One box pass of radius `radius` along rows (`axis` 0) or columns (1). */
function boxPass(src, side, radius, axis) {
  const out = new Float64Array(side * side);
  const width = 2 * radius + 1;
  for (let a = 0; a < side; a++) {
    for (let b = 0; b < side; b++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = clampIndex(b + k, side);
        sum += axis === 0 ? src[a * side + j] : src[j * side + a];
      }
      out[axis === 0 ? a * side + b : b * side + a] = sum / width;
    }
  }
  return out;
}

/**
 * A Gaussian blur of standard deviation `sigmaTexels`, approximated by
 * three box passes per axis (the box width for which three passes have
 * that variance), edges clamped. A constant field stays exactly constant.
 *
 * @returns {Float64Array}
 */
export function gaussianBlur(h, side, sigmaTexels) {
  const radius = Math.max(
    0,
    Math.round((Math.sqrt(4 * sigmaTexels * sigmaTexels + 1) - 1) / 2),
  );
  let out = Float64Array.from(h);
  for (let pass = 0; pass < 3; pass++) {
    out = boxPass(boxPass(out, side, radius, 0), side, radius, 1);
  }
  return out;
}

/** The height above (+) or below (-) its blurred surroundings, metres. */
export function localRelief(h, side, sigmaTexels) {
  const blurred = gaussianBlur(h, side, sigmaTexels);
  const out = new Float32Array(side * side);
  for (let i = 0; i < out.length; i++) out[i] = h[i] - blurred[i];
  return out;
}

/**
 * The standard deviation of height within the blur's footprint, metres:
 * how rugged the land around a point is (research §6.1's `reliefStd`, which
 * drives style A's green). In doubles: the variance is a small difference
 * of large squares.
 */
export function reliefStd(h, side, sigmaTexels) {
  const squares = new Float64Array(side * side);
  for (let i = 0; i < squares.length; i++) squares[i] = h[i] * h[i];
  const mean = gaussianBlur(h, side, sigmaTexels);
  const meanOfSquares = gaussianBlur(squares, side, sigmaTexels);
  const out = new Float32Array(side * side);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sqrt(Math.max(0, meanOfSquares[i] - mean[i] * mean[i]));
  }
  return out;
}

/**
 * The sky-view factor (Zakšek et al. 2011): `1 - mean(sin(horizon angle))`
 * over `directions` azimuths, each marched `steps` posts outwards, the
 * horizon angle floored at 0. Flat ground is exactly 1, a valley floor less.
 * A march stops at the grid's edge (beyond is unknown, read as open sky), so
 * the padding ring should be at least `steps` posts wide.
 *
 * @param {{ directions: number, steps: number }} options
 */
export function skyView(h, side, spacingM, { directions, steps }) {
  const out = new Float32Array(side * side);
  // Each direction's march, precomputed once: the post offset of every step
  // and 1 / its distance. The marched posts are the same for every origin,
  // so the inner loop is an index, a subtraction and a multiply. The first
  // version, with a rounding and two hypots per step, took 6.6 s in the lab's
  // worker at 545 x 545 posts, 8 x 16 (headless Chromium, a loaded machine).
  const n = directions * steps;
  const dc = new Int32Array(n);
  const dr = new Int32Array(n);
  const invDist = new Float64Array(n);
  for (let d = 0; d < directions; d++) {
    const angle = (2 * Math.PI * d) / directions;
    for (let k = 1; k <= steps; k++) {
      const i = d * steps + k - 1;
      dc[i] = Math.round(Math.cos(angle) * k);
      dr[i] = Math.round(Math.sin(angle) * k);
      invDist[i] = 1 / (Math.hypot(dc[i], dr[i]) * spacingM);
    }
  }
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const h0 = h[r * side + c];
      let sinSum = 0;
      for (let d = 0; d < directions; d++) {
        // The steepest tangent along the march; sin = t / sqrt(1 + t²).
        let maxTan = 0;
        for (let i = d * steps, end = i + steps; i < end; i++) {
          const cc = c + dc[i];
          const rr = r + dr[i];
          if (cc < 0 || rr < 0 || cc >= side || rr >= side) break;
          const t = (h[rr * side + cc] - h0) * invDist[i];
          if (t > maxTan) maxTan = t;
        }
        sinSum += maxTan / Math.sqrt(1 + maxTan * maxTan);
      }
      out[r * side + c] = 1 - sinSum / directions;
    }
  }
  return out;
}

const byte = (v) => Math.min(255, Math.max(0, Math.round(v)));

/**
 * The two textures' bytes (plan §4, §9 finding 13): RGBA16F as half-float
 * bits (R height, G gradient east, B gradient north, A local relief) and
 * RGBA8 per `AUX_ENCODING`. `toHalf` is three's `DataUtils.toHalfFloat`,
 * injected so this module stays dependency-free. `svf` may be null before
 * the sky view is computed: it packs as 1 (open sky, no darkening).
 *
 * @param {{ height: Float32Array, gx: Float32Array, gy: Float32Array,
 *   relief: Float32Array, reliefStd: Float32Array, reliefSmall: Float32Array,
 *   svf: Float32Array | null, valid: Uint8Array }} f
 * @param {number} side
 * @param {(v: number) => number} toHalf
 */
export function packTerrain(f, side, toHalf) {
  const n = side * side;
  const rgba16 = new Uint16Array(n * 4);
  const rgba8 = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgba16[i * 4] = toHalf(f.height[i]);
    rgba16[i * 4 + 1] = toHalf(f.gx[i]);
    rgba16[i * 4 + 2] = toHalf(f.gy[i]);
    rgba16[i * 4 + 3] = toHalf(f.relief[i]);
    rgba8[i * 4] = byte((f.reliefStd[i] / AUX_ENCODING.reliefStdSpanM) * 255);
    rgba8[i * 4 + 1] = byte(
      128 + f.reliefSmall[i] / AUX_ENCODING.reliefSmallMPerStep,
    );
    rgba8[i * 4 + 2] = f.svf === null ? 255 : byte(f.svf[i] * 255);
    rgba8[i * 4 + 3] = f.valid[i] ? 255 : 0;
  }
  return { rgba16, rgba8 };
}
