/**
 * The CPU fallback sky (plan M3): the colours a device WITHOUT float render
 * targets gets instead of `SkyAtmosphere` — a zenith, a horizon, a lit-ground
 * colour, the sun light and the exposure, all from the same physical model
 * and on the same scale, so a caller can paint a background, a fog colour and
 * a `HemisphereLight` that agree with what the full sky would have shown.
 *
 * No render target and no shader: a few dozen CPU sky-radiance evaluations
 * with a coarse, memoised multi-scattering term. Run it when the sun moves,
 * not per frame.
 *
 * @see atmosphere-fallback.ts.md
 */
import { autoExposure } from './atmosphere-exposure.js';
import {
  EARTH_ATMOSPHERE,
  luminance,
  mieExtinctionForVisibility,
  sunLight,
  transmittanceToTop,
  type AtmosphereParams,
  type Rgb,
  type SunLight,
} from './atmosphere-model.js';
import {
  multiScattering,
  skyRadiance,
  type PsiLookup,
} from './atmosphere-scattering.js';
import type { DirectionLike } from './sky-atmosphere.js';

/** Scene-linear colours for a device that cannot run `SkyAtmosphere`. */
export interface FallbackSky {
  /** Straight up. */
  readonly zenith: Rgb;
  /** Just above the horizon, averaged over azimuth (for `scene.fog`). */
  readonly horizon: Rgb;
  /** Lit ground seen from above (for a `HemisphereLight`'s ground colour). */
  readonly ground: Rgb;
  /** The sun light, intensity already in scene units. */
  readonly sun: SunLight;
  /** Auto-exposure × 2^compensation, as `SkyAtmosphere.exposure`. */
  readonly exposure: number;
}

export interface FallbackSkyOptions extends AtmosphereParams {
  /** The sun light's intensity at the reference elevation. Default 1. */
  readonly sunIntensity?: number;
  /** EV on top of the auto-exposure. Default 0. */
  readonly exposureCompensationEv?: number;
}

/** Quadrature density for {@link skyIlluminanceCpu}. */
export interface IlluminanceQuadrature {
  /** Bands of equal cosine-weighted solid angle between zenith and horizon. */
  readonly elevations: number;
  /** Azimuth samples over [0, π] (the sky is symmetric about the sun's plane). */
  readonly azimuths: number;
}

/**
 * The cheap default. 6 × 8 = 48 directions; within 10 % of a 24 × 24
 * quadrature from noon to blue hour (test sweep).
 */
const DEFAULT_QUADRATURE: IlluminanceQuadrature = {
  elevations: 6,
  azimuths: 8,
};

/** Steps per sky ray: half the LUT's, the fallback is a few flat colours. */
const SKY_STEPS = 16;

/** Coarse multi-scattering: 4 × 4 directions, 10 steps, memoised on a grid. */
const PSI_DIRECTIONS = 4;
const PSI_STEPS = 10;
const PSI_ALTITUDE_BINS = 8;
const PSI_MU_BINS = 128;

function observerRadius(params: AtmosphereParams): number {
  return (
    EARTH_ATMOSPHERE.groundRadiusKm +
    (params.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm)
  );
}

/**
 * Ψ on a coarse (altitude, sun cosine) grid, nearest neighbour, computed on
 * first use. Altitude bins are quadratic: most of the air is low.
 */
function coarsePsi(params: AtmosphereParams): PsiLookup {
  const top = EARTH_ATMOSPHERE.topRadiusKm - EARTH_ATMOSPHERE.groundRadiusKm;
  const cache = new Map<number, Rgb>();
  return (radius, sunCosZenith) => {
    const altitude = Math.max(0, radius - EARTH_ATMOSPHERE.groundRadiusKm);
    const a = Math.round(
      Math.sqrt(Math.min(1, altitude / top)) * (PSI_ALTITUDE_BINS - 1)
    );
    const m = Math.round(
      ((Math.max(-1, Math.min(1, sunCosZenith)) + 1) / 2) * (PSI_MU_BINS - 1)
    );
    const key = a * PSI_MU_BINS + m;
    let psi = cache.get(key);
    if (psi === undefined) {
      const binAltitude = top * (a / (PSI_ALTITUDE_BINS - 1)) ** 2;
      const binMu = (m / (PSI_MU_BINS - 1)) * 2 - 1;
      psi = multiScattering(
        EARTH_ATMOSPHERE.groundRadiusKm + binAltitude,
        binMu,
        params,
        PSI_DIRECTIONS,
        PSI_STEPS
      ).psi;
      cache.set(key, psi);
    }
    return psi;
  };
}

/** How many airs keep a Ψ lookup at once (a page uses one or two). */
const PSI_CACHE_LIMIT = 8;
const psiCache = new Map<string, PsiLookup>();

/**
 * The coarse Ψ lookup for an air, built once and reused: building it is
 * most of a `skyIlluminanceCpu` call (~19 of ~23 ms measured), and
 * `SkyAtmosphere` calls the estimate on every sun change while a driver
 * refuses the sky readback (M3 review finding 6). Keyed on the only two
 * inputs Ψ depends on; the oldest entry is dropped past eight airs.
 */
export function psiLookupFor(params: AtmosphereParams): PsiLookup {
  const key = `${params.visibilityKm}|${params.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm}`;
  let psi = psiCache.get(key);
  if (psi === undefined) {
    if (psiCache.size >= PSI_CACHE_LIMIT) {
      const oldest = psiCache.keys().next().value;
      if (oldest !== undefined) psiCache.delete(oldest);
    }
    psi = coarsePsi(params);
    psiCache.set(key, psi);
  }
  return psi;
}

/** Radiance → sun-relative units (the scale `SkyAtmosphere` uses). */
function toRelative(params: AtmosphereParams): number {
  const reference = transmittanceToTop(
    observerRadius(params),
    Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
    params
  );
  return 1 / luminance(reference);
}

/**
 * Horizontal sky illuminance (luminance, sun-relative units: the same input
 * `SkyAtmosphere` feeds its auto-exposure), by quadrature over the upper
 * hemisphere. Bands have equal cosine-weighted solid angle, which puts more
 * samples near the bright horizon.
 */
export function skyIlluminanceCpu(
  sunCosZenith: number,
  params: AtmosphereParams,
  quadrature: IlluminanceQuadrature = DEFAULT_QUADRATURE,
  psi: PsiLookup = psiLookupFor(params)
): number {
  if (!Number.isFinite(sunCosZenith)) {
    throw new RangeError(`sunCosZenith must be finite, got ${sunCosZenith}`);
  }
  const { elevations, azimuths } = quadrature;
  if (
    !(Number.isInteger(elevations) && elevations > 0) ||
    !(Number.isInteger(azimuths) && azimuths > 0)
  ) {
    throw new RangeError('quadrature counts must be positive integers');
  }
  const r = observerRadius(params);
  // Each band holds 1 / elevations of ∫ cos z dω over the hemisphere (= π).
  const weight = Math.PI / (elevations * azimuths);
  let sum = 0;
  for (let i = 0; i < elevations; i++) {
    const zenith = Math.asin(Math.sqrt((i + 0.5) / elevations));
    for (let j = 0; j < azimuths; j++) {
      const azimuth = (Math.PI * (j + 0.5)) / azimuths;
      sum += luminance(
        skyRadiance(r, zenith, azimuth, sunCosZenith, params, psi, SKY_STEPS)
      );
    }
  }
  return sum * weight * toRelative(params);
}

function requireDirection(direction: DirectionLike): number {
  const { x, y, z } = direction;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError('sun direction must be a non-zero finite vector');
  }
  return y / length;
}

function requireOptions(options: FallbackSkyOptions): void {
  mieExtinctionForVisibility(options.visibilityKm);
  const intensity = options.sunIntensity ?? 1;
  if (!(Number.isFinite(intensity) && intensity > 0)) {
    throw new RangeError(
      `sunIntensity must be a positive finite number, got ${intensity}`
    );
  }
  if (!Number.isFinite(options.exposureCompensationEv ?? 0)) {
    throw new RangeError('exposureCompensationEv must be finite');
  }
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/**
 * The fallback sky for a sun direction (+y up, any length). Throws
 * `RangeError` for a zero or non-finite direction and for invalid options.
 */
export function fallbackSky(
  sunDirection: DirectionLike,
  options: FallbackSkyOptions
): FallbackSky {
  const sunCos = requireDirection(sunDirection);
  requireOptions(options);
  const r = observerRadius(options);
  const psi = psiLookupFor(options);
  const relative = toRelative(options);

  const zenith = skyRadiance(r, 0, 0, sunCos, options, psi, SKY_STEPS);
  // The same height the visible sky and the haze clamp to.
  const horizonZenith = Math.acos(EARTH_ATMOSPHERE.horizonClampDirY);
  const horizon = [0, 0, 0];
  const ring = DEFAULT_QUADRATURE.azimuths;
  for (let j = 0; j < ring; j++) {
    const c = skyRadiance(
      r,
      horizonZenith,
      (Math.PI * (j + 0.5)) / ring,
      sunCos,
      options,
      psi,
      SKY_STEPS
    );
    for (let k = 0; k < 3; k++) horizon[k]! += c[k]! / ring;
  }

  const light = sunLight(sunCos, options);
  const direct =
    luminance(light.colour) * light.intensity * Math.max(0, sunCos);
  const skyE = skyIlluminanceCpu(sunCos, options, DEFAULT_QUADRATURE, psi);
  const exposure =
    autoExposure(skyE + direct) * 2 ** (options.exposureCompensationEv ?? 0);
  const toScene = (options.sunIntensity ?? 1) * exposure;
  // Lambertian ground: albedo / π × horizontal illuminance (grey, relative).
  const groundLevel =
    (EARTH_ATMOSPHERE.groundAlbedo / Math.PI) * (skyE + direct) * toScene;

  return {
    zenith: scale(zenith, relative * toScene),
    horizon: scale(horizon as unknown as Rgb, relative * toScene),
    ground: [groundLevel, groundLevel, groundLevel],
    sun: { colour: light.colour, intensity: light.intensity * toScene },
    exposure,
  };
}
