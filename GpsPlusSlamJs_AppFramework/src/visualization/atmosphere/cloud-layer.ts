/**
 * The cheap 2D cloud layer (plan 2026-09-23-0048, DEC-SKY-6): a seeded,
 * tileable noise texture projected onto a horizontal plane ~2 km up, turned
 * into density by the cloud cover, lit by the sun's transmitted colour in the
 * sky pass, faded out toward the horizon.
 *
 * WHAT LIVES HERE: the pure parts, tested on the CPU. `cloudDensity` and
 * `cloudHorizonFade` have GLSL twins (`atmCloudDensity`,
 * `atmCloudHorizonFade` in `atmosphere-glsl.ts`); the noise is baked once
 * into a texture by `createCloudTexture`.
 *
 * TILEABLE BY CONSTRUCTION: every octave's lattice is wrapped at a whole
 * number of cells per tile, so `cloudNoiseAt(x + size, y) === cloudNoiseAt(x,
 * y)`. The plane repeats the tile thousands of times toward the horizon; a
 * seam would be drawn every time.
 *
 * Value-noise FBM, not a physical cloud model: it is a sky dressing, and
 * volumetric clouds were explicitly out of scope (the owner chose the 2D
 * layer).
 *
 * @see cloud-layer.ts.md
 */

import * as THREE from 'three';

import { clamp01 } from '../../utils/clamp01.js';
import type { Rgb } from './atmosphere-model.js';
import { hexTiledSample } from './cloud-hex.js';
import { smoothstep } from '../../utils/smoothstep.js';

/** Texture edge length, texels. Power of two for mipmaps. */
export const CLOUD_TEXTURE_SIZE = 256;

/**
 * The cloud layer's geometry, sampling and lighting constants. The GLSL
 * receives every one of them from here (plan §3: numbers live in TS).
 */
export const CLOUD_LAYER = {
  altitudeKm: 2,
  /** Ground distance one texture tile covers, km. */
  tileKm: 24,
  /**
   * Second octave: the texture sampled again at this INTEGER frequency (so
   * the combination stays periodic with the tile and drift can wrap without
   * a jump) plus an offset, and blended with these weights.
   */
  secondOctaveFrequency: 3,
  secondOctaveOffset: 0.37,
  firstOctaveWeight: 0.7,
  /** Half-width of the soft cloud edge, in noise units around the threshold. */
  edgeHalfWidth: 0.08,
  /** Sunlit share at 90° from the sun, and the extra forward scattering toward it. */
  sunAmbient: 0.06,
  forwardStrength: 0.5,
  forwardPower: 8,
  /** How much the densest cloud darkens its own sunlit side. */
  thicknessDarkening: 0.45,
  /** Share of the zenith sky's radiance a cloud reflects as ambient light. */
  skyAmbient: 0.9,
  /** Distance over which clouds melt into the sky behind them, km. */
  aerialKm: 60,
} as const;

const OCTAVES = 5;
const BASE_CELLS = 4;

/** Deterministic lattice value in [0, 1). */
function lattice(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hermite fade on [0, 1] (the package's smoothstep with unit edges). */
function fade(t: number): number {
  return smoothstep(0, 1, t);
}

/** Value noise with a lattice of `cells` per `size`, wrapped: periodic in `size`. */
function periodicValueNoise(
  x: number,
  y: number,
  size: number,
  cells: number,
  seed: number
): number {
  const fx = (x / size) * cells;
  const fy = (y / size) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fade(fx - x0);
  const ty = fade(fy - y0);
  const wrap = (i: number) => ((i % cells) + cells) % cells;
  const v = (i: number, j: number) => lattice(wrap(i), wrap(j), seed);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

/**
 * Tileable fractal noise at (x, y) in texel units, periodic in `size`, in
 * [0, 1]. Five octaves of value noise, contrast-stretched so the texture is
 * not a uniform grey veil.
 */
export function cloudNoiseAt(
  x: number,
  y: number,
  size: number,
  seed: number
): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < OCTAVES; octave++) {
    sum +=
      amplitude *
      periodicValueNoise(x, y, size, BASE_CELLS << octave, seed + octave);
    total += amplitude;
    amplitude *= 0.5;
  }
  return clamp01((sum / total - 0.5) * 2.2 + 0.5);
}

const noiseCache = new Map<string, Uint8Array>();

/**
 * The noise as 8-bit texture data, `size × size`, row-major. CACHED per
 * (size, seed): 256² × 5 octaves costs ~100–150 ms on a desktop CPU and
 * several times that on a phone, and every SkyAtmosphere needs it (M2 review,
 * finding 9). Treat the result as read-only.
 */
export function cloudNoise(size: number, seed: number): Uint8Array {
  const key = `${size}:${seed}`;
  const cached = noiseCache.get(key);
  if (cached !== undefined) return cached;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] = Math.round(
        cloudNoiseAt(x + 0.5, y + 0.5, size, seed) * 255
      );
    }
  }
  noiseCache.set(key, data);
  return data;
}

/**
 * The two-octave noise the sky shader actually samples, per texel of the
 * base tile (the second lookup taken at the nearest texel). Its distribution
 * is narrower than one octave's, which is why cover must be mapped through
 * it rather than applied to the raw noise.
 */
export function combinedCloudNoise(
  data: Uint8Array,
  size: number
): Float32Array {
  const c = CLOUD_LAYER;
  const offset = c.secondOctaveOffset * size;
  const field = new Float32Array(size * size);
  const wrap = (i: number) => ((i % size) + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x2 = wrap(Math.floor((x + 0.5) * c.secondOctaveFrequency + offset));
      const y2 = wrap(Math.floor((y + 0.5) * c.secondOctaveFrequency + offset));
      field[y * size + x] =
        (c.firstOctaveWeight * data[y * size + x]! +
          (1 - c.firstOctaveWeight) * data[y2 * size + x2]!) /
        255;
    }
  }
  return field;
}

/**
 * The 8-bit texture `data` (size²) bilinearly at (u, v) tiles, wrapped, in
 * [0, 1]: one read of the texture as the GPU takes it at its finest level
 * (texel centres). Exported for the hex twin's GPU check (the look-dev
 * page's `hexProbe`).
 */
export function cloudTextureSample(
  data: Uint8Array,
  size: number,
  u: number,
  v: number
) {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const wrap = (i: number) => ((i % size) + size) % size;
  const at = (i: number, j: number) => data[wrap(j) * size + wrap(i)]! / 255;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

const meanCache = new WeakMap<Uint8Array, number>();

/** A texture's mean value (0-1), cached per texture data. */
function textureMean(data: Uint8Array): number {
  let mean = meanCache.get(data);
  if (mean === undefined) {
    let sum = 0;
    for (const value of data) sum += value;
    mean = sum / (255 * data.length);
    meanCache.set(data, mean);
  }
  return mean;
}

/**
 * The two-octave noise at texture coordinates (u, v) (tiles), as the shader
 * reads it at its finest level (`atmCloudNoise` without mips): each octave
 * bilinear between texel centres, wrapped. The CPU twin tests and the
 * look-dev page's probes use it to predict where the clouds are. With
 * `hex`, the big-shape octave is hex-tiled (`cloud-hex.ts`), as the
 * shader draws it with `atmCloudHex` on.
 *
 * @throws RangeError for non-finite coordinates.
 */
export function cloudNoiseSample(
  data: Uint8Array,
  size: number,
  u: number,
  v: number,
  options: { readonly hex?: boolean } = {}
): number {
  if (!(Number.isFinite(u) && Number.isFinite(v))) {
    throw new RangeError(`noise coordinates must be finite, got ${u}, ${v}`);
  }
  const c = CLOUD_LAYER;
  const first =
    options.hex === true
      ? hexTiledSample(
          (a, b) => cloudTextureSample(data, size, a, b),
          u,
          v,
          textureMean(data)
        )
      : cloudTextureSample(data, size, u, v);
  return (
    c.firstOctaveWeight * first +
    (1 - c.firstOctaveWeight) *
      cloudTextureSample(
        data,
        size,
        u * c.secondOctaveFrequency + c.secondOctaveOffset,
        v * c.secondOctaveFrequency + c.secondOctaveOffset
      )
  );
}

/**
 * The noise threshold at which `cover` of the sky is cloud: the (1 − cover)
 * quantile of the combined noise. Infinity at cover 0 (a clear sky).
 *
 * @throws RangeError for a cover outside [0, 1].
 */
export function cloudThresholdForCover(
  field: Float32Array,
  cover: number
): number {
  if (!(Number.isFinite(cover) && cover >= 0 && cover <= 1)) {
    throw new RangeError(`cloud cover must be in [0, 1], got ${cover}`);
  }
  if (cover === 0) return Number.POSITIVE_INFINITY;
  const sorted = Float32Array.from(field).sort();
  return sorted[
    Math.min(sorted.length - 1, Math.floor((1 - cover) * sorted.length))
  ]!;
}

const sortedCache = new Map<string, Float32Array>();

/** `cloudThresholdForCover` for the default texture, with the sort cached. */
export function cloudThreshold(
  cover: number,
  size: number = CLOUD_TEXTURE_SIZE,
  seed = 1
): number {
  const key = `${size}:${seed}`;
  let sorted = sortedCache.get(key);
  if (sorted === undefined) {
    sorted = combinedCloudNoise(cloudNoise(size, seed), size).sort();
    sortedCache.set(key, sorted);
  }
  return cloudThresholdForCover(sorted, cover);
}

/** The noise as a repeating, mipmapped single-channel texture. */
export function createCloudTexture(
  size: number = CLOUD_TEXTURE_SIZE,
  seed = 1
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    cloudNoise(size, seed),
    size,
    size,
    THREE.RedFormat
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Cloud density from a noise value and a threshold (`cloudThreshold`): a
 * soft step, exactly 0.5 AT the threshold, so the share of sky with density
 * > 0.5 is the share of noise above it, i.e. the cover. An infinite
 * threshold (cover 0) gives no cloud. GLSL twin: `atmCloudDensity`.
 */
export function cloudDensity(noise: number, threshold: number): number {
  if (!Number.isFinite(threshold)) return 0;
  return fade(
    clamp01((noise - threshold) / (2 * CLOUD_LAYER.edgeHalfWidth) + 0.5)
  );
}

/**
 * Fade by the view direction's height (`dir.y`): 0 at and below the horizon,
 * 1 from ~7° up. The plane is infinitely far at the horizon, where its
 * texture would alias. GLSL twin: `atmCloudHorizonFade`.
 */
export function cloudHorizonFade(dirY: number): number {
  return fade(clamp01(dirY / 0.12));
}

/**
 * The radiance of a cloud's lit side, for a sun of illuminance 1 (LUT units
 * ÷ ATMOSPHERE_RADIANCE_SCALE): the sun's transmittance at cloud height times
 * a side-lit share plus forward scattering toward the sun, darkened by
 * thickness, plus the zenith sky as ambient. GLSL twin: the `lit` term of
 * `atmClouds`. A tested plausibility anchor for constants that were bare
 * shader literals (M2 review, finding 5).
 */
export function cloudLitRadiance(
  sunTransmittance: Rgb,
  cosToSun: number,
  density: number,
  zenith: Rgb
): Rgb {
  const c = CLOUD_LAYER;
  const forward = Math.pow(Math.max(cosToSun, 0), c.forwardPower);
  const sun =
    (c.sunAmbient + c.forwardStrength * forward) *
    (1 - c.thicknessDarkening * density);
  return [
    sunTransmittance[0] * sun + zenith[0] * c.skyAmbient,
    sunTransmittance[1] * sun + zenith[1] * c.skyAmbient,
    sunTransmittance[2] * sun + zenith[2] * c.skyAmbient,
  ];
}
