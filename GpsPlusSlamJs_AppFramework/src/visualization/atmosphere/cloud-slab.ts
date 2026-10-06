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
 * interval, the spacing and its nodes, the part of a segment under the
 * column top, the exact optical depth of a segment, the light and its
 * in-segment integral, the level of detail, the draw order, and the march
 * itself, which the tests use as the shader's stand-in); the shader; and
 * the mesh.
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
  CLOUD_COVERAGE_GLSL,
  type CloudCoverage,
  cloudCoverThresholds,
  cloudCoverageUniforms,
  withCloudCoverage,
} from './cloud-coverage.js';
import {
  CLOUD_SHEET,
  CLOUD_TOP_LIT_GLSL,
  cloudSheetRingRadii,
  cloudTopRadiance,
} from './cloud-sheet.js';
import {
  CLOUD_COLUMN,
  cloudSlabCumulativeM,
  cloudSlabThicknessM,
  cloudSlabThresholdThicknessM,
} from './cloud-column.js';
import { cloudForwardPhaseOf, cloudForwardShare } from './cloud-sun.js';

// The column model lives in `cloud-column.ts` (a leaf the sky's GLSL can
// import); re-exported here under its old names for the slab's callers.
export {
  cloudSlabCumulativeM,
  cloudSlabThicknessM,
  cloudSlabThresholdThicknessM,
} from './cloud-column.js';

export type Vec3 = readonly [number, number, number];

/** The step counts the shader is built for (a define per value). */
export const CLOUD_SLAB_STEPS = [8, 16, 24, 32] as const;
export type CloudSlabSteps = (typeof CLOUD_SLAB_STEPS)[number];

/**
 * The slab's geometry, density and light, metres (the scene's unit): the
 * column's (`cloud-column.ts`: base 1800 m, top 2200 m, σ, the base ramp b,
 * the height scale H and the sun's elevation floor) plus the march's own.
 */
export const CLOUD_SLAB = {
  ...CLOUD_COLUMN,
  /** The prism's radius: the sheet's, so the far fade ends inside it. */
  radiusM: CLOUD_SHEET.radiusM,
  /** k: the sun's path through the column is shortened for multiple scattering. */
  sunDepthScale: 0.25,
  /** ≥ hypot(far fade end, top): the far fade ends the clouds, never the cap. */
  maxMarchM: 22_000,
  /** The march stops once less than this share of the view passes through. */
  earlyExitTransmittance: 0.01,
  /** Below this |dir.y| a step's density is sampled, not integrated in height. */
  levelDirY: 1e-5,
  /**
   * The steps turn from quadratic (crowding at the entry) to uniform over
   * this height above the top (plan 2026-09-26-0549 §4): uniform from above,
   * where every ray crosses the whole slab, and a smoothstep between, so a
   * camera crossing the top (the globe descent) sees no jump.
   */
  uniformBlendM: 25,
  /**
   * Below this |x| (x = τ - the sun's depth change over a segment) the
   * in-step light uses its series; above it the closed form's cancellation
   * is below 1e-5 in float32 (GLSL has no `expm1`).
   */
  lightSeriesX: 1e-2,
  /**
   * The forward scattering (cloud-sun.ts) is faded out between this many
   * times the early exit's transmittance and the exit itself (τ 3.0 to 4.6),
   * where it is already small, so it is 0 before the depth is unknown.
   */
  forwardKnownFactor: 5,
  /**
   * 8 steps: the owner saw no difference worth the cost against 16-32 on the
   * look-dev page (round-2 plan 2026-09-26-2055 M2); the other counts stay
   * for the quality reference (8 against 32 in the tests).
   */
  defaultSteps: 8 satisfies CloudSlabSteps,
} as const;

/**
 * How far out the slab draws (metres, horizontal from the camera): full
 * weight to `farStartM`, none from `farEndM` (globe volume-cloud plan
 * 2026-10-05-0016 §13, R1).
 */
export interface CloudSlabReach {
  readonly farStartM: number;
  readonly farEndM: number;
}

/**
 * The default reach: the sheet's far fade, which the look-dev page's far
 * plane (30 km) and the mesh's radius were sized for.
 */
export const CLOUD_SLAB_REACH: CloudSlabReach = Object.freeze({
  farStartM: CLOUD_SHEET.farFadeStartM,
  farEndM: CLOUD_SHEET.farFadeEndM,
});

/**
 * Validates a reach (`CloudSlabReach`).
 *
 * @throws RangeError unless 0 <= farStartM < farEndM, both finite.
 */
export function assertCloudSlabReach(reach: CloudSlabReach): void {
  const { farStartM, farEndM } = reach;
  if (!(
    Number.isFinite(farStartM) &&
    Number.isFinite(farEndM) &&
    farStartM >= 0 &&
    farStartM < farEndM
  )) {
    throw new RangeError(
      `the reach must fade from 0 <= start < end, got ${farStartM} to ${farEndM}`
    );
  }
}

/** The march cap for a reach: `maxMarchM` scaled with the far fade's end. */
function maxMarchFor(reach: CloudSlabReach): number {
  return (CLOUD_SLAB.maxMarchM * reach.farEndM) / CLOUD_SHEET.farFadeEndM;
}

const T0 = cloudSlabThresholdThicknessM();

/** The noise texture's texel in metres: 24 km over 256 texels, 93.75 m. */
const TEXEL_M = (CLOUD_LAYER.tileKm * 1000) / CLOUD_TEXTURE_SIZE;

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
 * The interval's input checks; returns the direction's length.
 *
 * @throws RangeError as `cloudSlabInterval`.
 */
function assertSlabRay(y: number, dir: Vec3, sceneM: number): number {
  const length = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(Number.isFinite(y) && Number.isFinite(length) && length > 0)) {
    throw new RangeError(
      `slab ray needs a finite height and direction, got ${y}, ${dir.join(', ')}`
    );
  }
  if (!(sceneM >= 0)) {
    throw new RangeError(`the scene distance must be >= 0, got ${sceneM}`);
  }
  return length;
}

/**
 * The part of a ray from height `y` along `dir` that lies in the slab and
 * inside the far fade, as distances along the ray; null when there is none.
 * Analytic, never from the mesh's faces. `sceneM`, the distance to the
 * scene along the ray (the scene's depth, F2c), ends it there: a ridge in
 * front of the slab leaves nothing to march. GLSL twin: the interval of
 * `CLOUD_SLAB_FRAGMENT_GLSL` (the scene's part behind
 * `ATM_SLAB_SCENE_DEPTH`).
 *
 * @throws RangeError for a non-finite height, a direction that is not
 *   finite or has no length, or a scene distance that is negative or NaN.
 */
export function cloudSlabInterval(
  y: number,
  dir: Vec3,
  sceneM: number = Number.POSITIVE_INFINITY,
  reach: CloudSlabReach = CLOUD_SLAB_REACH
): { inM: number; outM: number } | null {
  assertCloudSlabReach(reach);
  const length = assertSlabRay(y, dir, sceneM);
  const dy = dir[1] / length;
  const horizontal = Math.hypot(dir[0], dir[2]) / length;
  const { baseM, topM } = CLOUD_SLAB;
  const tFar = reach.farEndM / Math.max(horizontal, 1e-6);
  const cap = Math.min(maxMarchFor(reach), tFar);
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
  outM = Math.min(outM, sceneM);
  return outM > inM ? { inM, outM } : null;
}

/**
 * How far the camera's spacing has turned from quadratic (0) to uniform (1):
 * 0 up to the top, 1 from `uniformBlendM` above it, a smoothstep between.
 * Quadratic from below and inside is a recorded decision (it crowds the
 * steps at the flat base, or at the camera); from above every ray crosses the
 * whole slab and uniform steps measured better at every view (plan
 * 2026-09-26-0549 §1, §4). GLSL twin: `share` in the march.
 */
export function cloudSlabUniformShare(cameraY: number): number {
  const { topM, uniformBlendM } = CLOUD_SLAB;
  if (uniformBlendM <= 0) return cameraY > topM ? 1 : 0;
  return smoothstep(topM, topM + uniformBlendM, cameraY);
}

/** u mapped to the march's spacing: u² (quadratic) mixed toward u (uniform). */
function spacing(u: number, uniformShare: number): number {
  return u * u + (u - u * u) * uniformShare;
}

/** @throws RangeError unless `value` is finite and in [0, 1]. */
function assertUnitInterval(value: number, what: string): void {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError(`${what} must be in [0, 1], got ${value}`);
  }
}

/**
 * The march's NODES over an interval of length `lengthM`, as offsets from its
 * entry: the entry, then one node `jitter` of the way through each of the
 * `steps` steps (in the spacing's measure), then the exit, so N + 2 nodes
 * and N + 1 segments that tile the interval exactly. The thickness is read
 * at the nodes and taken as linear between them (plan 2026-09-26-0549 §2
 * change 1). The shader jitters the nodes per pixel: a fixed placement drew
 * the far deck as terraced bands at level rays, where one step spans
 * kilometres of ground (plan 2026-09-24-1010 §13).
 *
 * @throws RangeError for a step count the shader is not built for, a
 *   negative or non-finite length, or a jitter or share outside [0, 1].
 */
export function cloudSlabNodes(
  steps: number,
  lengthM: number,
  jitter = 0.5,
  uniformShare = 0
): number[] {
  assertUnitInterval(jitter, 'slab step jitter');
  assertUnitInterval(uniformShare, 'slab uniform share');
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
  const nodes = [0];
  for (let i = 0; i < steps; i++) {
    nodes.push(spacing((i + jitter) / steps, uniformShare) * lengthM);
  }
  nodes.push(lengthM);
  return nodes;
}

/**
 * The part of a segment under the column top, as fractions [fa, fb] of the
 * segment, or null when none is. `da` and `db` are the top's height above the
 * ray at the segment's ends; the top is linear between them (the thickness is
 * linear in the noise before its clamp, and the ray never leaves [0, top -
 * base], so the clamp cannot move the crossing): the secant step of parallax
 * occlusion mapping, exact for the linear model. GLSL twin: `fa`/`fb`.
 */
export function cloudSlabOccupied(
  da: number,
  db: number
): [number, number] | null {
  if (da < 0 && db < 0) return null;
  const fa = da >= 0 ? 0 : da / (da - db);
  const fb = db >= 0 ? 1 : da / (da - db);
  return fb > fa ? [fa, fb] : null;
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
  return Math.min(1, Math.exp(-cloudSlabSunOpticalDepth(h, T, sunY)));
}

/**
 * The sun's optical depth to height h of a column of thickness T (the
 * exponent of `cloudSlabSunTransmittance`), never negative. GLSL twin:
 * `sunA`/`sunB` in the march.
 */
export function cloudSlabSunOpticalDepth(
  h: number,
  T: number,
  sunY: number
): number {
  const { extinctionPerM, sunDepthScale, sunMuFloor } = CLOUD_SLAB;
  const above =
    cloudSlabCumulativeM(T) - cloudSlabCumulativeM(Math.min(Math.max(h, 0), T));
  return (extinctionPerM * sunDepthScale * above) / Math.max(sunY, sunMuFloor);
}

/**
 * The SUNLIT share of a segment's opacity: ∫ e^(-τ(s)) R(s) dτ over the
 * segment, with its optical depth τ spread evenly along it and the sun's
 * reach R = e^(-sun depth) log-linear between its ends (`sunA` at the entry,
 * `sunB` at the exit). Closed form τ·(e^(-sunA) - e^(-sunB-τ)) / x with
 * x = τ - sunA + sunB, written so no exponent is positive (e^x would reach
 * e^20 from below, where the reach grows faster than the view is dimmed:
 * x < 0). Near x = 0 it cancels, so a series takes over below
 * `lightSeriesX`. Between 0 and 1 - e^(-τ), which it equals at R ≡ 1.
 * GLSL twin: `atmSlabInStepLight`.
 */
export function cloudSlabInStepLight(
  tau: number,
  sunA: number,
  sunB: number
): number {
  const x = tau - sunA + sunB;
  const ra = Math.exp(-sunA);
  if (Math.abs(x) < CLOUD_SLAB.lightSeriesX) {
    return tau * ra * (1 - x / 2 + (x * x) / 6);
  }
  return (tau * (ra - Math.exp(-sunB - tau))) / x;
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

/**
 * A sample's weight by horizontal distance: the reach's far fade (the
 * sheet's by default).
 *
 * @throws RangeError for a reach that does not fade from 0 <= start < end.
 */
export function cloudSlabFarWeight(
  horizontalM: number,
  reach: CloudSlabReach = CLOUD_SLAB_REACH
): number {
  assertCloudSlabReach(reach);
  return 1 - smoothstep(reach.farStartM, reach.farEndM, horizontalM);
}

/** The sun and sky a march lights its samples with (`cloudSlabMarch`). */
interface CloudSlabLight {
  /** The sun's transmittance at cloud height (LUT units). */
  readonly sunTransmittance: Vec3;
  /** Unit direction toward the sun, scene frame (y up). */
  readonly sunDir: Vec3;
  /** The zenith sky (LUT units), the ambient. */
  readonly zenith: Vec3;
  /**
   * The forward lobes' strengths (cloud-sun.ts): the aureole's and the
   * silver lining's, 0 or omitted: none. The shader's `atmCloudForward`.
   */
  readonly aureole?: number;
  readonly silverLining?: number;
}

export interface CloudSlabMarchInput {
  readonly camera: Vec3;
  /** Unit view direction. */
  readonly dir: Vec3;
  readonly steps: number;
  /** The combined noise at world x/z (metres) and a level of detail. */
  readonly sample: (xM: number, zM: number, lod: number) => number;
  readonly threshold: number;
  /**
   * The threshold at world x/z (metres), for a coverage map and the disc
   * (C1: `cloudThresholdForCover`, `cloudDiscThreshold`,
   * `cloud-coverage.ts`); omitted: `threshold` everywhere. The shader's
   * `atmCloudThresholdAt`.
   */
  readonly thresholdAt?: (xM: number, zM: number) => number;
  /** Radians per pixel (for the level of detail); 0 ignores the footprint. */
  readonly pixelAngle?: number;
  /** Where in each step the noise is sampled, [0, 1]; 0.5 (the middle) by default. */
  readonly jitter?: number;
  /** Omitted: only the opacity is marched. */
  readonly light?: CloudSlabLight;
  /** How far out it draws (`CLOUD_SLAB_REACH` when omitted). */
  readonly reach?: CloudSlabReach;
}

export interface CloudSlabMarchResult {
  /** The drawn alpha: each segment weighted by the far and aerial fades. */
  alpha: number;
  /** The unweighted opacity, 1 - the product of the segments' transmittances. */
  opacity: number;
  /** Premultiplied radiance (zero without `light`). */
  colour: [number, number, number];
  /** Segments actually marched, at most steps + 1 (fewer after an early exit). */
  stepsTaken: number;
}

/**
 * The march the shader runs, on the CPU: the interval; the nodes (quadratic
 * below and inside, uniform above); the noise read at every node and the
 * column top taken as linear between neighbours; per segment the part under
 * that top (the secant step), its exact optical depth, and the light
 * integrated over it in closed form (`cloudSlabInStepLight`); the far and
 * aerial weights on the contribution; and the early exit. The tests'
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
  const { reach } = input;
  const interval = cloudSlabInterval(
    camera[1],
    input.dir,
    Number.POSITIVE_INFINITY,
    reach
  );
  const length = Math.hypot(input.dir[0], input.dir[1], input.dir[2]);
  const dir: Vec3 = [
    input.dir[0] / length,
    input.dir[1] / length,
    input.dir[2] / length,
  ];
  if (interval === null || !Number.isFinite(threshold)) return result;
  const { baseM, topM, heightScaleM } = CLOUD_SLAB;
  const lengthM = interval.outM - interval.inM;
  const share = cloudSlabUniformShare(camera[1]);
  const nodes = cloudSlabNodes(steps, lengthM, input.jitter, share);
  const horizontal = Math.hypot(dir[0], dir[2]);
  const pixelAngle = input.pixelAngle ?? 0;
  const deck = topM - baseM;
  // A node's level of detail takes the segment that ends at it; the entry
  // takes a whole first step.
  const read = (t: number, stepM: number) =>
    sample(
      camera[0] + dir[0] * t,
      camera[2] + dir[2] * t,
      cloudSlabLod(t, pixelAngle, stepM, horizontal)
    );
  // The thickness BEFORE its clamp: linear in the noise, so linear between
  // nodes (see `cloudSlabOccupied`); the threshold read at each node.
  const raw = (noise: number, th: number) => T0 + heightScaleM * (noise - th);
  const thresholdAt = input.thresholdAt;
  const nodeThreshold = (t: number) =>
    thresholdAt === undefined
      ? threshold
      : thresholdAt(camera[0] + dir[0] * t, camera[2] + dir[2] * t);
  const height = (t: number) => camera[1] + dir[1] * t - baseM;
  let ta = interval.inM;
  let na = read(ta, spacing(1 / steps, share) * lengthM);
  let tha = nodeThreshold(ta);
  let top: [number, number, number] = [0, 0, 0];
  let cosToSun = 0;
  if (light) {
    cosToSun =
      dir[0] * light.sunDir[0] +
      dir[1] * light.sunDir[1] +
      dir[2] * light.sunDir[2];
    top = cloudSlabSourceRadiance(
      light.sunTransmittance,
      cosToSun,
      0,
      light.zenith,
      light.sunDir[1],
      1
    );
  }
  let transmittance = 1;
  for (let k = 1; k < nodes.length; k++) {
    const tb = interval.inM + nodes[k]!;
    const nb = read(tb, tb - ta);
    const thb = nodeThreshold(tb);
    const ra = raw(na, tha);
    const rb = raw(nb, thb);
    const occupied =
      tb > ta ? cloudSlabOccupied(ra - height(ta), rb - height(tb)) : null;
    result.stepsTaken = k;
    if (occupied) {
      const [fa, fb] = occupied;
      const t0 = ta + (tb - ta) * fa;
      const t1 = ta + (tb - ta) * fb;
      const tau = cloudSlabStepOpticalDepth(camera[1], dir[1], t0, t1, deck);
      const a = 1 - Math.exp(-tau);
      const tm = 0.5 * (t0 + t1);
      const w =
        cloudSlabFarWeight(tm * horizontal, reach) *
        Math.exp((-tm * 0.001) / CLOUD_LAYER.aerialKm);
      if (light) {
        const clampDeck = (v: number) => Math.min(Math.max(v, 0), deck);
        const sunA = cloudSlabSunOpticalDepth(
          height(t0),
          clampDeck(ra + (rb - ra) * fa),
          light.sunDir[1]
        );
        const sunB = cloudSlabSunOpticalDepth(
          height(t1),
          clampDeck(ra + (rb - ra) * fb),
          light.sunDir[1]
        );
        const lit = cloudSlabInStepLight(tau, sunA, sunB);
        // The source is linear in the reach: the underside for all of the
        // opacity, plus (top - underside) for its sunlit share.
        const under = cloudSlabSourceRadiance(
          light.sunTransmittance,
          cosToSun,
          cloudDensity(na + (nb - na) * 0.5 * (fa + fb), 0.5 * (tha + thb)),
          light.zenith,
          light.sunDir[1],
          0
        );
        const weight = transmittance * w;
        result.colour[0] += weight * (under[0] * a + (top[0] - under[0]) * lit);
        result.colour[1] += weight * (under[1] * a + (top[1] - under[1]) * lit);
        result.colour[2] += weight * (under[2] * a + (top[2] - under[2]) * lit);
      }
      result.alpha += transmittance * a * w;
      transmittance *= Math.exp(-tau);
      if (transmittance < CLOUD_SLAB.earlyExitTransmittance) break;
    }
    ta = tb;
    na = nb;
    tha = thb;
  }
  result.opacity = 1 - transmittance;
  addForwardGlow(result, light, cosToSun, transmittance);
  return result;
}

/**
 * The shader's forward glow after the march (round-3 DEC-FB3-6): the
 * marched depth's τ·e^(-τ) through the phase toward the sun, weighted like
 * the samples (alpha over the opacity), faded out before the early exit,
 * past which the depth is unknown. Nothing at strength 0 or without cloud.
 */
function addForwardGlow(
  result: CloudSlabMarchResult,
  light: CloudSlabLight | undefined,
  cosToSun: number,
  transmittance: number
): void {
  const aureole = light?.aureole ?? 0;
  const silverLining = light?.silverLining ?? 0;
  if (
    light === undefined ||
    !(aureole + silverLining > 0 && result.alpha >= 1e-4)
  ) {
    return;
  }
  const { earlyExitTransmittance, forwardKnownFactor } = CLOUD_SLAB;
  const tau = -Math.log(Math.max(transmittance, 1e-6));
  const weight = result.alpha / Math.max(result.opacity, 1e-6);
  const known = smoothstep(
    earlyExitTransmittance,
    forwardKnownFactor * earlyExitTransmittance,
    transmittance
  );
  const f =
    weight *
    known *
    cloudForwardPhaseOf(
      Math.min(Math.max(cosToSun, -1), 1),
      aureole,
      silverLining
    ) *
    cloudForwardShare(tau);
  for (let c = 0; c < 3; c++) {
    result.colour[c]! += light.sunTransmittance[c]! * f;
  }
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
 * sheet), the analytic interval, the jittered nodes (quadratic below and
 * inside, uniform above), per segment the part under the linear top, its
 * exact optical depth and the light integrated over it, the LUT reads
 * hoisted out of the loop, the far and aerial weights on the contribution,
 * and the early exit. Twin of
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
// The reach: the far fade's start and end, and the march cap (R1).
uniform vec3 atmSlabReach;
#ifdef ATM_SLAB_SCENE_DEPTH
uniform sampler2D atmSlabSceneDepth;
#endif
const float ATM_SLAB_BASE = ${glslFloat(CLOUD_SLAB.baseM)};
const float ATM_SLAB_TOP = ${glslFloat(CLOUD_SLAB.topM)};
const float ATM_SLAB_SIGMA = ${glslFloat(CLOUD_SLAB.extinctionPerM)};
const float ATM_SLAB_SOFT = ${glslFloat(CLOUD_SLAB.baseSoftM)};
const float ATM_SLAB_HEIGHT_SCALE = ${glslFloat(CLOUD_SLAB.heightScaleM)};
const float ATM_SLAB_T0 = ${glslFloat(cloudSlabThresholdThicknessM())};
const float ATM_SLAB_SUN_DEPTH = ${glslFloat(CLOUD_SLAB.sunDepthScale)};
const float ATM_SLAB_SUN_MU_FLOOR = ${glslFloat(CLOUD_SLAB.sunMuFloor)};
const float ATM_SLAB_EARLY_EXIT = ${glslFloat(CLOUD_SLAB.earlyExitTransmittance)};
const float ATM_SLAB_LEVEL_DIR_Y = ${glslFloat(CLOUD_SLAB.levelDirY)};
const float ATM_SLAB_TEXEL = ${glslFloat(TEXEL_M)};
const float ATM_SLAB_UNIFORM_BLEND = ${glslFloat(CLOUD_SLAB.uniformBlendM)};
const float ATM_SLAB_LIGHT_SERIES = ${glslFloat(CLOUD_SLAB.lightSeriesX)};
const float ATM_SLAB_FORWARD_KNOWN = ${glslFloat(CLOUD_SLAB.forwardKnownFactor)};

${CLOUD_COVERAGE_GLSL}
// Twin of cloudSlabCumulativeM.
float atmSlabCumulative(float h) {
  if (h <= 0.0) return 0.0;
  if (ATM_SLAB_SOFT <= 0.0) return h;
  return h < ATM_SLAB_SOFT ? h * h / (2.0 * ATM_SLAB_SOFT) : h - 0.5 * ATM_SLAB_SOFT;
}

// The thickness BEFORE its clamp (twin of the march's raw): linear in the
// noise, so linear between nodes, and the top crossing a secant step (the
// threshold is 2, above any noise, when clear: never occupied).
float atmSlabRawThickness(float noise, float threshold) {
  return ATM_SLAB_T0 + ATM_SLAB_HEIGHT_SCALE * (noise - threshold);
}

// The noise at distance t along the ray, its level from the pixel footprint
// or the step that reaches t, whichever is larger (twin of cloudSlabLod).
float atmSlabNoiseAt(float t, float stepM, vec3 dir, float horizontal) {
  float footprint = max(t * atmSlabPixelAngle, stepM * horizontal);
  float lod = footprint > 0.0 ? max(0.0, log2(footprint / ATM_SLAB_TEXEL)) : 0.0;
  return atmCloudNoiseLod((cameraPosition.xz + dir.xz * t) * 0.001 / ATM_CLOUD_TILE + atmCloudOffset, lod);
}

// Twin of cloudSlabInStepLight: the sunlit share of a segment's opacity,
// the reach log-linear between its ends. No exponent is positive; highp for
// the cancellation near x = 0 (the series takes over below it).
highp float atmSlabInStepLight(highp float tau, highp float sunA, highp float sunB) {
  highp float x = tau - sunA + sunB;
  highp float ra = exp(-sunA);
  if (abs(x) < ATM_SLAB_LIGHT_SERIES) return tau * ra * (1.0 - 0.5 * x + x * x / 6.0);
  return tau * (ra - exp(-sunB - tau)) / x;
}

void main() {
  if (atmCloudCover <= 0.0) discard;
  vec2 ndc = (gl_FragCoord.xy - atmSlabViewport.xy) / atmSlabViewport.zw * 2.0 - 1.0;
  vec4 view = atmSlabInverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(mat3(atmSlabCameraWorld) * (view.xyz / view.w));
  float y = cameraPosition.y;
  float horizontal = length(dir.xz);
  // Twin of cloudSlabInterval.
  float cap = min(atmSlabReach.z, atmSlabReach.y / max(horizontal, 1e-6));
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
#ifdef ATM_SLAB_SCENE_DEPTH
  float atmSceneDepth = texture2D(atmSlabSceneDepth, (gl_FragCoord.xy - atmSlabViewport.xy) / atmSlabViewport.zw).r;
  // The march ends at the scene (twin of cloudSlabInterval's sceneM): its
  // point through the same inverse projection as the ray; 1 is cleared.
  if (atmSceneDepth < 1.0) {
    vec4 atmScene = atmSlabInverseProjection * vec4(ndc, atmSceneDepth * 2.0 - 1.0, 1.0);
    tOut = min(tOut, length(atmScene.xyz / atmScene.w));
  }
#endif
  if (tOut <= tIn) discard;
  float lengthM = tOut - tIn;
  // Twin of cloudSlabUniformShare: quadratic from below and inside, uniform
  // from above, blended over ATM_SLAB_UNIFORM_BLEND above the top.
  float share = smoothstep(ATM_SLAB_TOP, ATM_SLAB_TOP + ATM_SLAB_UNIFORM_BLEND, y);
  // A static per-pixel jitter of the NODES inside their steps (interleaved
  // gradient noise): a fixed placement drew the far deck as terraced bands
  // at level rays. The entry and the exit do not move, so the segments
  // always tile the interval and a uniform column's opacity is exact.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // Hoisted: the same for every segment. atmCloudLit is affine in density.
  vec3 under0 = atmCloudLit(dir, atmObserverRadius, 0.0);
  vec3 under1 = atmCloudLit(dir, atmObserverRadius, 1.0);
  vec3 top = atmCloudTopLit(atmObserverRadius);
  highp float sunScale = ATM_SLAB_SIGMA * ATM_SLAB_SUN_DEPTH / max(atmSunDirection.y, ATM_SLAB_SUN_MU_FLOOR);
  float deck = ATM_SLAB_TOP - ATM_SLAB_BASE;
  vec3 colour = vec3(0.0);
  float alpha = 0.0;
  float transmittance = 1.0;
  // Node 0 is the entry; its level takes a whole first step.
  float first = 1.0 / float(ATM_SLAB_STEPS);
  float ta = tIn;
  float na = atmSlabNoiseAt(ta, mix(first * first, first, share) * lengthM, dir, horizontal);
  float tha = atmCloudThresholdAt(cameraPosition.xz + dir.xz * ta, atmCloudThreshold, atmCloudCover);
  // atm-slab-loop-begin
  for (int i = 0; i <= ATM_SLAB_STEPS; i++) {
    float u = i == ATM_SLAB_STEPS ? 1.0 : (float(i) + jitter) / float(ATM_SLAB_STEPS);
    float tb = tIn + mix(u * u, u, share) * lengthM;
    float nb = atmSlabNoiseAt(tb, tb - ta, dir, horizontal);
    float thb = atmCloudThresholdAt(cameraPosition.xz + dir.xz * tb, atmCloudThreshold, atmCloudCover);
    float ra = atmSlabRawThickness(na, tha);
    float rb = atmSlabRawThickness(nb, thb);
    float da = ra - (y + dir.y * ta - ATM_SLAB_BASE);
    float db = rb - (y + dir.y * tb - ATM_SLAB_BASE);
    if (tb > ta && (da >= 0.0 || db >= 0.0)) {
      // The secant step: the part of the segment under the linear top.
      float fa = da >= 0.0 ? 0.0 : da / (da - db);
      float fb = db >= 0.0 ? 1.0 : da / (da - db);
      float t0 = mix(ta, tb, fa);
      float t1 = mix(ta, tb, fb);
      float h0 = clamp(y + dir.y * t0 - ATM_SLAB_BASE, 0.0, deck);
      float h1 = clamp(y + dir.y * t1 - ATM_SLAB_BASE, 0.0, deck);
      float tau = 0.0;
      if (abs(dir.y) >= ATM_SLAB_LEVEL_DIR_Y) {
        tau = ATM_SLAB_SIGMA * abs(atmSlabCumulative(h1) - atmSlabCumulative(h0)) / abs(dir.y);
      } else {
        float hm = y + dir.y * 0.5 * (t0 + t1) - ATM_SLAB_BASE;
        float p = ATM_SLAB_SOFT <= 0.0 ? 1.0 : clamp(hm / ATM_SLAB_SOFT, 0.0, 1.0);
        tau = (hm < 0.0 || hm > deck) ? 0.0 : ATM_SLAB_SIGMA * p * (t1 - t0);
      }
      float a = 1.0 - exp(-tau);
      float tm = 0.5 * (t0 + t1);
      float w = (1.0 - smoothstep(atmSlabReach.x, atmSlabReach.y, tm * horizontal))
        * exp(-tm * 0.001 / ATM_CLOUD_AERIAL_KM);
      // The sun's depth at each end, through the interpolated column above it.
      float c0 = clamp(mix(ra, rb, fa), 0.0, deck);
      float c1 = clamp(mix(ra, rb, fb), 0.0, deck);
      highp float sunA = sunScale * (atmSlabCumulative(c0) - atmSlabCumulative(min(h0, c0)));
      highp float sunB = sunScale * (atmSlabCumulative(c1) - atmSlabCumulative(min(h1, c1)));
      vec3 under = mix(under0, under1, atmCloudDensity(mix(na, nb, 0.5 * (fa + fb)), 0.5 * (tha + thb)));
      colour += transmittance * w * (under * a + (top - under) * atmSlabInStepLight(tau, sunA, sunB));
      alpha += transmittance * a * w;
      transmittance *= exp(-tau);
      if (transmittance < ATM_SLAB_EARLY_EXIT) break;
    }
    ta = tb;
    na = nb;
    tha = thb;
  }
  // atm-slab-loop-end
  // Premultiplied: back to straight colour, with a floor against division.
  if (alpha < 1e-4) discard;
  // The forward scattering (cloud-sun.ts) through the marched optical depth,
  // weighted like the samples (alpha over the unweighted opacity), and faded
  // out toward the early exit, past which the depth is unknown: a thick
  // cloud would otherwise glow at the exit's depth.
  if (atmCloudForward.x + atmCloudForward.y > 0.0) {
    highp float tauView = -log(max(transmittance, 1e-6));
    float weight = alpha / max(1.0 - transmittance, 1e-6);
    float known = smoothstep(ATM_SLAB_EARLY_EXIT, ATM_SLAB_FORWARD_KNOWN * ATM_SLAB_EARLY_EXIT, transmittance);
    colour += weight * known * atmCloudForwardRadiance(dir, atmObserverRadius, tauView);
  }
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
 * Gives the slab the scene's depth (globe F2 plan 2026-10-03-1922, F2c), or
 * takes it away (null). With a depth the march ends at the scene and the
 * depth test is OFF: as a back-faced prism under the depth test, a ridge in
 * front of the prism's far face hid the cloud in front of the ridge too.
 * Without one the slab is today's. The depth must cover the same viewport
 * as the slab's render and must not be attached to the target the slab
 * draws into (a read of an attached depth is a feedback loop). Only a
 * switch between depth and none builds a new program; swapping one depth
 * for another (a resize) is a uniform.
 */
export function setCloudSlabSceneDepth(
  slab: THREE.Mesh,
  depth: THREE.Texture | null
): void {
  const material = slab.material as THREE.ShaderMaterial;
  const uniform = material.uniforms['atmSlabSceneDepth'];
  if (uniform === undefined) {
    throw new TypeError('not a cloud slab: it has no scene depth uniform');
  }
  const had = uniform.value !== null;
  uniform.value = depth;
  if (had === (depth !== null)) return;
  const { ATM_SLAB_SCENE_DEPTH: _old, ...rest } = material.defines;
  material.defines =
    depth === null ? rest : { ...rest, ATM_SLAB_SCENE_DEPTH: 1 };
  material.depthTest = depth === null;
  material.needsUpdate = true;
}

/**
 * A coverage map for the slab (globe volume-cloud plan 2026-10-05-0016,
 * C1), or none (null): the caller's chunk defines
 * `float atmCloudCoverageAt(vec2 xz)`, the local cover (0 … 1) at world x/z
 * (metres) (`cloud-coverage.ts`); the local cover times the global cover
 * becomes the column's threshold through the noise's quantiles, so the
 * volume's clouds sit where the map has them. A new program on each change
 * (a define and the shader).
 *
 * @throws RangeError for a chunk that does not define atmCloudCoverageAt.
 */
export function setCloudSlabCoverage(
  slab: THREE.Mesh,
  coverage: CloudCoverage | null
): void {
  const material = slab.material as THREE.ShaderMaterial;
  const { ATM_CLOUD_COVERAGE: _old, ...rest } = material.defines;
  if (coverage === null) {
    material.defines = rest;
    material.fragmentShader = CLOUD_SLAB_FRAGMENT_GLSL;
    material.needsUpdate = true;
    return;
  }
  const fragment = withCloudCoverage(CLOUD_SLAB_FRAGMENT_GLSL, coverage.glsl);
  Object.assign(material.uniforms, coverage.uniforms);
  material.uniforms['atmCoverThresholds']!.value = [...cloudCoverThresholds()];
  material.defines = { ...rest, ATM_CLOUD_COVERAGE: 1 };
  material.fragmentShader = fragment;
  material.needsUpdate = true;
}

/**
 * The slab's disc around the camera (C1): its clouds fade to clear from 0.7
 * `radiusM` to `radiusM` horizontally (`cloudDiscThreshold`), so a shell
 * can draw the clouds beyond; null for no disc. A new program only when the
 * disc is turned on or off; another radius is a uniform.
 *
 * @throws RangeError for a radius that is not positive and finite.
 */
export function setCloudSlabRadius(
  slab: THREE.Mesh,
  radiusM: number | null
): void {
  if (radiusM !== null && !(radiusM > 0 && Number.isFinite(radiusM))) {
    throw new RangeError(`the disc radius must be positive, got ${radiusM}`);
  }
  const material = slab.material as THREE.ShaderMaterial;
  const had = material.defines['ATM_CLOUD_DISC'] !== undefined;
  if (radiusM !== null) material.uniforms['atmCoverDiscM']!.value = radiusM;
  if (had === (radiusM !== null)) return;
  const { ATM_CLOUD_DISC: _old, ...rest } = material.defines;
  material.defines = radiusM === null ? rest : { ...rest, ATM_CLOUD_DISC: 1 };
  material.needsUpdate = true;
}

/**
 * How far out the slab draws (globe volume-cloud plan 2026-10-05-0016 §13,
 * R1), or the default (null): the far fade and the march cap (a uniform,
 * no new program), and the mesh scaled out horizontally so it still
 * covers the far fade's end. The look-dev page keeps the default, which
 * its 30 km far plane was sized for.
 *
 * @throws RangeError for a reach that does not fade from 0 <= start < end.
 */
export function setCloudSlabReach(
  slab: THREE.Mesh,
  reach: CloudSlabReach | null
): void {
  const r = reach ?? CLOUD_SLAB_REACH;
  assertCloudSlabReach(r);
  const material = slab.material as THREE.ShaderMaterial;
  (material.uniforms['atmSlabReach']!.value as THREE.Vector3).set(
    r.farStartM,
    r.farEndM,
    reach === null ? CLOUD_SLAB.maxMarchM : maxMarchFor(r)
  );
  const k = Math.max(1, r.farEndM / CLOUD_SHEET.farFadeEndM);
  slab.scale.set(k, 1, k);
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
    // Declared from the start, so turning the depth on is a define, not a
    // new uniform set (`setCloudSlabSceneDepth`).
    atmSlabSceneDepth: { value: null as THREE.Texture | null },
    // The reach (R1): the default until setCloudSlabReach.
    atmSlabReach: {
      value: new THREE.Vector3(
        CLOUD_SLAB_REACH.farStartM,
        CLOUD_SLAB_REACH.farEndM,
        CLOUD_SLAB.maxMarchM
      ),
    },
    // The coverage map's threshold table and the disc's radius, declared
    // from the start like the depth (set by setCloudSlabCoverage and
    // setCloudSlabRadius; unread until their defines are on).
    ...cloudCoverageUniforms(),
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
