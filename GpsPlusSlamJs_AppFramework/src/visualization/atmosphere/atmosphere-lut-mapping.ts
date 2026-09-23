/**
 * How the atmosphere's look-up tables (LUTs) are laid out: texel ↔ physical
 * parameters, both directions.
 *
 * WHY IT IS ITS OWN MODULE. Every function here has a line-for-line GLSL twin in
 * `atmosphere-glsl.ts`: the LUT passes WRITE with the `…UvToParams` direction,
 * and the sky, the haze and the other passes READ with `…ParamsToUv`. A
 * disagreement between the two does not error; it shifts or folds the sky.
 * Keeping the pair together, and tested as round trips, is what holds them to
 * one another.
 *
 * All mappings work in UNIT space `[0, 1]`. Sampling a texel centre goes
 * through {@link texelToUnit} / {@link unitToTexel} as a separate step, so the
 * parameter range's endpoints (zenith, horizon) land exactly on the first and
 * last texel centres instead of half a texel inside them.
 *
 * Sources: Bruneton 2017 ("Precomputed Atmospheric Scattering: a New
 * Implementation") for the transmittance mapping, Hillaire 2020 §5.3 for the
 * sky-view mapping. Implemented from the papers (plan DEC-SKY-1).
 *
 * @see atmosphere-lut-mapping.ts.md
 */

import {
  EARTH_ATMOSPHERE,
  distanceToAtmosphereTop,
} from './atmosphere-model.js';

/**
 * LUT sizes, width × height. Transmittance and sky view are the papers'
 * sizes (Hillaire 2020) and have NOT been swept here; the look-dev parity
 * check bounds their texel content, not their interpolation error across a
 * screen. The multi-scattering width WAS swept (below).
 */
export const TRANSMITTANCE_LUT_SIZE = { width: 256, height: 64 } as const;
/**
 * 128 columns of sun cos-zenith, not Hillaire's 32. MEASURED (2026-09-23, the
 * look-dev parity check failed at blue hour, then a CPU replica of the LUT
 * reproduced the GPU's numbers): Ψ falls steeply across the terminator, and a
 * bilinear 32-column LUT (≈3.7° of sun elevation per texel) overestimated
 * the blue-hour sky by up to ~150 %. 64 columns: ~25 %. 128: ~2 %. Daytime
 * is within 1 % at every width. The cost only lands when visibility changes.
 */
export const MULTI_SCATTERING_LUT_SIZE = { width: 128, height: 32 } as const;
export const SKY_VIEW_LUT_SIZE = { width: 192, height: 108 } as const;

const GROUND = EARTH_ATMOSPHERE.groundRadiusKm;
const TOP = EARTH_ATMOSPHERE.topRadiusKm;
/** Distance to the top along the horizon ray from the ground. */
const H = Math.sqrt(TOP * TOP - GROUND * GROUND);

/** Texture coordinate of a texel centre → unit parameter (first/last centre → 0/1). */
export function texelToUnit(x: number, size: number): number {
  return (x - 0.5 / size) / (1 - 1 / size);
}

/** Unit parameter → texture coordinate, the inverse of {@link texelToUnit}. */
export function unitToTexel(x: number, size: number): number {
  return 0.5 / size + x * (1 - 1 / size);
}

/** A ray's origin radius (km) and the cosine of its zenith angle. */
export interface RadiusMu {
  readonly r: number;
  readonly mu: number;
}

/**
 * Transmittance LUT, unit coordinates → `(r, mu)`.
 *
 * `v` is `rho / H` (rho = the horizon distance from `r`), which spreads the
 * rows evenly over the distance to the horizon rather than over altitude. `u`
 * interpolates the distance to the top between its minimum (straight up) and
 * its maximum (grazing), so every column is a ray that reaches space and the
 * horizon is the last column.
 */
export function transmittanceUvToParams(u: number, v: number): RadiusMu {
  const rho = H * v;
  const r = Math.sqrt(rho * rho + GROUND * GROUND);
  const dMin = TOP - r;
  const dMax = rho + H;
  const d = dMin + u * (dMax - dMin);
  const mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
  return { r, mu: Math.max(-1, Math.min(1, mu)) };
}

/** Transmittance LUT, `(r, mu)` → unit coordinates. */
export function transmittanceParamsToUv(
  r: number,
  mu: number
): { u: number; v: number } {
  const rho = Math.sqrt(Math.max(0, r * r - GROUND * GROUND));
  const d = distanceToAtmosphereTop(r, mu);
  const dMin = TOP - r;
  const dMax = rho + H;
  return { u: (d - dMin) / (dMax - dMin), v: rho / H };
}

/**
 * The view zenith angle of the horizon from radius `r` (`π − β`), and `β`, the
 * angular extent of the ground below it.
 */
function horizonAngles(r: number): { zenithHorizon: number; beta: number } {
  const beta = Math.acos(Math.sqrt(Math.max(0, r * r - GROUND * GROUND)) / r);
  return { zenithHorizon: Math.PI - beta, beta };
}

/** A view direction relative to the sun: its zenith angle and its azimuth from the sun. */
export interface SkyViewParams {
  readonly viewZenithRad: number;
  /** Azimuth between the view and the sun, `[0, π]`; the sky is symmetric about the sun's plane. */
  readonly deltaAzimuthRad: number;
}

/**
 * Sky-view LUT, unit coordinates → view direction, for an observer at `r`.
 *
 * LATITUDE: `v = 0.5` is exactly the horizon. Above it, the rows crowd toward
 * the horizon quadratically; below it, toward the horizon too. That is where
 * the sky's colour changes fastest, and a row across it would blur the
 * horizon. LONGITUDE: `u²` crowds the columns toward the sun, where the Mie
 * glow is sharp.
 */
export function skyViewUvToParams(
  r: number,
  u: number,
  v: number
): SkyViewParams {
  const { zenithHorizon, beta } = horizonAngles(r);
  let viewZenithRad: number;
  if (v < 0.5) {
    const c = 1 - 2 * v;
    viewZenithRad = zenithHorizon * (1 - c * c);
  } else {
    const c = 2 * v - 1;
    viewZenithRad = zenithHorizon + beta * c * c;
  }
  return { viewZenithRad, deltaAzimuthRad: Math.PI * u * u };
}

/** Sky-view LUT, view direction → unit coordinates. */
export function skyViewParamsToUv(
  r: number,
  viewZenithRad: number,
  deltaAzimuthRad: number
): { u: number; v: number } {
  const { zenithHorizon, beta } = horizonAngles(r);
  let v: number;
  if (viewZenithRad < zenithHorizon) {
    const c = Math.max(0, 1 - viewZenithRad / zenithHorizon);
    v = (1 - Math.sqrt(c)) * 0.5;
  } else {
    const c = Math.max(0, (viewZenithRad - zenithHorizon) / beta);
    v = Math.sqrt(c) * 0.5 + 0.5;
  }
  const u = Math.sqrt(Math.max(0, Math.min(1, deltaAzimuthRad / Math.PI)));
  return { u, v };
}

/**
 * Multi-scattering LUT, unit coordinates → sun cos-zenith and radius. Linear
 * in the sun's cosine; QUADRATIC in altitude (r = ground + v² · thickness),
 * so half the rows lie in the lowest 25 km. MEASURED (M3): with linear rows,
 * 3.2 km apart, the hazy preset's near-horizon sky came out 12 % dark on the
 * GPU (Ψ changes fastest in the lowest kilometres under haze); quadratic
 * rows at the same 32 cut that to 0.3 %, better than 64 linear rows (6 %).
 */
export function multiScatteringUvToParams(
  u: number,
  v: number
): { sunCosZenith: number; r: number } {
  return { sunCosZenith: 2 * u - 1, r: GROUND + v * v * (TOP - GROUND) };
}

/** Multi-scattering LUT, sun cos-zenith and radius → unit coordinates (inverse). */
export function multiScatteringParamsToUv(
  sunCosZenith: number,
  r: number
): { u: number; v: number } {
  const height = Math.max(0, Math.min(1, (r - GROUND) / (TOP - GROUND)));
  return { u: sunCosZenith * 0.5 + 0.5, v: Math.sqrt(height) };
}
