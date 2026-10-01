/**
 * The water polish (round-3 plan 2026-09-27-0532, stream W; DEC-FB3-9): six
 * cheap shading tricks ON TOP of a wave set, each behind its own switch so
 * each can be judged alone against the unpolished water.
 *
 * 1. `lostVariance`: the slope variance of the waves the anti-aliasing fade
 *    removed (Σ (1 − fade²)·(A·k)²/2) is added to the specular α², so water
 *    whose waves a pixel can no longer resolve turns to a soft sheen instead
 *    of glittering.
 * 2. `sunSize`: the sun's disc is not a point; its angular size is added to
 *    α² of the DIRECT light only, so no highlight is narrower than the sun.
 * 3. `fresnelDamp`: the environment reflection divided by (1 + c·α²), so a
 *    rough surface mirrors less at grazing angles.
 * 4. `antiTiling`: the finest waves are sampled a second time, their
 *    direction rotated and their wavelength rescaled, and the two blended by
 *    a low-frequency noise mask, so the shortest ripples do not repeat.
 * 5. `gusts`: a slow noise field travelling with the wind scales the short
 *    ripples' slopes, so the surface has calmer and rougher patches.
 * 6. `body`: the water body is lit by the DOWNWELLING light (the flat
 *    surface's irradiance, sun and sky) times its reflectance, weighted by
 *    the light the surface lets out (1 − Fresnel), instead of Lambert on the
 *    wave normal; plus light through backlit crests (wave faces tilted
 *    toward a viewer who looks toward the sun).
 *
 * Every switch is COMPILED IN OR OUT (no `#define`, no branch on a uniform),
 * so with all of them off the water's shader source, program key and
 * uniforms are exactly the unpolished water's (a test pins them). Each
 * switch's constants are uniforms, so a sweep changes them without a
 * recompile. The per-wave tricks (1, 4, 5) hook the wave set's per-wave
 * statement (see {@link buildWaterPolish}); the lighting tricks (2, 3, 6)
 * wrap three's physical light functions by name, copying no chunk text.
 *
 * @see water-polish.ts.md
 */
import * as THREE from 'three';

import { glslFloat } from '../../utils/glsl-float.js';
import { smoothstep } from '../../utils/smoothstep.js';

/** The switches, in their canonical order (the program key's order). */
export const WATER_POLISH_SWITCHES = [
  'lostVariance',
  'sunSize',
  'fresnelDamp',
  'antiTiling',
  'gusts',
  'body',
] as const;

export type WaterPolishSwitch = (typeof WATER_POLISH_SWITCHES)[number];

/** Which tricks are on; a switch not named is off. */
export type WaterPolishFlags = Partial<Record<WaterPolishSwitch, boolean>>;

/**
 * The swept constants' defaults (the stream-W record logs each sweep and
 * the value picked). All are uniforms except where marked FIXED.
 */
export const WATER_POLISH = {
  /** 1: weight of the lost variance in α² (1: the waves' own variance). */
  varianceScale: 1,
  /** 2: FIXED, the sun's mean angular radius, radians (0.2666°). */
  sunAngularRadiusRad: 0.004653,
  /** 2: α² of the direct light gains (sunSizeScale × radius)². */
  sunSizeScale: 1,
  /** 3: the reflection is divided by (1 + fresnelDamp × α²). */
  fresnelDamp: 6,
  /** 4: waves with k at or above this (rad/m) get the second sample. */
  tileMinK: 1.5,
  /** 4: the second sample's direction, rotated by this, radians. */
  tileRotationRad: 0.5,
  /** 4: the second sample's wavenumber, k × tileScale. */
  tileScale: 0.83,
  /** 4: the blend mask's noise cell, metres. */
  tileMaskM: 15,
  /** 4: FIXED, the second sample's phase offset, radians (decorrelation). */
  tilePhaseRad: 2,
  /** 4: FIXED, the mask's noise edges: 0 below, 1 above. */
  tileMaskEdges: [-0.35, 0.35] as const,
  /** 5: waves with k at or above this (rad/m) are the gusts' ripples. */
  gustMinK: 0.6,
  /** 5: the gust field's noise cell, metres. */
  gustScaleM: 50,
  /** 5: how fast the gust field travels downwind, m/s. */
  gustSpeedMps: 2.5,
  /** 5: gain = max(0, 1 + depth × noise), noise in [-1, 1]. */
  gustDepth: 0.7,
  /** 5: FIXED, the wind's unit direction on the water (x, z). */
  gustWind: [0.878, 0.479] as const,
  /** 6: the crest light's strength (a share of the sun's irradiance). */
  crestStrength: 0.2,
  /** 6: how tightly the crest light follows the view toward the sun. */
  crestPower: 4,
  /** 6: the tilt toward the viewer at which a crest is fully lit. */
  crestSlope: 0.1,
  /** 6: FIXED, the crest light's colour, linear RGB (green-blue water). */
  crestColor: [0.1, 0.45, 0.35] as const,
} as const;

/** The swept constants a sweep may change (see {@link WATER_POLISH}). */
export interface WaterPolishParams {
  readonly varianceScale: number;
  readonly sunSizeScale: number;
  readonly fresnelDamp: number;
  readonly tileMinK: number;
  readonly tileRotationRad: number;
  readonly tileScale: number;
  readonly tileMaskM: number;
  readonly gustMinK: number;
  readonly gustScaleM: number;
  readonly gustSpeedMps: number;
  readonly gustDepth: number;
  readonly crestStrength: number;
  readonly crestPower: number;
  readonly crestSlope: number;
}

type Range = readonly [min: number, max: number, minOpen?: boolean];

/** Each parameter's accepted range: [min, max], min exclusive if flagged. */
const PARAM_RANGES: Record<keyof WaterPolishParams, Range> = {
  varianceScale: [0, 100],
  sunSizeScale: [0, 100],
  fresnelDamp: [0, 1000],
  tileMinK: [0, 1000, true],
  tileRotationRad: [-2 * Math.PI, 2 * Math.PI],
  tileScale: [0, 10, true],
  tileMaskM: [0, 1e5, true],
  gustMinK: [0, 1000],
  gustScaleM: [0, 1e5, true],
  gustSpeedMps: [0, 100],
  gustDepth: [0, 1],
  crestStrength: [0, 10],
  crestPower: [0, 256, true],
  crestSlope: [0, 10, true],
};

/** The swept constants at their defaults (a sweep's "back to default"). */
export const WATER_POLISH_DEFAULT_PARAMS: Readonly<WaterPolishParams> =
  Object.freeze(
    Object.fromEntries(
      Object.keys(PARAM_RANGES).map((name) => [
        name,
        WATER_POLISH[name as keyof WaterPolishParams],
      ])
    ) as unknown as WaterPolishParams
  );

/**
 * The flags with every switch named, validated: a key that is not a switch
 * (a typo would otherwise switch nothing, silently) or a value that is not
 * a boolean is a RangeError.
 */
export function normalizeWaterPolish(
  flags: WaterPolishFlags = {}
): Readonly<Record<WaterPolishSwitch, boolean>> {
  if (flags === null || typeof flags !== 'object') {
    throw new RangeError('water polish must be an object of switches');
  }
  for (const [key, value] of Object.entries(flags)) {
    if (!(WATER_POLISH_SWITCHES as readonly string[]).includes(key)) {
      throw new RangeError(
        `unknown water polish switch "${key}"; one of ${WATER_POLISH_SWITCHES.join(', ')}`
      );
    }
    if (value !== undefined && typeof value !== 'boolean') {
      throw new RangeError(`water polish "${key}" must be a boolean`);
    }
  }
  const out = {} as Record<WaterPolishSwitch, boolean>;
  for (const name of WATER_POLISH_SWITCHES) out[name] = flags[name] === true;
  return Object.freeze(out);
}

// --- the TS twins ------------------------------------------------------------

/** The GGX α² of a three roughness r (three: α = r²). */
const alpha2 = (roughness: number) => roughness ** 4;
/** The roughness of a GGX α², capped at three's 1. */
const roughnessOf = (a2: number) => Math.min(1, a2 ** 0.25);

/** The anti-aliasing fade the wave sets use (phase change per pixel, rad). */
const WATER_POLISH_FADE_RAD = [0.8, 1.6] as const;

/**
 * Trick 1's twin: the slope variance (both axes) the fade removed from
 * waves `{ k, ak }` for a pixel footprint (m): Σ (1 − fade²)·(A·k)²/2, the
 * fade being the shader's, of the phase change k × footprint.
 */
export function waterLostVariance(
  waves: readonly { readonly k: number; readonly ak: number }[],
  footprintM: number
): number {
  if (!(Number.isFinite(footprintM) && footprintM >= 0)) {
    throw new RangeError(`footprint must be finite and ≥ 0, got ${footprintM}`);
  }
  let lost = 0;
  for (const { k, ak } of waves) {
    const fade =
      1 -
      smoothstep(
        WATER_POLISH_FADE_RAD[0],
        WATER_POLISH_FADE_RAD[1],
        k * footprintM
      );
    lost += (1 - fade * fade) * ((ak * ak) / 2);
  }
  return lost;
}

/** Trick 1's roughness: α² gains scale × the lost variance. */
export function waterVarianceRoughness(
  roughness: number,
  lostVariance: number,
  scale: number = WATER_POLISH.varianceScale
): number {
  return roughnessOf(alpha2(roughness) + scale * lostVariance);
}

/** Trick 2's roughness for the direct light: α² gains (scale × radius)². */
export function waterSunRoughness(
  roughness: number,
  scale: number = WATER_POLISH.sunSizeScale,
  radiusRad: number = WATER_POLISH.sunAngularRadiusRad
): number {
  return roughnessOf(alpha2(roughness) + (scale * radiusRad) ** 2);
}

/** Trick 3's factor on the environment reflection: 1 / (1 + c × α²). */
export function waterFresnelDampFactor(
  roughness: number,
  c: number = WATER_POLISH.fresnelDamp
): number {
  return 1 / (1 + c * alpha2(roughness));
}

/** Trick 5's gain on a ripple's slope, from a noise value in [-1, 1]. */
export function waterGustGain(
  noise: number,
  depth: number = WATER_POLISH.gustDepth
): number {
  return Math.max(0, 1 + depth * noise);
}

/**
 * Trick 4's second sample of a wave: its direction (unit, x/z) rotated, its
 * wavenumber scaled, and its angular frequency by deep-water dispersion
 * (ω ∝ √k), so the rescaled ripple still travels at its own speed.
 */
export function waterTileWave(
  direction: readonly [number, number],
  k: number,
  omega: number,
  rotationRad: number = WATER_POLISH.tileRotationRad,
  scale: number = WATER_POLISH.tileScale
): { direction: [number, number]; k: number; omega: number } {
  const c = Math.cos(rotationRad);
  const s = Math.sin(rotationRad);
  const [dx, dz] = direction;
  return {
    direction: [c * dx - s * dz, s * dx + c * dz],
    k: k * scale,
    omega: omega * Math.sqrt(scale),
  };
}

/**
 * Trick 4's blend weights for the first and second sample at mask value m
 * in [0, 1]: (1 − m, m) normalised so their squares sum to 1. Two
 * uncorrelated samples mixed by weights that sum to 1 would lose variance
 * (71 % of the ripples' strength at an even mix), which reads as calmer
 * water where the mask is half-way, not as less repetition.
 */
export function waterTileBlend(mask: number): [number, number] {
  const norm = Math.hypot(1 - mask, mask);
  return [(1 - mask) / norm, mask / norm];
}

// --- uniforms ---------------------------------------------------------------

/** The polish's uniforms (shared objects, read by every compiled program). */
export interface WaterPolishUniforms {
  [name: string]: THREE.IUniform;
  uWaterPolishVarianceScale: THREE.IUniform<number>;
  uWaterPolishSunAlpha2: THREE.IUniform<number>;
  uWaterPolishFresnelDamp: THREE.IUniform<number>;
  uWaterPolishTileMinK: THREE.IUniform<number>;
  uWaterPolishTileRot: THREE.IUniform<THREE.Vector2>;
  uWaterPolishTileScale: THREE.IUniform<number>;
  uWaterPolishTileMaskM: THREE.IUniform<number>;
  uWaterPolishGustMinK: THREE.IUniform<number>;
  uWaterPolishGustScaleM: THREE.IUniform<number>;
  uWaterPolishGustSpeed: THREE.IUniform<number>;
  uWaterPolishGustDepth: THREE.IUniform<number>;
  uWaterPolishCrestStrength: THREE.IUniform<number>;
  uWaterPolishCrestPower: THREE.IUniform<number>;
  uWaterPolishCrestSlope: THREE.IUniform<number>;
}

/** Uniforms at {@link WATER_POLISH}'s defaults. */
export function createWaterPolishUniforms(): WaterPolishUniforms {
  const uniforms = {
    uWaterPolishVarianceScale: { value: 0 },
    uWaterPolishSunAlpha2: { value: 0 },
    uWaterPolishFresnelDamp: { value: 0 },
    uWaterPolishTileMinK: { value: 0 },
    uWaterPolishTileRot: { value: new THREE.Vector2() },
    uWaterPolishTileScale: { value: 0 },
    uWaterPolishTileMaskM: { value: 0 },
    uWaterPolishGustMinK: { value: 0 },
    uWaterPolishGustScaleM: { value: 0 },
    uWaterPolishGustSpeed: { value: 0 },
    uWaterPolishGustDepth: { value: 0 },
    uWaterPolishCrestStrength: { value: 0 },
    uWaterPolishCrestPower: { value: 0 },
    uWaterPolishCrestSlope: { value: 0 },
  };
  configureWaterPolishUniforms(uniforms, WATER_POLISH_DEFAULT_PARAMS);
  return uniforms;
}

/** How each parameter reaches its uniform. */
const SETTERS: Record<
  keyof WaterPolishParams,
  (u: WaterPolishUniforms, value: number) => void
> = {
  varianceScale: (u, v) => (u.uWaterPolishVarianceScale.value = v),
  sunSizeScale: (u, v) =>
    (u.uWaterPolishSunAlpha2.value =
      (v * WATER_POLISH.sunAngularRadiusRad) ** 2),
  fresnelDamp: (u, v) => (u.uWaterPolishFresnelDamp.value = v),
  tileMinK: (u, v) => (u.uWaterPolishTileMinK.value = v),
  tileRotationRad: (u, v) => {
    u.uWaterPolishTileRot.value.set(Math.cos(v), Math.sin(v));
  },
  tileScale: (u, v) => (u.uWaterPolishTileScale.value = v),
  tileMaskM: (u, v) => (u.uWaterPolishTileMaskM.value = v),
  gustMinK: (u, v) => (u.uWaterPolishGustMinK.value = v),
  gustScaleM: (u, v) => (u.uWaterPolishGustScaleM.value = v),
  gustSpeedMps: (u, v) => (u.uWaterPolishGustSpeed.value = v),
  gustDepth: (u, v) => (u.uWaterPolishGustDepth.value = v),
  crestStrength: (u, v) => (u.uWaterPolishCrestStrength.value = v),
  crestPower: (u, v) => (u.uWaterPolishCrestPower.value = v),
  crestSlope: (u, v) => (u.uWaterPolishCrestSlope.value = v),
};

/** RangeError unless `name` is a parameter and `value` is in its range. */
function checkParam(name: string, value: unknown): void {
  const range = PARAM_RANGES[name as keyof WaterPolishParams];
  if (range === undefined) {
    throw new RangeError(`unknown water polish parameter "${name}"`);
  }
  const [min, max, minOpen] = range;
  const inRange =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value <= max &&
    (minOpen ? value > min : value >= min);
  if (!inRange) {
    throw new RangeError(
      `water polish "${name}" must be a finite number in ${minOpen ? '(' : '['}${min}, ${max}], got ${String(value)}`
    );
  }
}

/**
 * Write `values` (any subset of {@link WaterPolishParams}) into the
 * uniforms. Validates everything first, so a bad value changes nothing:
 * RangeError for `values` that is not an object, an unknown name, a
 * non-finite number or one outside its range.
 */
export function configureWaterPolishUniforms(
  uniforms: WaterPolishUniforms,
  values: Partial<WaterPolishParams>
): void {
  if (values === null || typeof values !== 'object') {
    throw new RangeError(
      `water polish parameters must be an object, got ${String(values)}`
    );
  }
  const entries = Object.entries(values);
  for (const [name, value] of entries) checkParam(name, value);
  for (const [name, value] of entries) {
    SETTERS[name as keyof WaterPolishParams](uniforms, value);
  }
}

// --- GLSL -------------------------------------------------------------------

const P = WATER_POLISH;
const F = WATER_POLISH_FADE_RAD;

/**
 * The per-wave function a wave set must have for tricks 1, 4 and 5: its
 * first parameter (the position the waves are evaluated at) is captured.
 */
const WAVE_FUNCTION =
  /void\s+waterWave\s*\(\s*vec2\s+(\w+)\s*,\s*float\s+t\s*,\s*vec2\s+d\s*,\s*float\s+k\s*,\s*float\s+ak\s*,\s*float\s+w\s*,\s*float\s+phase\s*,\s*inout\s+vec2\s+slope\s*\)/g;
/** Its one statement that adds the wave's slope; the cosine's argument is captured. */
const WAVE_STATEMENT =
  /slope\s*\+=\s*fade\s*\*\s*ak\s*\*\s*cos\(([^;]*)\)\s*\*\s*d\s*;/g;

/** A value noise in [-1, 1] from an integer hash (no texture). */
const NOISE_GLSL = /* glsl */ `float waterPolishHash(vec2 cell) {
  uvec2 c = uvec2(ivec2(cell) + ivec2(65536));
  uint h = (c.x * 0x8da6b343u) ^ (c.y * 0xd8163841u);
  h ^= h >> 15u; h *= 0x2c1b3c6du; h ^= h >> 12u; h *= 0x297a2d39u; h ^= h >> 15u;
  return float(h) * (2.0 / 4294967295.0) - 1.0;
}
float waterPolishNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = waterPolishHash(i);
  float b = waterPolishHash(i + vec2(1.0, 0.0));
  float c = waterPolishHash(i + vec2(0.0, 1.0));
  float d = waterPolishHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

/** The GLSL text each anchor gains, for one set of switches. */
export interface WaterPolishGlsl {
  /** True when any switch is on (all texts are empty otherwise). */
  readonly active: boolean;
  /** Declarations, after the water's own and BEFORE the wave set. */
  readonly declarations: string;
  /** The wave set with its per-wave statement hooked (or unchanged). */
  slope(slopeGlsl: string): string;
  /** Statements before the wave set is called (the per-pixel fields). */
  readonly beforeSlope: string;
  /** After `#include <lights_physical_fragment>` (the material's roughness). */
  readonly afterMaterial: string;
  /** After `#include <lights_physical_pars_fragment>` (the light wrappers). */
  readonly afterLightingPars: string;
}

const UNIFORM_DECLARATIONS = [
  'uniform float uWaterPolishVarianceScale;',
  'uniform float uWaterPolishSunAlpha2;',
  'uniform float uWaterPolishFresnelDamp;',
  'uniform float uWaterPolishTileMinK;',
  'uniform vec2 uWaterPolishTileRot;',
  'uniform float uWaterPolishTileScale;',
  'uniform float uWaterPolishTileMaskM;',
  'uniform float uWaterPolishGustMinK;',
  'uniform float uWaterPolishGustScaleM;',
  'uniform float uWaterPolishGustSpeed;',
  'uniform float uWaterPolishGustDepth;',
  'uniform float uWaterPolishCrestStrength;',
  'uniform float uWaterPolishCrestPower;',
  'uniform float uWaterPolishCrestSlope;',
].join('\n');

type Switches = Readonly<Record<WaterPolishSwitch, boolean>>;

/** Tricks 1, 4 and 5: the per-pixel fields and the per-wave hook. */
function perWaveDeclarations(on: Switches): string[] {
  const lines: string[] = [];
  if (on.lostVariance) lines.push('float waterLostVar;');
  if (on.gusts) lines.push('float waterGustGain;');
  if (on.antiTiling) lines.push('float waterTileMask;');
  if (on.antiTiling || on.gusts) lines.push(NOISE_GLSL);
  if (on.lostVariance || on.antiTiling || on.gusts) lines.push(waveHook(on));
  return lines;
}

/** The per-wave hook the wave set's slope statement is routed through. */
function waveHook(on: Switches): string {
  const gust = on.gusts
    ? `  amp *= mix(1.0, waterGustGain, step(uWaterPolishGustMinK, k));\n`
    : '';
  // The tile branch's condition is uniform across the pixel quad (k is a
  // per-call constant, the edge a uniform), so fwidth inside it is defined.
  const tiles = on.antiTiling
    ? `  if (k >= uWaterPolishTileMinK) {
    vec2 d2 = vec2(uWaterPolishTileRot.x * d.x - uWaterPolishTileRot.y * d.y,
                   uWaterPolishTileRot.y * d.x + uWaterPolishTileRot.x * d.y);
    float ph2 = k * uWaterPolishTileScale * dot(d2, q);
    float fade2 = 1.0 - smoothstep(${glslFloat(F[0])}, ${glslFloat(F[1])}, fwidth(ph2));
    vec2 s2 = fade2 * amp * cos(ph2 - w * sqrt(uWaterPolishTileScale) * t + phase + ${glslFloat(P.tilePhaseRad)}) * d2;
    // Weights whose squares sum to 1 (twin: waterTileBlend), so the blend
    // keeps the ripples' variance; the lost variance mixes by the squares.
    vec2 wt = vec2(1.0 - waterTileMask, waterTileMask) / length(vec2(1.0 - waterTileMask, waterTileMask));
    s = wt.x * s + wt.y * s2;
    lost = wt.x * wt.x * lost + wt.y * wt.y * (1.0 - fade2 * fade2);
  }\n`
    : '';
  const accumulate = on.lostVariance
    ? `  waterLostVar += lost * amp * amp * 0.5;\n`
    : '';
  return `// The polish's per-wave hook: the wave's own term (gust-scaled), the
// finest waves' rotated second sample, and the variance the fade removed.
void waterPolishWave(vec2 q, float t, vec2 d, float k, float ak, float w, float phase, float fade, float arg, inout vec2 slope) {
  float amp = ak;
${gust}  vec2 s = fade * amp * cos(arg) * d;
  float lost = 1.0 - fade * fade;
${tiles}  slope += s;
${accumulate}}`;
}

/** The per-pixel fields, set before the wave set runs. */
function beforeSlopeGlsl(on: Switches): string {
  const before: string[] = [];
  if (on.lostVariance) before.push('waterLostVar = 0.0;');
  if (on.gusts) {
    before.push(
      `waterGustGain = max(0.0, 1.0 + uWaterPolishGustDepth * waterPolishNoise((vWaterWorldXZ - vec2(${glslFloat(P.gustWind[0])}, ${glslFloat(P.gustWind[1])}) * (uWaterPolishGustSpeed * uWaterTime)) / uWaterPolishGustScaleM));`
    );
  }
  if (on.antiTiling) {
    before.push(
      `waterTileMask = smoothstep(${glslFloat(P.tileMaskEdges[0])}, ${glslFloat(P.tileMaskEdges[1])}, waterPolishNoise(vWaterWorldXZ / uWaterPolishTileMaskM + vec2(17.0, 43.0)));`
    );
  }
  return before.join('\n');
}

/** Tricks 2 and 6: three's direct light function, wrapped. */
function directWrapper(on: Switches): string {
  const body: string[] = ['  PhysicalMaterial m = material;'];
  if (on.sunSize) {
    body.push(
      '  m.roughness = min(pow(pow4(m.roughness) + uWaterPolishSunAlpha2, 0.25), 1.0);'
    );
  }
  if (on.body) body.push('  m.diffuseContribution = vec3(0.0);');
  body.push(
    '  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, m, reflectedLight);'
  );
  if (on.body) {
    body.push(`  vec3 up = waterPolishUp();
  float leave = waterPolishOut(geometryNormal, geometryViewDir, material);
  // The body: the flat surface's irradiance, not the wave normal's.
  vec3 down = saturate(dot(up, directLight.direction)) * directLight.color;
  reflectedLight.directDiffuse += down * BRDF_Lambert(material.diffuseContribution) * leave;
  // Light through backlit crests: looking toward the light, on faces
  // tilted toward the viewer.
  float back = pow(saturate(dot(-geometryViewDir, directLight.direction)), uWaterPolishCrestPower);
  float tilt = saturate(dot(geometryNormal - up, geometryViewDir) / uWaterPolishCrestSlope);
  reflectedLight.directDiffuse += directLight.color * vec3(${glslFloat(P.crestColor[0])}, ${glslFloat(P.crestColor[1])}, ${glslFloat(P.crestColor[2])}) * (uWaterPolishCrestStrength * back * tilt * leave);`);
  }
  return `void waterPolishDirect(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
${body.join('\n')}
}`;
}

/** Tricks 3 and 6: three's environment light function, wrapped. */
function indirectWrapper(on: Switches): string {
  const body: string[] = [
    '  PhysicalMaterial m = material;',
    '  ReflectedLight part = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));',
  ];
  if (on.body) body.push('  m.diffuseContribution = vec3(0.0);');
  body.push(
    '  RE_IndirectSpecular_Physical(radiance, irradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, m, part);'
  );
  if (on.fresnelDamp) {
    body.push(
      '  part.indirectSpecular /= 1.0 + uWaterPolishFresnelDamp * pow4(material.roughness);'
    );
  }
  body.push(
    '  reflectedLight.indirectSpecular += part.indirectSpecular;',
    '  reflectedLight.indirectDiffuse += part.indirectDiffuse;'
  );
  if (on.body) {
    body.push(`  vec3 sky = irradiance;
  #ifdef USE_ENVMAP
    sky = getIBLIrradiance(waterPolishUp());
  #endif
  reflectedLight.indirectDiffuse += sky * BRDF_Lambert(material.diffuseContribution) * waterPolishOut(geometryNormal, geometryViewDir, material);`);
  }
  return `void waterPolishIndirectSpecular(const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
${body.join('\n')}
}`;
}

/** The light wrappers, redefining three's names; empty without tricks 2, 3, 6. */
function lightingGlsl(on: Switches): string {
  if (!(on.sunSize || on.fresnelDamp || on.body)) return '';
  return `
// The water polish's light wrappers (three's own functions, called by name).
vec3 waterPolishUp() { return normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); }
// Schlick with the material's F0: the share of light the surface lets out.
float waterPolishOut(const in vec3 n, const in vec3 v, const in PhysicalMaterial m) {
  float f0 = m.specularColor.g;
  return 1.0 - (f0 + (1.0 - f0) * pow(1.0 - saturate(dot(n, v)), 5.0));
}
${directWrapper(on)}
${indirectWrapper(on)}
#undef RE_Direct
#define RE_Direct waterPolishDirect
#undef RE_IndirectSpecular
#define RE_IndirectSpecular waterPolishIndirectSpecular`;
}

/**
 * The polish's GLSL for `flags`. The wave-set hook (tricks 1, 4, 5) needs
 * the wave set's `void waterWave(vec2 <pos>, float t, vec2 d, float k,
 * float ak, float w, float phase, inout vec2 slope)` with the one statement
 * `slope += fade * ak * cos(<arg>) * d;` (the built-in waves and every
 * generated candidate have it); `slope()` throws a RangeError otherwise.
 */
export function buildWaterPolish(
  flags: WaterPolishFlags = {}
): WaterPolishGlsl {
  const on = normalizeWaterPolish(flags);
  const active = WATER_POLISH_SWITCHES.some((name) => on[name]);
  if (!active) {
    return {
      active,
      declarations: '',
      slope: (glsl) => glsl,
      beforeSlope: '',
      afterMaterial: '',
      afterLightingPars: '',
    };
  }
  const perWave = on.lostVariance || on.antiTiling || on.gusts;
  return {
    active,
    declarations: [UNIFORM_DECLARATIONS, ...perWaveDeclarations(on)].join('\n'),
    slope: (glsl) => (perWave ? hookWaves(glsl) : glsl),
    beforeSlope: beforeSlopeGlsl(on),
    afterMaterial: on.lostVariance
      ? '\nmaterial.roughness = min(pow(pow4(material.roughness) + uWaterPolishVarianceScale * waterLostVar, 0.25), 1.0);'
      : '',
    afterLightingPars: lightingGlsl(on),
  };
}

/** Route the wave set's per-wave statement through `waterPolishWave`. */
function hookWaves(slopeGlsl: string): string {
  const functions = [...slopeGlsl.matchAll(WAVE_FUNCTION)];
  const statements = [...slopeGlsl.matchAll(WAVE_STATEMENT)];
  if (functions.length !== 1 || statements.length !== 1) {
    throw new RangeError(
      'water polish (lostVariance, antiTiling, gusts) needs the wave set\'s one "void waterWave(vec2 p, float t, vec2 d, float k, float ak, float w, float phase, inout vec2 slope)" with one "slope += fade * ak * cos(...) * d;"'
    );
  }
  const position = functions[0]![1]!;
  return slopeGlsl.replace(
    WAVE_STATEMENT,
    (_statement, arg: string) =>
      `waterPolishWave(${position}, t, d, k, ak, w, phase, fade, ${arg}, slope);`
  );
}
