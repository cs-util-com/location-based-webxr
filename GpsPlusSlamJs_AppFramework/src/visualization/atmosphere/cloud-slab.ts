/**
 * The cloud SLAB (plan 2026-09-24-1010-lookdev-fly-through-cloud-layer-plan
 * §11, amended by §12): the dome layer's clouds as a thin VOLUME between
 * `baseM` and `topM`, ray-marched per pixel, to A/B against the sheet on the
 * look-dev page. The pattern and the cover are the dome's; the noise sets
 * each column's thickness, so the cover keeps meaning share of sky (from the
 * zenith), and flying inside is a whiteout rather than a dissolve.
 *
 * WHAT LIVES HERE (this step, §11.9 step 1): the constants and the CPU twin
 * of everything the shader computes: the column, the vertical profile and
 * its integral, the march interval, the quadratic steps, the exact optical
 * depth of a step, the light, the level of detail, the draw order, and the
 * march itself, which the tests use as the shader's stand-in.
 *
 * @see cloud-slab.ts.md
 */

import { smoothstep } from '../../utils/smoothstep.js';
import {
  CLOUD_LAYER,
  CLOUD_TEXTURE_SIZE,
  cloudDensity,
  cloudLitRadiance,
} from './cloud-layer.js';
import { CLOUD_SHEET, cloudTopRadiance } from './cloud-sheet.js';

export type Vec3 = readonly [number, number, number];

/** The step counts the shader is built for (a define per value). */
export const CLOUD_SLAB_STEPS = [8, 16, 24, 32] as const;
export type CloudSlabSteps = (typeof CLOUD_SLAB_STEPS)[number];

/** The slab's geometry, density and light, metres (the scene's unit). */
export const CLOUD_SLAB = {
  /** 400 m thick, centred on the sheet's 2 km: the A/B compares thickness. */
  baseM: 1800,
  topM: 2200,
  /** The prism's radius: the sheet's, so the far fade ends inside it. */
  radiusM: CLOUD_SHEET.radiusM,
  /** σ: an in-cloud visibility of 3.9/σ ≈ 195 m (stratocumulus: 100-300 m). */
  extinctionPerM: 0.02,
  /** b: the density ramps from 0 at the base to full over this height. */
  baseSoftM: 50,
  /**
   * H: metres of column thickness per unit of noise above the threshold.
   * 0.5·σ·H = 10 per noise unit matches the dome's density slope at the
   * threshold (≈ 9.4), so cloud edges seen from the ground are as sharp.
   */
  heightScaleM: 1000,
  /** k: the sun's path through the column is shortened for multiple scattering. */
  sunDepthScale: 0.25,
  /** The sun's elevation sine is floored here, so a low sun never divides by 0. */
  sunMuFloor: 0.1,
  /** ≥ hypot(far fade end, top): the far fade ends the clouds, never the cap. */
  maxMarchM: 22_000,
  /** The march stops once less than this share of the view passes through. */
  earlyExitTransmittance: 0.01,
  /** Below this |dir.y| a step's density is sampled, not integrated in height. */
  levelDirY: 1e-5,
  defaultSteps: 16 satisfies CloudSlabSteps,
} as const;

/** The noise texture's texel in metres: 24 km over 256 texels, 93.75 m. */
const TEXEL_M = (CLOUD_LAYER.tileKm * 1000) / CLOUD_TEXTURE_SIZE;

/**
 * Q(h): the integral of the density ramp p(x) = clamp(x/b, 0, 1) from 0 to
 * h, in metres of full density. x²/(2b) up to b, x - b/2 above. GLSL twin:
 * `atmSlabCumulative`.
 */
export function cloudSlabCumulativeM(
  h: number,
  b: number = CLOUD_SLAB.baseSoftM
): number {
  if (h <= 0) return 0;
  if (b <= 0) return h;
  return h < b ? (h * h) / (2 * b) : h - b / 2;
}

/**
 * T0: the column thickness whose zenith optical depth is ln 2, i.e. whose
 * zenith opacity is exactly one half: Q⁻¹(ln 2 / σ). Defined for any ramp,
 * so no (σ, b) pair a sweep tries is invalid.
 */
export function cloudSlabThresholdThicknessM(
  sigma: number = CLOUD_SLAB.extinctionPerM,
  b: number = CLOUD_SLAB.baseSoftM
): number {
  const q = Math.LN2 / sigma;
  if (b <= 0) return q;
  return q < b / 2 ? Math.sqrt(2 * b * q) : q + b / 2;
}

const T0 = cloudSlabThresholdThicknessM();

/**
 * A column's thickness from its noise and the cover's threshold: T0 at the
 * threshold, rising with the noise, capped at the slab's top (the deck). An
 * infinite threshold (cover 0) gives no cloud. GLSL twin: `atmSlabThickness`.
 */
export function cloudSlabThicknessM(noise: number, threshold: number): number {
  if (!Number.isFinite(threshold)) return 0;
  const T = T0 + CLOUD_SLAB.heightScaleM * (noise - threshold);
  return Math.min(Math.max(T, 0), CLOUD_SLAB.topM - CLOUD_SLAB.baseM);
}

/**
 * The opacity of a column seen straight up: exactly 0.5 at the threshold,
 * monotone in the noise. The share of columns above 0.5 is the cover.
 */
export function cloudSlabZenithOpacity(
  noise: number,
  threshold: number
): number {
  const T = cloudSlabThicknessM(noise, threshold);
  return 1 - Math.exp(-CLOUD_SLAB.extinctionPerM * cloudSlabCumulativeM(T));
}

/**
 * The part of a ray from height `y` along `dir` that lies in the slab and
 * inside the far fade, as distances along the ray; null when there is none.
 * Analytic, never from the mesh's faces. GLSL twin: the interval of
 * `CLOUD_SLAB_FRAGMENT_GLSL`.
 *
 * @throws RangeError for a non-finite height or a direction that is not
 *   finite or has no length.
 */
export function cloudSlabInterval(
  y: number,
  dir: Vec3
): { inM: number; outM: number } | null {
  const length = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(Number.isFinite(y) && Number.isFinite(length) && length > 0)) {
    throw new RangeError(
      `slab ray needs a finite height and direction, got ${y}, ${dir.join(', ')}`
    );
  }
  const dy = dir[1] / length;
  const horizontal = Math.hypot(dir[0], dir[2]) / length;
  const { baseM, topM, maxMarchM } = CLOUD_SLAB;
  const tFar = CLOUD_SHEET.farFadeEndM / Math.max(horizontal, 1e-6);
  const cap = Math.min(maxMarchM, tFar);
  let inM: number;
  let outM: number;
  if (Math.abs(dy) < 1e-6) {
    if (y < baseM || y > topM) return null;
    inM = 0;
    outM = cap;
  } else {
    const tBase = (baseM - y) / dy;
    const tTop = (topM - y) / dy;
    inM = Math.max(Math.min(tBase, tTop), 0);
    outM = Math.min(Math.max(tBase, tTop), cap);
  }
  return outM > inM ? { inM, outM } : null;
}

/**
 * The march's steps over an interval of length `lengthM`, as offsets from its
 * entry: quadratic, crowding at the entry (the atmosphere's own form), with
 * each sample at the middle of its step in the same quadratic measure.
 *
 * @throws RangeError for a step count the shader is not built for, or a
 *   negative or non-finite length.
 */
export function cloudSlabSteps(
  steps: number,
  lengthM: number
): { starts: number[]; ends: number[]; samples: number[] } {
  if (!(CLOUD_SLAB_STEPS as readonly number[]).includes(steps)) {
    throw new RangeError(
      `slab steps must be one of ${CLOUD_SLAB_STEPS.join(', ')}, got ${steps}`
    );
  }
  if (!(Number.isFinite(lengthM) && lengthM >= 0)) {
    throw new RangeError(
      `slab march length must be finite and ≥ 0, got ${lengthM}`
    );
  }
  const starts: number[] = [];
  const ends: number[] = [];
  const samples: number[] = [];
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps;
    const u1 = (i + 1) / steps;
    const um = (i + 0.5) / steps;
    starts.push(u0 * u0 * lengthM);
    ends.push(u1 * u1 * lengthM);
    samples.push(um * um * lengthM);
  }
  return { starts, ends, samples };
}

/**
 * The optical depth of one step [t0, t1] of a ray from height `y` with
 * vertical component `dirY` (of a unit direction), through a column of
 * thickness T: the density integrated EXACTLY in height, σ·|ΔQ| / |dirY|,
 * which is what keeps a coarse march from slicing hard tops. Nearly level
 * rays sample the density at the step's middle instead.
 */
export function cloudSlabStepOpticalDepth(
  y: number,
  dirY: number,
  t0: number,
  t1: number,
  T: number
): number {
  const { baseM, extinctionPerM, baseSoftM, levelDirY } = CLOUD_SLAB;
  if (T <= 0 || t1 <= t0) return 0;
  const clampH = (h: number) => Math.min(Math.max(h, 0), T);
  if (Math.abs(dirY) >= levelDirY) {
    const h0 = clampH(y + dirY * t0 - baseM);
    const h1 = clampH(y + dirY * t1 - baseM);
    return (
      (extinctionPerM *
        Math.abs(cloudSlabCumulativeM(h1) - cloudSlabCumulativeM(h0))) /
      Math.abs(dirY)
    );
  }
  const h = y + dirY * 0.5 * (t0 + t1) - baseM;
  if (h < 0 || h > T) return 0;
  const p = baseSoftM <= 0 ? 1 : Math.min(1, h / baseSoftM);
  return extinctionPerM * p * (t1 - t0);
}

/**
 * The share of the sun that reaches height h of a column of thickness T:
 * through the column above it, from a plane-parallel sun, the path
 * shortened by k for multiple scattering. Height clamped to the column, so
 * never above 1. GLSL twin: `atmSlabSunTransmittance`.
 */
export function cloudSlabSunTransmittance(
  h: number,
  T: number,
  sunY: number
): number {
  const { extinctionPerM, sunDepthScale, sunMuFloor } = CLOUD_SLAB;
  const above =
    cloudSlabCumulativeM(T) - cloudSlabCumulativeM(Math.min(Math.max(h, 0), T));
  return Math.min(
    1,
    Math.exp(
      (-extinctionPerM * sunDepthScale * above) / Math.max(sunY, sunMuFloor)
    )
  );
}

/**
 * A sample's radiance, for a sun of illuminance 1: the sheet's sunlit top
 * where the sun reaches it (sunT = 1) and the dome's underside where it
 * does not (sunT = 0), mixed. The zenith ambient is in both, so counted
 * once. GLSL twin: the source of `CLOUD_SLAB_FRAGMENT_GLSL`.
 */
export function cloudSlabSourceRadiance(
  sunTransmittance: Vec3,
  cosToSun: number,
  density: number,
  zenith: Vec3,
  sunY: number,
  sunReach: number
): [number, number, number] {
  const top = cloudTopRadiance(sunTransmittance, sunY, zenith);
  const under = cloudLitRadiance(sunTransmittance, cosToSun, density, zenith);
  const t = Math.min(Math.max(sunReach, 0), 1);
  return [
    under[0] + (top[0] - under[0]) * t,
    under[1] + (top[1] - under[1]) * t,
    under[2] + (top[2] - under[2]) * t,
  ];
}

/**
 * The noise's level of detail at distance t along a ray: the pixel's
 * footprint there, or the ground a coarse step skips, whichever is larger,
 * in texels (never negative). GLSL twin: the `lod` of the march.
 */
export function cloudSlabLod(
  tM: number,
  pixelAngle: number,
  stepM: number,
  dirHorizontal: number
): number {
  const footprint = Math.max(tM * pixelAngle, stepM * dirHorizontal);
  return footprint > 0 ? Math.max(0, Math.log2(footprint / TEXEL_M)) : 0;
}

/**
 * The slab's `renderOrder`: behind the scene's transparent objects (-1)
 * from below, in front (+1) from inside and above, where the only scene in
 * view is below the slab.
 */
export function cloudSlabRenderOrder(cameraY: number): number {
  return cameraY > CLOUD_SLAB.baseM ? 1 : -1;
}

/** A sample's weight by horizontal distance: the sheet's far fade. */
export function cloudSlabFarWeight(horizontalM: number): number {
  return (
    1 -
    smoothstep(CLOUD_SHEET.farFadeStartM, CLOUD_SHEET.farFadeEndM, horizontalM)
  );
}

/** The sun and sky a march lights its samples with (`cloudSlabMarch`). */
interface CloudSlabLight {
  /** The sun's transmittance at cloud height (LUT units). */
  readonly sunTransmittance: Vec3;
  /** Unit direction toward the sun, scene frame (y up). */
  readonly sunDir: Vec3;
  /** The zenith sky (LUT units), the ambient. */
  readonly zenith: Vec3;
}

export interface CloudSlabMarchInput {
  readonly camera: Vec3;
  /** Unit view direction. */
  readonly dir: Vec3;
  readonly steps: number;
  /** The combined noise at world x/z (metres) and a level of detail. */
  readonly sample: (xM: number, zM: number, lod: number) => number;
  readonly threshold: number;
  /** Radians per pixel (for the level of detail); 0 ignores the footprint. */
  readonly pixelAngle?: number;
  /** Omitted: only the opacity is marched. */
  readonly light?: CloudSlabLight;
}

export interface CloudSlabMarchResult {
  /** The drawn alpha: each step weighted by the far and aerial fades. */
  alpha: number;
  /** The unweighted opacity, 1 - the product of the steps' transmittances. */
  opacity: number;
  /** Premultiplied radiance (zero without `light`). */
  colour: [number, number, number];
  /** Steps actually taken (fewer after an early exit). */
  stepsTaken: number;
}

/**
 * The march the shader runs, on the CPU: the interval, the quadratic steps,
 * each step's exact optical depth through its column, the far and aerial
 * weights on the contribution, the light, and the early exit. The tests'
 * stand-in for `CLOUD_SLAB_FRAGMENT_GLSL`.
 */
export function cloudSlabMarch(
  input: CloudSlabMarchInput
): CloudSlabMarchResult {
  const result: CloudSlabMarchResult = {
    alpha: 0,
    opacity: 0,
    colour: [0, 0, 0],
    stepsTaken: 0,
  };
  const { camera, dir, steps, sample, threshold, light } = input;
  const interval = cloudSlabInterval(camera[1], dir);
  if (interval === null || !Number.isFinite(threshold)) return result;
  const { starts, ends, samples } = cloudSlabSteps(
    steps,
    interval.outM - interval.inM
  );
  const horizontal = Math.hypot(dir[0], dir[2]);
  const cosToSun = light
    ? dir[0] * light.sunDir[0] +
      dir[1] * light.sunDir[1] +
      dir[2] * light.sunDir[2]
    : 0;
  let transmittance = 1;
  for (let i = 0; i < steps; i++) {
    const t = interval.inM + samples[i]!;
    const t0 = interval.inM + starts[i]!;
    const t1 = interval.inM + ends[i]!;
    const x = camera[0] + dir[0] * t;
    const z = camera[2] + dir[2] * t;
    const lod = cloudSlabLod(t, input.pixelAngle ?? 0, t1 - t0, horizontal);
    const noise = sample(x, z, lod);
    const T = cloudSlabThicknessM(noise, threshold);
    const tau = cloudSlabStepOpticalDepth(camera[1], dir[1], t0, t1, T);
    const a = 1 - Math.exp(-tau);
    const w =
      cloudSlabFarWeight(t * horizontal) *
      Math.exp((-t * 0.001) / CLOUD_LAYER.aerialKm);
    const contribution = transmittance * a * w;
    if (light) {
      const h = camera[1] + dir[1] * t - CLOUD_SLAB.baseM;
      const s = cloudSlabSourceRadiance(
        light.sunTransmittance,
        cosToSun,
        cloudDensity(noise, threshold),
        light.zenith,
        light.sunDir[1],
        cloudSlabSunTransmittance(h, T, light.sunDir[1])
      );
      result.colour[0] += contribution * s[0];
      result.colour[1] += contribution * s[1];
      result.colour[2] += contribution * s[2];
    }
    result.alpha += contribution;
    transmittance *= Math.exp(-tau);
    result.stepsTaken = i + 1;
    if (transmittance < CLOUD_SLAB.earlyExitTransmittance) break;
  }
  result.opacity = 1 - transmittance;
  return result;
}
