/**
 * The CPU twin of the atmosphere's scattering passes: phase functions, the
 * multi-scattering term Ψ (Hillaire 2020 §5.5) and the sky march that fills
 * the sky-view LUT (§5.3).
 *
 * WHAT IT IS FOR. Not for rendering: the GPU does that from
 * `atmosphere-glsl.ts`, which mirrors these functions line for line. This
 * module is the oracle the look-dev page's parity readback compares the GPU
 * LUTs against, and the place the physics is tested, because a shader cannot
 * be unit-tested in CI (no GPU) and fails silently when wrong.
 *
 * The one deliberate difference from the GPU: this module computes sun
 * transmittance EXACTLY (`transmittanceToTop`), where the GPU reads the
 * transmittance LUT bilinearly. The parity tolerance covers that difference.
 *
 * Every radiance here is for a sun of unit illuminance; the caller scales.
 *
 * @see atmosphere-scattering.ts.md
 */

import {
  EARTH_ATMOSPHERE,
  mieExtinctionForVisibility,
  rayHitsGround,
  distanceToAtmosphereTop,
  mediumAt,
  transmittanceToTop,
  type AtmosphereParams,
  type Rgb,
} from './atmosphere-model.js';

const GROUND = EARTH_ATMOSPHERE.groundRadiusKm;

/** Rayleigh phase function, normalised over the sphere. */
export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Cornette-Shanks phase function (Mie approximation), normalised over the sphere. */
export function miePhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  const num = (1 - g2) * (1 + cosTheta * cosTheta);
  const den = (2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
  return ((3 / (8 * Math.PI)) * num) / den;
}

/** Ψ at a radius and sun cos-zenith: the multi-scattered luminance per unit scattering. */
export type PsiLookup = (r: number, sunCosZenith: number) => Rgb;

type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where a ray from `origin` along `dir` ends: the ground, or the top of the atmosphere. */
function rayEnd(
  origin: Vec3,
  dir: Vec3
): { length: number; hitsGround: boolean } {
  const r = Math.hypot(origin[0], origin[1], origin[2]);
  const mu = dot(origin, dir) / r;
  if (rayHitsGround(r, mu)) {
    // Near root of |o + t d|² = ground².
    const b = r * mu;
    const c = r * r - GROUND * GROUND;
    return {
      length: Math.max(0, -b - Math.sqrt(Math.max(0, b * b - c))),
      hitsGround: true,
    };
  }
  return { length: distanceToAtmosphereTop(r, mu), hitsGround: false };
}

/** Sun transmittance to a point, zero if the planet is in the way. */
function sunTransmittance(p: Vec3, sun: Vec3, params: AtmosphereParams): Rgb {
  const r = Math.hypot(p[0], p[1], p[2]);
  return transmittanceToTop(r, dot(p, sun) / r, params);
}

/** Direction from spherical angles about +y, azimuth measured from +x (the sun's plane). */
function direction(zenith: number, azimuth: number): Vec3 {
  const s = Math.sin(zenith);
  return [s * Math.cos(azimuth), Math.cos(zenith), s * Math.sin(azimuth)];
}

/** Hillaire's multi-scattering LUT texel: the transfer factor f_ms and Ψ = L2 / (1 − f_ms). */
export interface MultiScattering {
  readonly fms: Rgb;
  readonly psi: Rgb;
}

/**
 * One multi-scattering LUT texel (Hillaire 2020 §5.5).
 *
 * From a point at radius `r`, march `sqrtDirections²` directions spread
 * uniformly over the sphere, accumulating the second-order luminance L2
 * (sunlight scattered once toward the point, isotropically) and the transfer
 * factor f_ms (how much of an isotropic unit illumination scatters again).
 * The infinite series of higher orders sums to L2 / (1 − f_ms). Storing only
 * L2 would make blue hour go dark too early.
 *
 * Per-step integration is analytic over the step's constant medium:
 * ∫ S e^(−σt·s) ds = S (1 − e^(−σt·Δ)) / σt.
 */
export function multiScattering(
  r: number,
  sunCosZenith: number,
  params: AtmosphereParams,
  sqrtDirections: number = EARTH_ATMOSPHERE.multiScatteringSqrtDirections,
  steps: number = EARTH_ATMOSPHERE.multiScatteringSteps
): MultiScattering {
  const mieExt = mieExtinctionForVisibility(params.visibilityKm);
  const origin: Vec3 = [0, r, 0];
  const sun: Vec3 = [
    Math.sqrt(Math.max(0, 1 - sunCosZenith ** 2)),
    sunCosZenith,
    0,
  ];
  const isotropic = 1 / (4 * Math.PI);
  const l2 = [0, 0, 0];
  const fms = [0, 0, 0];
  const n = sqrtDirections * sqrtDirections;

  for (let i = 0; i < sqrtDirections; i++) {
    for (let j = 0; j < sqrtDirections; j++) {
      const azimuth = (2 * Math.PI * (i + 0.5)) / sqrtDirections;
      const zenith = Math.acos(1 - (2 * (j + 0.5)) / sqrtDirections);
      const dir = direction(zenith, azimuth);
      const end = rayEnd(origin, dir);
      const throughput = [1, 1, 1];
      for (let k = 0; k < steps; k++) {
        // Quadratic placement, like the other two integrals: a near-horizontal
        // ray is ~1 100 km long and uniform steps missed the 1.2 km Mie layer
        // at its start (sweep: up to 42 % error in hazy air, low sun).
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const tm = (k + 0.5) / steps;
        const t = tm * tm * end.length;
        const dt = (t1 * t1 - t0 * t0) * end.length;
        const p: Vec3 = [dir[0] * t, r + dir[1] * t, dir[2] * t];
        const m = mediumAt(Math.hypot(p[0], p[1], p[2]) - GROUND, mieExt);
        const sunT = sunTransmittance(p, sun, params);
        for (let c = 0; c < 3; c++) {
          const scattering = m.rayleighScattering[c]! + m.mieScattering;
          const sigma = Math.max(m.extinction[c]!, 1e-9);
          const stepT = Math.exp(-sigma * dt);
          const inScatter = scattering * isotropic * sunT[c]!;
          l2[c]! += (throughput[c]! * (inScatter - inScatter * stepT)) / sigma;
          fms[c]! +=
            (throughput[c]! * (scattering - scattering * stepT)) / sigma;
          throughput[c]! *= stepT;
        }
      }
      if (end.hitsGround) {
        const p: Vec3 = [
          dir[0] * end.length,
          r + dir[1] * end.length,
          dir[2] * end.length,
        ];
        const normalDotSun = Math.max(
          0,
          dot(p, sun) / Math.hypot(p[0], p[1], p[2])
        );
        const sunT = sunTransmittance(p, sun, params);
        for (let c = 0; c < 3; c++) {
          l2[c]! +=
            (throughput[c]! *
              sunT[c]! *
              normalDotSun *
              EARTH_ATMOSPHERE.groundAlbedo) /
            Math.PI;
        }
      }
    }
  }
  // Uniform sphere: solid angle 4π / n per direction, isotropic phase 1 / 4π.
  const f: Rgb = [fms[0]! / n, fms[1]! / n, fms[2]! / n];
  const L: Rgb = [l2[0]! / n, l2[1]! / n, l2[2]! / n];
  return {
    fms: f,
    psi: [L[0] / (1 - f[0]), L[1] / (1 - f[1]), L[2] / (1 - f[2])],
  };
}

/**
 * Sky radiance seen from radius `r` in a view direction, for a unit sun
 * (the sky-view LUT's content, Hillaire 2020 §5.3).
 *
 * Marches to the top of the atmosphere, or to the ground below the horizon,
 * where the lit ground's own radiance is added (albedo / π). Steps use the
 * same quadratic placement as the transmittance integral: the densest air is
 * next to the observer, and so is most of the Mie glow at the horizon.
 */
export function skyRadiance(
  r: number,
  viewZenithRad: number,
  deltaAzimuthRad: number,
  sunCosZenith: number,
  params: AtmosphereParams,
  psi: PsiLookup,
  steps: number = EARTH_ATMOSPHERE.skyViewSteps
): Rgb {
  const mieExt = mieExtinctionForVisibility(params.visibilityKm);
  const origin: Vec3 = [0, r, 0];
  const sun: Vec3 = [
    Math.sqrt(Math.max(0, 1 - sunCosZenith ** 2)),
    sunCosZenith,
    0,
  ];
  const dir = direction(viewZenithRad, deltaAzimuthRad);
  const cosTheta = dot(dir, sun);
  const phaseR = rayleighPhase(cosTheta);
  const phaseM = miePhase(cosTheta, EARTH_ATMOSPHERE.miePhaseG);
  const end = rayEnd(origin, dir);
  const radiance = [0, 0, 0];
  const throughput = [1, 1, 1];

  for (let k = 0; k < steps; k++) {
    const t0 = k / steps;
    const t1 = (k + 1) / steps;
    const tm = (k + 0.5) / steps;
    const t = tm * tm * end.length;
    const dt = (t1 * t1 - t0 * t0) * end.length;
    const p: Vec3 = [dir[0] * t, r + dir[1] * t, dir[2] * t];
    const pr = Math.hypot(p[0], p[1], p[2]);
    const m = mediumAt(pr - GROUND, mieExt);
    const sunT = sunTransmittance(p, sun, params);
    const multi = psi(pr, dot(p, sun) / pr);
    for (let c = 0; c < 3; c++) {
      const rs = m.rayleighScattering[c]!;
      const single = sunT[c]! * (rs * phaseR + m.mieScattering * phaseM);
      const source = single + multi[c]! * (rs + m.mieScattering);
      const sigma = Math.max(m.extinction[c]!, 1e-9);
      const stepT = Math.exp(-sigma * dt);
      radiance[c]! += (throughput[c]! * (source - source * stepT)) / sigma;
      throughput[c]! *= stepT;
    }
  }
  if (end.hitsGround) {
    const p: Vec3 = [
      dir[0] * end.length,
      r + dir[1] * end.length,
      dir[2] * end.length,
    ];
    const normalDotSun = Math.max(
      0,
      dot(p, sun) / Math.hypot(p[0], p[1], p[2])
    );
    const sunT = sunTransmittance(p, sun, params);
    for (let c = 0; c < 3; c++) {
      radiance[c]! +=
        (throughput[c]! *
          sunT[c]! *
          normalDotSun *
          EARTH_ATMOSPHERE.groundAlbedo) /
        Math.PI;
    }
  }
  return [radiance[0]!, radiance[1]!, radiance[2]!];
}
