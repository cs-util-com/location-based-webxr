/**
 * The cloud SLAB (plan 2026-09-24-1010-lookdev-fly-through-cloud-layer-plan
 * §11, amended by §12): the dome layer's clouds as a thin VOLUME between
 * `baseM` and `topM`, ray-marched per pixel, to A/B against the sheet on the
 * look-dev page. The pattern and the cover are the dome's; the noise sets
 * each column's thickness, so the cover keeps meaning share of sky (from the
 * zenith), and flying inside is a whiteout rather than a dissolve.
 *
 * WHAT LIVES HERE: the constants; the CPU twin of everything the shader
 * computes (the column, the vertical profile and its integral, the march
 * interval, the quadratic steps, the exact optical depth of a step, the
 * light, the level of detail, the draw order, and the march itself, which
 * the tests use as the shader's stand-in); the shader; and the mesh.
 * `SkyAtmosphere` owns the mesh and adds it only in `cloudMode: 'slab'`.
 *
 * @see cloud-slab.ts.md
 */

import * as THREE from 'three';

import { glslFloat } from '../../utils/glsl-float.js';
import { smoothstep } from '../../utils/smoothstep.js';
import {
  ATMOSPHERE_CLOUD_GLSL,
  ATMOSPHERE_COMMON_GLSL,
  ATMOSPHERE_MAX_SCENE_RADIANCE,
} from './atmosphere-glsl.js';
import {
  CLOUD_LAYER,
  CLOUD_TEXTURE_SIZE,
  cloudDensity,
  cloudLitRadiance,
} from './cloud-layer.js';
import {
  CLOUD_SHEET,
  CLOUD_TOP_LIT_GLSL,
  cloudSheetRingRadii,
  cloudTopRadiance,
} from './cloud-sheet.js';

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
 * each sample at `jitter` of the way through its step in the same quadratic
 * measure (0.5: the middle). The shader jitters it per pixel: a fixed sample
 * point drew the far deck as terraced bands at level rays, where one step
 * spans kilometres of ground (plan §12.1, measured on the look-dev page).
 *
 * @throws RangeError for a step count the shader is not built for, a
 *   negative or non-finite length, or a jitter outside [0, 1].
 */
export function cloudSlabSteps(
  steps: number,
  lengthM: number,
  jitter = 0.5
): { starts: number[]; ends: number[]; samples: number[] } {
  if (!(Number.isFinite(jitter) && jitter >= 0 && jitter <= 1)) {
    throw new RangeError(`slab step jitter must be in [0, 1], got ${jitter}`);
  }
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
    const um = (i + jitter) / steps;
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
  /** Where in each step the noise is sampled, [0, 1]; 0.5 (the middle) by default. */
  readonly jitter?: number;
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
  const { camera, steps, sample, threshold, light } = input;
  // Validated and normalised here: every position below assumes a unit
  // direction (the interval normalises on its own; the march must too).
  const interval = cloudSlabInterval(camera[1], input.dir);
  const length = Math.hypot(input.dir[0], input.dir[1], input.dir[2]);
  const dir: Vec3 = [
    input.dir[0] / length,
    input.dir[1] / length,
    input.dir[2] / length,
  ];
  if (interval === null || !Number.isFinite(threshold)) return result;
  const { starts, ends, samples } = cloudSlabSteps(
    steps,
    interval.outM - interval.inM,
    input.jitter
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

/** The slab's vertex: only covers the pixels; the direction comes from gl_FragCoord. */
const CLOUD_SLAB_VERTEX_GLSL = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

/**
 * The slab's fragment: the view ray from the pixel (never from the mesh's
 * interpolated position: 24 km triangles with the eye 0.5 m away broke M1's
 * sheet), the analytic interval, the quadratic march with each step's exact
 * optical depth through its column, the light hoisted out of the loop, the
 * far and aerial weights on the contribution, and the early exit. Twin of
 * `cloudSlabMarch`. Output like the sheet: scene units, clamped, then three's
 * tone mapping and output colour space.
 */
export const CLOUD_SLAB_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
uniform sampler2D atmSkyViewLut;
uniform vec3 atmSunDirection;
uniform float atmObserverRadius;
uniform float atmRadianceToScene;
const float ATM_MAX_SCENE_RADIANCE = ${glslFloat(ATMOSPHERE_MAX_SCENE_RADIANCE)};
${ATMOSPHERE_CLOUD_GLSL}
${CLOUD_TOP_LIT_GLSL}
uniform mat4 atmSlabInverseProjection;
uniform mat4 atmSlabCameraWorld;
uniform vec4 atmSlabViewport;
uniform float atmSlabPixelAngle;
const float ATM_SLAB_BASE = ${glslFloat(CLOUD_SLAB.baseM)};
const float ATM_SLAB_TOP = ${glslFloat(CLOUD_SLAB.topM)};
const float ATM_SLAB_SIGMA = ${glslFloat(CLOUD_SLAB.extinctionPerM)};
const float ATM_SLAB_SOFT = ${glslFloat(CLOUD_SLAB.baseSoftM)};
const float ATM_SLAB_HEIGHT_SCALE = ${glslFloat(CLOUD_SLAB.heightScaleM)};
const float ATM_SLAB_T0 = ${glslFloat(cloudSlabThresholdThicknessM())};
const float ATM_SLAB_SUN_DEPTH = ${glslFloat(CLOUD_SLAB.sunDepthScale)};
const float ATM_SLAB_SUN_MU_FLOOR = ${glslFloat(CLOUD_SLAB.sunMuFloor)};
const float ATM_SLAB_MAX_MARCH = ${glslFloat(CLOUD_SLAB.maxMarchM)};
const float ATM_SLAB_EARLY_EXIT = ${glslFloat(CLOUD_SLAB.earlyExitTransmittance)};
const float ATM_SLAB_LEVEL_DIR_Y = ${glslFloat(CLOUD_SLAB.levelDirY)};
const float ATM_SLAB_FAR_START = ${glslFloat(CLOUD_SHEET.farFadeStartM)};
const float ATM_SLAB_FAR_END = ${glslFloat(CLOUD_SHEET.farFadeEndM)};
const float ATM_SLAB_TEXEL = ${glslFloat(TEXEL_M)};

// Twin of cloudSlabCumulativeM.
float atmSlabCumulative(float h) {
  if (h <= 0.0) return 0.0;
  if (ATM_SLAB_SOFT <= 0.0) return h;
  return h < ATM_SLAB_SOFT ? h * h / (2.0 * ATM_SLAB_SOFT) : h - 0.5 * ATM_SLAB_SOFT;
}

// Twin of cloudSlabThicknessM (the threshold is 2, above any noise, when clear).
float atmSlabThickness(float noise, float threshold) {
  return clamp(ATM_SLAB_T0 + ATM_SLAB_HEIGHT_SCALE * (noise - threshold), 0.0, ATM_SLAB_TOP - ATM_SLAB_BASE);
}

void main() {
  if (atmCloudCover <= 0.0) discard;
  vec2 ndc = (gl_FragCoord.xy - atmSlabViewport.xy) / atmSlabViewport.zw * 2.0 - 1.0;
  vec4 view = atmSlabInverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(mat3(atmSlabCameraWorld) * (view.xyz / view.w));
  float y = cameraPosition.y;
  float horizontal = length(dir.xz);
  // Twin of cloudSlabInterval.
  float cap = min(ATM_SLAB_MAX_MARCH, ATM_SLAB_FAR_END / max(horizontal, 1e-6));
  float tIn;
  float tOut;
  if (abs(dir.y) < 1e-6) {
    if (y < ATM_SLAB_BASE || y > ATM_SLAB_TOP) discard;
    tIn = 0.0;
    tOut = cap;
  } else {
    float tBase = (ATM_SLAB_BASE - y) / dir.y;
    float tTop = (ATM_SLAB_TOP - y) / dir.y;
    tIn = max(min(tBase, tTop), 0.0);
    tOut = min(max(tBase, tTop), cap);
  }
  if (tOut <= tIn) discard;
  float lengthM = tOut - tIn;
  // A static per-pixel jitter of the sample point inside each step
  // (interleaved gradient noise): a fixed point drew the far deck as
  // terraced bands at level rays. The step bounds, so the exact integral,
  // do not move.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // Hoisted: the same for every sample. atmCloudLit is affine in density.
  vec3 under0 = atmCloudLit(dir, atmObserverRadius, 0.0);
  vec3 under1 = atmCloudLit(dir, atmObserverRadius, 1.0);
  vec3 top = atmCloudTopLit(atmObserverRadius);
  float mu = max(atmSunDirection.y, ATM_SLAB_SUN_MU_FLOOR);
  vec3 colour = vec3(0.0);
  float alpha = 0.0;
  float transmittance = 1.0;
  // atm-slab-loop-begin
  for (int i = 0; i < ATM_SLAB_STEPS; i++) {
    float u0 = float(i) / float(ATM_SLAB_STEPS);
    float u1 = float(i + 1) / float(ATM_SLAB_STEPS);
    float um = (float(i) + jitter) / float(ATM_SLAB_STEPS);
    float t0 = tIn + u0 * u0 * lengthM;
    float t1 = tIn + u1 * u1 * lengthM;
    float t = tIn + um * um * lengthM;
    float footprint = max(t * atmSlabPixelAngle, (t1 - t0) * horizontal);
    float lod = footprint > 0.0 ? max(0.0, log2(footprint / ATM_SLAB_TEXEL)) : 0.0;
    vec2 uv = (cameraPosition.xz + dir.xz * t) * 0.001 / ATM_CLOUD_TILE + atmCloudOffset;
    float noise = atmCloudNoiseLod(uv, lod);
    float thickness = atmSlabThickness(noise, atmCloudThreshold);
    float tau = 0.0;
    if (abs(dir.y) >= ATM_SLAB_LEVEL_DIR_Y) {
      float h0 = clamp(y + dir.y * t0 - ATM_SLAB_BASE, 0.0, thickness);
      float h1 = clamp(y + dir.y * t1 - ATM_SLAB_BASE, 0.0, thickness);
      tau = ATM_SLAB_SIGMA * abs(atmSlabCumulative(h1) - atmSlabCumulative(h0)) / abs(dir.y);
    } else {
      float hm = y + dir.y * 0.5 * (t0 + t1) - ATM_SLAB_BASE;
      float p = ATM_SLAB_SOFT <= 0.0 ? 1.0 : clamp(hm / ATM_SLAB_SOFT, 0.0, 1.0);
      tau = (hm < 0.0 || hm > thickness) ? 0.0 : ATM_SLAB_SIGMA * p * (t1 - t0);
    }
    float a = 1.0 - exp(-tau);
    float w = (1.0 - smoothstep(ATM_SLAB_FAR_START, ATM_SLAB_FAR_END, t * horizontal))
      * exp(-t * 0.001 / ATM_CLOUD_AERIAL_KM);
    float h = clamp(y + dir.y * t - ATM_SLAB_BASE, 0.0, thickness);
    float reach = min(1.0, exp(-ATM_SLAB_SIGMA * ATM_SLAB_SUN_DEPTH
      * (atmSlabCumulative(thickness) - atmSlabCumulative(h)) / mu));
    vec3 source = mix(mix(under0, under1, atmCloudDensity(noise, atmCloudThreshold)), top, reach);
    float contribution = transmittance * a * w;
    colour += contribution * source;
    alpha += contribution;
    transmittance *= exp(-tau);
    if (transmittance < ATM_SLAB_EARLY_EXIT) break;
  }
  // atm-slab-loop-end
  // Premultiplied: back to straight colour, with a floor against division.
  if (alpha < 1e-4) discard;
  vec3 lit = colour / alpha;
  gl_FragColor = vec4(min(lit * atmRadianceToScene, vec3(ATM_MAX_SCENE_RADIANCE)), min(alpha, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The prism: the sheet's ring disc as the top cap (facing up) and, reversed,
 * the bottom cap (facing down), and the wall between them at the radius, all
 * facing outward, so `BackSide` draws the far inside from anywhere.
 */
function cloudSlabGeometry(): THREE.BufferGeometry {
  const radii = cloudSheetRingRadii();
  const n = CLOUD_SHEET.sectors;
  const half = (CLOUD_SLAB.topM - CLOUD_SLAB.baseM) / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const cap = (y: number, up: boolean) => {
    const start = positions.length / 3;
    positions.push(0, y, 0);
    for (let k = 1; k < radii.length; k++) {
      for (let j = 0; j < n; j++) {
        const a = (2 * Math.PI * j) / n;
        positions.push(radii[k]! * Math.cos(a), y, radii[k]! * Math.sin(a));
      }
    }
    const ring = (k: number, j: number) => start + 1 + (k - 1) * n + (j % n);
    const tri = (a: number, b: number, c: number) =>
      up ? indices.push(a, b, c) : indices.push(a, c, b);
    for (let j = 0; j < n; j++) tri(start, ring(1, j + 1), ring(1, j));
    for (let k = 1; k < radii.length - 1; k++) {
      for (let j = 0; j < n; j++) {
        const a = ring(k, j);
        const b = ring(k, j + 1);
        const c = ring(k + 1, j);
        const d = ring(k + 1, j + 1);
        tri(a, b, c);
        tri(b, d, c);
      }
    }
    return (j: number) => ring(radii.length - 1, j);
  };
  const topRim = cap(half, true);
  const bottomRim = cap(-half, false);
  // The wall, facing outward: (bottom j, bottom j+1, top j) turns outward
  // for the ring's angle order.
  for (let j = 0; j < n; j++) {
    const b0 = bottomRim(j);
    const b1 = bottomRim(j + 1);
    const t0 = topRim(j);
    const t1 = topRim(j + 1);
    indices.push(b0, t0, b1, b1, t0, t1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Sets the slab's step count (a define, so a new program; three caches one
 * per value). Validated first: a count the shader is not built for changes
 * nothing.
 *
 * @throws RangeError for a step count outside `CLOUD_SLAB_STEPS`.
 */
export function setCloudSlabSteps(slab: THREE.Mesh, steps: number): void {
  if (!(CLOUD_SLAB_STEPS as readonly number[]).includes(steps)) {
    throw new RangeError(
      `slab steps must be one of ${CLOUD_SLAB_STEPS.join(', ')}, got ${steps}`
    );
  }
  const material = slab.material as THREE.ShaderMaterial;
  material.defines = { ...material.defines, ATM_SLAB_STEPS: steps };
  material.needsUpdate = true;
}

/**
 * The slab mesh, reading the given uniforms (the sky's LUTs, sun, scale and
 * the cloud uniforms, spread so one update reaches the sky and the slab) plus
 * its own ray uniforms, which `onBeforeRender` sets from the rendering
 * camera and viewport before three computes the model-view matrix.
 */
export function createCloudSlab(
  uniforms: Record<string, THREE.IUniform>,
  steps: number = CLOUD_SLAB.defaultSteps
): THREE.Mesh {
  const own = {
    atmSlabInverseProjection: { value: new THREE.Matrix4() },
    atmSlabCameraWorld: { value: new THREE.Matrix4() },
    atmSlabViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
    atmSlabPixelAngle: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'atmosphere-cloud-slab',
    vertexShader: CLOUD_SLAB_VERTEX_GLSL,
    fragmentShader: CLOUD_SLAB_FRAGMENT_GLSL,
    uniforms: { ...uniforms, ...own },
    defines: { ATM_SLAB_STEPS: CLOUD_SLAB.defaultSteps },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const slab = new THREE.Mesh(cloudSlabGeometry(), material);
  if (steps !== CLOUD_SLAB.defaultSteps) setCloudSlabSteps(slab, steps);
  slab.name = 'atmosphere-cloud-slab';
  // It follows the camera, so its bounds never describe what is visible.
  slab.frustumCulled = false;
  const middle = (CLOUD_SLAB.baseM + CLOUD_SLAB.topM) / 2;
  slab.position.y = middle;
  slab.renderOrder = -1;
  const cameraAt = new THREE.Vector3();
  slab.onBeforeRender = (renderer, _scene, camera) => {
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    slab.position.set(cameraAt.x, middle, cameraAt.z);
    slab.updateMatrixWorld();
    // Takes effect from the next frame (the sort already ran), as for the
    // sheet; at the base the lag is hidden, where the density starts at 0.
    slab.renderOrder = cloudSlabRenderOrder(cameraAt.y);
    own.atmSlabInverseProjection.value.copy(camera.projectionMatrixInverse);
    own.atmSlabCameraWorld.value.copy(camera.matrixWorld);
    // The viewport of THIS render (a post-processing target has its own).
    const viewport = renderer.getCurrentViewport(own.atmSlabViewport.value);
    own.atmSlabPixelAngle.value =
      2 / (camera.projectionMatrix.elements[5] * Math.max(viewport.w, 1));
  };
  return slab;
}
