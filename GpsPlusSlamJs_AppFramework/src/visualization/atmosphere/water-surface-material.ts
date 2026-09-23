/**
 * The lightweight water surface (plan 2026-09-23-0048, M4; DEC-SKY-3, the
 * owner's words: "keep the water part very lightweight").
 *
 * NOT A CUSTOM SHADER. A `MeshPhysicalMaterial` with water's index of
 * refraction (Schlick F0 0.02) gets the sky reflection from
 * `scene.environment`, the sun glint from the directional light's GGX lobe,
 * and the atmosphere haze like any other lit material; the patch only adds
 * what three lacks: two layers of scrolling procedural wave normals, and a
 * distance fade that moves the normals' variance into roughness so the far
 * surface does not shimmer. No texture, no render target, no reflection pass.
 *
 * Every GLSL number comes from {@link WATER_SURFACE}, and the TS twins
 * (`waterSlope`, `waterNormal`, the distance terms) are what the tests check.
 *
 * The surface is assumed HORIZONTAL (world +y up): lakes, rivers, harbours.
 * NOT supported: instanced or batched meshes (the world position skips
 * `instanceMatrix`, so every instance repeats one wave pattern) and
 * double-sided water (the normal is always the upper side's).
 *
 * @see water-surface-material.ts.md
 */
import * as THREE from 'three';

import { glslFloat } from '../../utils/glsl-float.js';
import { smoothstep } from '../../utils/smoothstep.js';

const GRAVITY = 9.81;

/** Deep-water phase speed, m/s: c = √(gλ / 2π). */
function deepWaterSpeed(wavelengthM: number): number {
  return Math.sqrt((GRAVITY * wavelengthM) / (2 * Math.PI));
}

interface WaveSpec {
  /** Travel direction, degrees clockwise from +x toward +z. */
  readonly directionDeg: number;
  readonly wavelengthM: number;
  readonly amplitudeM: number;
  readonly phase: number;
}

function wave(spec: WaveSpec) {
  return { ...spec, speedMps: deepWaterSpeed(spec.wavelengthM) } as const;
}

/**
 * The water's constants. Two layers of three waves (a wind sea and a cross
 * sea ~75° apart); steepest possible slope Σ A·k ≈ 0.16, a calm lake.
 * Wavelengths are sized for the city view (tens to hundreds of metres from
 * the camera); a closer camera would want a shorter set.
 */
export const WATER_SURFACE = {
  ior: 1.333,
  /** Constant depth tint (linear RGB): deep green-blue. */
  tint: [0.02, 0.07, 0.08] as const,
  /**
   * Above three's physical-lighting floor (0.0525, `lights_physical_fragment`),
   * so the TS twin says what the GPU draws; 0.04 was fiction (M4 review,
   * finding 7).
   */
  roughnessNear: 0.06,
  roughnessFar: 0.22,
  /** Roughness ramps from near to far over this camera distance, m. */
  roughnessRampM: [60, 900] as const,
  /**
   * Per-wave anti-aliasing: a wave fades out as its phase changes by
   * [start, end] radians across one pixel (`fwidth` in the shader). Nyquist
   * is π; fading from 0.8 (≈ 8 px per wavelength) keeps the fade ahead of
   * the shimmer. Replaced a single distance fade for all six waves, which
   * left the 3.3 m wave shimmering at 200-300 m (M4 review, finding 7).
   */
  aliasFadeRad: [0.8, 1.6] as const,
  waves: [
    wave({ directionDeg: 20, wavelengthM: 21, amplitudeM: 0.105, phase: 0.0 }),
    wave({ directionDeg: 35, wavelengthM: 10, amplitudeM: 0.045, phase: 1.3 }),
    wave({ directionDeg: 10, wavelengthM: 5, amplitudeM: 0.018, phase: 2.9 }),
    wave({ directionDeg: 95, wavelengthM: 16, amplitudeM: 0.075, phase: 0.7 }),
    wave({ directionDeg: 110, wavelengthM: 7, amplitudeM: 0.027, phase: 4.1 }),
    wave({
      directionDeg: 80,
      wavelengthM: 3.3,
      amplitudeM: 0.0105,
      phase: 5.6,
    }),
  ],
} as const;

/**
 * How much of a wave of wavenumber `k` survives the anti-aliasing fade when
 * one pixel spans `footprintM` metres of water (1 = all, 0 = none). The
 * shader measures the phase change per pixel with `fwidth`; k · footprint is
 * its twin.
 */
export function waterWaveFade(k: number, footprintM: number): number {
  const [start, end] = WATER_SURFACE.aliasFadeRad;
  return 1 - smoothstep(start, end, k * footprintM);
}

/**
 * Surface slope (∂h/∂x, ∂h/∂z) at world (x, z) and time t, s. With a pixel
 * footprint (m), each wave is faded as the shader fades it.
 */
export function waterSlope(
  x: number,
  z: number,
  t: number,
  footprintM = 0
): [number, number] {
  let sx = 0;
  let sz = 0;
  for (const w of WATER_SURFACE.waves) {
    const k = (2 * Math.PI) / w.wavelengthM;
    const fade = footprintM > 0 ? waterWaveFade(k, footprintM) : 1;
    if (fade === 0) continue;
    const a = (w.directionDeg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const c =
      fade *
      w.amplitudeM *
      k *
      Math.cos(k * (dx * x + dz * z) - k * w.speedMps * t + w.phase);
    sx += c * dx;
    sz += c * dz;
  }
  return [sx, sz];
}

/** Unit surface normal at world (x, z) and time t. */
export function waterNormal(
  x: number,
  z: number,
  t: number
): [number, number, number] {
  const [sx, sz] = waterSlope(x, z, t);
  const length = Math.hypot(sx, 1, sz);
  return [-sx / length, 1 / length, -sz / length];
}

/** Roughness by distance: the lost wave detail reappears as blur. */
export function waterRoughnessAtDistance(distanceM: number): number {
  const { roughnessNear, roughnessFar, roughnessRampM } = WATER_SURFACE;
  const t = smoothstep(roughnessRampM[0], roughnessRampM[1], distanceM);
  return roughnessNear + (roughnessFar - roughnessNear) * t;
}

function wavesGlsl(): string {
  return WATER_SURFACE.waves
    .map((w) => {
      const k = (2 * Math.PI) / w.wavelengthM;
      const a = (w.directionDeg * Math.PI) / 180;
      return `  waterWave(p, t, vec2(${glslFloat(Math.cos(a))}, ${glslFloat(Math.sin(a))}), ${glslFloat(k)}, ${glslFloat(w.amplitudeM * k)}, ${glslFloat(k * w.speedMps)}, ${glslFloat(w.phase)}, slope);`;
    })
    .join('\n');
}

const S = WATER_SURFACE;

const VERTEX_PARS = /* glsl */ `#include <common>
varying vec2 vWaterWorldXZ;`;

const VERTEX = /* glsl */ `#include <project_vertex>
vWaterWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`;

const FRAGMENT_PARS = /* glsl */ `#include <common>
uniform float uWaterTime;
varying vec2 vWaterWorldXZ;
// One travelling wave's slope: A·k·cos(k(d·p) − ωt + φ) along its direction,
// faded as its phase change per pixel nears aliasing (twin: waterWaveFade).
void waterWave(vec2 p, float t, vec2 d, float k, float ak, float w, float phase, inout vec2 slope) {
  float fade = 1.0 - smoothstep(${glslFloat(S.aliasFadeRad[0])}, ${glslFloat(S.aliasFadeRad[1])}, fwidth(k * dot(d, p)));
  slope += fade * ak * cos(k * dot(d, p) - w * t + phase) * d;
}
vec2 waterSlopeAt(vec2 p, float t) {
  vec2 slope = vec2(0.0);
${wavesGlsl()}
  return slope;
}`;

const ROUGHNESS = /* glsl */ `#include <roughnessmap_fragment>
float waterDistance = length(vViewPosition);
float waterFar = smoothstep(${glslFloat(S.roughnessRampM[0])}, ${glslFloat(S.roughnessRampM[1])}, waterDistance);
roughnessFactor = max(roughnessFactor, mix(${glslFloat(S.roughnessNear)}, ${glslFloat(S.roughnessFar)}, waterFar));`;

const NORMAL = /* glsl */ `#include <normal_fragment_maps>
{
  vec2 waterSlope = waterSlopeAt(vWaterWorldXZ, uWaterTime);
  vec3 waterNormalWorld = normalize(vec3(-waterSlope.x, 1.0, -waterSlope.y));
  normal = normalize((viewMatrix * vec4(waterNormalWorld, 0.0)).xyz);
}`;

function replaceAnchor(
  source: string,
  anchor: string,
  replacement: string
): string {
  if (!source.includes(anchor)) {
    throw new Error(
      `water surface: three's shader has no "${anchor}" to patch`
    );
  }
  return source.replace(anchor, replacement);
}

export interface WaterSurfaceOptions {
  /** Depth tint, linear RGB. Default {@link WATER_SURFACE}.tint. */
  readonly tint?: THREE.Color;
}

/** The water material and its clock. */
export class WaterSurface {
  readonly material: THREE.MeshPhysicalMaterial;
  /** Shared by every program compiled from the material. */
  readonly uniforms = { uWaterTime: { value: 0 } };

  constructor(options: WaterSurfaceOptions = {}) {
    const tint = options.tint ?? new THREE.Color(...S.tint);
    if (![tint.r, tint.g, tint.b].every(Number.isFinite)) {
      throw new RangeError('water tint must be a finite colour');
    }
    this.material = new THREE.MeshPhysicalMaterial({
      color: tint,
      roughness: S.roughnessNear,
      metalness: 0,
      ior: S.ior,
    });
    this.material.name = 'water-surface';
    const uniforms = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <common>',
        VERTEX_PARS
      );
      shader.vertexShader = replaceAnchor(
        shader.vertexShader,
        '#include <project_vertex>',
        VERTEX
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <common>',
        FRAGMENT_PARS
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <roughnessmap_fragment>',
        ROUGHNESS
      );
      shader.fragmentShader = replaceAnchor(
        shader.fragmentShader,
        '#include <normal_fragment_maps>',
        NORMAL
      );
      Object.assign(shader.uniforms, uniforms);
    };
  }

  /**
   * Advance the waves by `seconds` (≥ 0). No GPU work. The clock is never
   * rebased: in float32 the fastest wave's phase loses ~0.03 rad of
   * precision after a day and ~0.25 rad after a week (a visible stutter), so
   * an always-on page should create a new surface daily. Fine for the
   * look-dev page and for demos (M4 review, finding 11).
   */
  update(seconds: number): void {
    if (!(Number.isFinite(seconds) && seconds >= 0)) {
      throw new RangeError(
        `seconds must be a finite number ≥ 0, got ${seconds}`
      );
    }
    this.uniforms.uWaterTime.value += seconds;
  }

  dispose(): void {
    this.material.dispose();
  }
}
