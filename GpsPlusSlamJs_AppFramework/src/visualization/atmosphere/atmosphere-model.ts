/**
 * The physical atmosphere's numbers and the CPU half of its maths.
 *
 * WHY A CPU MODEL EXISTS AT ALL when the sky is drawn by shaders. Three reasons,
 * each load-bearing:
 *
 * - **One source for the constants.** `atmosphere-glsl.ts` interpolates every
 *   coefficient below into its shader strings, so the GPU cannot drift from
 *   the numbers tested here.
 * - **The sun's colour is needed on the CPU**, for a `DirectionalLight`. It
 *   must be the same transmittance the sky shows, or the highlights would
 *   disagree with the sunset behind them.
 * - **Shaders fail silently** (lessons-learned: a compile error only logs).
 *   These functions are the oracle the look-dev page's parity readback
 *   compares the GPU against.
 *
 * THE MODEL is Hillaire 2020 ("A Scalable and Production Ready Sky and
 * Atmosphere Rendering Technique", Table 1) over Bruneton & Neyret 2008's
 * planet geometry: Rayleigh and Mie layers with exponential density, an ozone
 * layer with a tent profile. Implemented from the papers; no third-party code
 * (plan DEC-SKY-1).
 *
 * UNITS: kilometres for every length, per-kilometre for every coefficient.
 * Positions are radii from the planet's centre, directions are the cosine of
 * the zenith angle (`mu`), which is all a spherically symmetric atmosphere
 * needs.
 *
 * @see atmosphere-model.ts.md
 */

import { clamp01 } from '../../utils/clamp01.js';

/** Linear RGB triple. */
export type Rgb = readonly [number, number, number];

/** The per-scene knobs. Everything else is a physical constant. */
export interface AtmosphereParams {
  /**
   * Meteorological visibility, km — how far a black object stays
   * distinguishable. Drives the Mie (aerosol) density: 20 is hazy, 80 is
   * clear, above ~290 the air is Rayleigh-only.
   */
  readonly visibilityKm: number;
  /** The observer's height above sea level, km. Defaults to 0.2. */
  readonly observerAltitudeKm?: number;
}

/**
 * Earth's atmosphere, Hillaire 2020 Table 1 (converted from per-metre ×1e-6 to
 * per-kilometre ×1e-3), plus the constants the renderer needs to agree on.
 */
export const EARTH_ATMOSPHERE = {
  groundRadiusKm: 6360,
  topRadiusKm: 6460,
  /** Rayleigh scattering at sea level for R, G, B (680, 550, 440 nm), /km. */
  rayleighScatteringPerKm: [5.802e-3, 13.558e-3, 33.1e-3] as Rgb,
  rayleighScaleHeightKm: 8,
  /**
   * Mie single-scattering albedo, scattering / extinction: 3.996 / 4.44 = 0.9.
   * Kept as a ratio so visibility can scale the density without changing the
   * kind of aerosol.
   *
   * VERIFIED against the paper author's reference code (sebh/
   * UnrealEngineSkyAtmosphere, `SkyAtmosphereCommon.cpp`: mie_scattering
   * 0.003996/km, mie_EXTINCTION 0.004440/km) and Bruneton 2017's albedo 0.9.
   * The first version read the 4.4 as ABSORPTION, giving 0.476 (a sooty
   * aerosol, every Mie glow ~47 % too weak); a Shadertoy-derived port in the
   * workspace carries the same misreading (M1 milestone review, finding 2).
   */
  mieAlbedo: 3.996 / 4.44,
  mieScaleHeightKm: 1.2,
  /** Cornette-Shanks asymmetry: how strongly aerosols scatter forward. */
  miePhaseG: 0.8,
  /** Ozone absorption at the layer's peak, /km. Ozone scatters nothing. */
  ozoneAbsorptionPerKm: [0.65e-3, 1.881e-3, 0.085e-3] as Rgb,
  ozoneCentreKm: 25,
  ozoneHalfWidthKm: 15,
  /**
   * Average ground reflectance for the light bounced back into the
   * atmosphere (multi-scattering) and seen below the horizon. 0.3 is
   * Hillaire's value; the scene's own ground is drawn by the scene.
   */
  groundAlbedo: 0.3,
  /** Angular radius of the sun's disc, rad (0.2666°). */
  sunAngularRadiusRad: 0.004654,
  /**
   * Linear limb-darkening coefficient u of the solar disc, I(μ) ∝ 1 − u(1 − μ).
   * 0.6 is the textbook visible-band value.
   */
  sunLimbDarkening: 0.6,
  /**
   * The elevation at which {@link sunLight} delivers luminance 1. 45° is a
   * mid-morning sun: a caller that used a fixed white light of intensity k
   * keeps k's luminance there and gains only what the atmosphere changes.
   */
  referenceSunElevationRad: Math.PI / 4,
  /** Default observer height, km: a rooftop / low drone view of a city. */
  defaultObserverAltitudeKm: 0.2,
  /**
   * Quadrature steps for optical depth. Chosen by the sweep in
   * `atmosphere-model.test.ts` (< 0.5 % against 20 000 steps from the zenith
   * to the horizon); the transmittance LUT uses the same count and the same
   * quadratic step placement, so the GPU/CPU parity check compares like with
   * like.
   */
  opticalDepthSteps: 40,
  /**
   * Lowest view elevation (as dir.y) at which the sky's in-scatter colour is
   * read. Below the horizon the sky-view LUT holds the lit GROUND seen from
   * the observer; the haze fades geometry toward the sky just above the
   * horizon instead, and the visible sky below the horizon is clamped the
   * same way, so geometry at the far plane fades to exactly the colour drawn
   * behind the clip (M2 review, finding 3). The environment bake is NOT
   * clamped: undersides keep the ground's bounce light.
   */
  horizonClampDirY: 0.02,
  /**
   * Sky-view march steps and multi-scattering sampling. Shared by the CPU
   * twin (`atmosphere-scattering.ts` defaults) and the GLSL, for the same
   * reason as `opticalDepthSteps`.
   */
  skyViewSteps: 32,
  multiScatteringSqrtDirections: 16,
  multiScatteringSteps: 20,
} as const;

/** Koschmieder's constant: contrast threshold 2 % → ln(1/0.02). */
const KOSCHMIEDER = 3.912;

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`);
  }
}

/**
 * Sea-level Mie EXTINCTION for a meteorological visibility, /km.
 *
 * Koschmieder's 3.912 / V is the TOTAL extinction at 550 nm, of which Rayleigh
 * is a fixed part; the aerosol share is the remainder. Clamped at zero: above
 * ~290 km visibility the Rayleigh share alone exceeds the total, and a negative
 * coefficient would add light along a ray.
 *
 * @throws RangeError for a non-positive or non-finite visibility.
 */
export function mieExtinctionForVisibility(visibilityKm: number): number {
  if (!Number.isFinite(visibilityKm) || visibilityKm <= 0) {
    throw new RangeError(
      `visibilityKm must be a positive finite number, got ${visibilityKm}`
    );
  }
  const total = KOSCHMIEDER / visibilityKm;
  return Math.max(0, total - EARTH_ATMOSPHERE.rayleighScatteringPerKm[1]);
}

/** Scattering and extinction coefficients at an altitude, /km. */
export interface Medium {
  readonly rayleighScattering: Rgb;
  readonly mieScattering: number;
  readonly extinction: Rgb;
}

/**
 * The medium at an altitude above sea level, for a given sea-level Mie
 * extinction: Rayleigh and Mie with exponential density, ozone with a tent
 * profile. The GLSL twin is `atmMedium`.
 */
export function mediumAt(altitudeKm: number, mieExtinction: number): Medium {
  const a = EARTH_ATMOSPHERE;
  const rayleighDensity = Math.exp(-altitudeKm / a.rayleighScaleHeightKm);
  const mieExt = mieExtinction * Math.exp(-altitudeKm / a.mieScaleHeightKm);
  const ozone = Math.max(
    0,
    1 - Math.abs(altitudeKm - a.ozoneCentreKm) / a.ozoneHalfWidthKm
  );
  const rs: Rgb = [
    a.rayleighScatteringPerKm[0] * rayleighDensity,
    a.rayleighScatteringPerKm[1] * rayleighDensity,
    a.rayleighScatteringPerKm[2] * rayleighDensity,
  ];
  return {
    rayleighScattering: rs,
    mieScattering: mieExt * a.mieAlbedo,
    extinction: [
      rs[0] + mieExt + a.ozoneAbsorptionPerKm[0] * ozone,
      rs[1] + mieExt + a.ozoneAbsorptionPerKm[1] * ozone,
      rs[2] + mieExt + a.ozoneAbsorptionPerKm[2] * ozone,
    ],
  };
}

/**
 * Distance from radius `r` along direction `mu` to the top of the atmosphere,
 * km. Valid for any `r` inside the atmosphere (the far root of the quadratic).
 */
export function distanceToAtmosphereTop(r: number, mu: number): number {
  const top = EARTH_ATMOSPHERE.topRadiusKm;
  const discriminant = r * r * (mu * mu - 1) + top * top;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, discriminant)));
}

/**
 * The cosine of the zenith angle of the geometric horizon seen from radius
 * `r`. Negative for any observer above the ground: the horizon dips.
 */
export function horizonCosZenith(r: number): number {
  const ratio = EARTH_ATMOSPHERE.groundRadiusKm / r;
  return -Math.sqrt(Math.max(0, 1 - ratio * ratio));
}

/** Whether a ray from radius `r` in direction `mu` hits the planet. */
export function rayHitsGround(r: number, mu: number): boolean {
  return mu < horizonCosZenith(r);
}

/**
 * Optical depth (∫ extinction ds) from radius `r` along `mu` to the top of the
 * atmosphere, per channel.
 *
 * QUADRATIC STEP PLACEMENT: sample `i` of `n` covers `[t_i², t_(i+1)²] · d`
 * with `t = i / n`, so the steps are short where the ray starts, which is
 * where the air is densest. With uniform steps the 1.2 km Mie layer is
 * under-sampled on a 100 km zenith path and the error is ~10 %; with this
 * placement 40 steps are within 0.5 % of 20 000 (see the sweep test).
 *
 * Does NOT check for ground intersection; {@link transmittanceToTop} does.
 */
export function opticalDepthToTop(
  r: number,
  mu: number,
  params: AtmosphereParams,
  steps: number = EARTH_ATMOSPHERE.opticalDepthSteps
): Rgb {
  requireFinite('r', r);
  requireFinite('mu', mu);
  const mieExtinction = mieExtinctionForVisibility(params.visibilityKm);
  const length = distanceToAtmosphereTop(r, mu);
  const depth = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const tm = (i + 0.5) / steps;
    const s = tm * tm * length;
    const ds = (t1 * t1 - t0 * t0) * length;
    // Altitude of the sample from the law of cosines, not r + s·mu: the planet
    // is curved, which is the whole reason a horizontal ray escapes at all.
    const radius = Math.sqrt(r * r + s * s + 2 * r * s * mu);
    const e = mediumAt(
      radius - EARTH_ATMOSPHERE.groundRadiusKm,
      mieExtinction
    ).extinction;
    depth[0]! += e[0] * ds;
    depth[1]! += e[1] * ds;
    depth[2]! += e[2] * ds;
  }
  return [depth[0]!, depth[1]!, depth[2]!];
}

/**
 * Fraction of light surviving from radius `r` along `mu` to space, per channel.
 * Zero for a ray that hits the planet.
 *
 * @throws RangeError for a non-finite radius or direction, or bad params.
 */
export function transmittanceToTop(
  r: number,
  mu: number,
  params: AtmosphereParams
): Rgb {
  requireFinite('r', r);
  requireFinite('mu', mu);
  if (rayHitsGround(r, mu)) return [0, 0, 0];
  const depth = opticalDepthToTop(r, mu, params);
  return [Math.exp(-depth[0]), Math.exp(-depth[1]), Math.exp(-depth[2])];
}

/**
 * The sun disc's brightness profile at normalised radius `rho` (0 centre, 1
 * limb), NORMALISED so its average over the disc is 1: the disc then emits
 * exactly the sun's illuminance. Linear limb darkening, I(μ) = 1 − u(1 − μ)
 * with μ = √(1 − ρ²), averages 1 − u/3 over the disc, hence the division.
 * The GLSL sun disc mirrors this.
 */
export function sunDiscLimbDarkening(rho: number): number {
  const u = EARTH_ATMOSPHERE.sunLimbDarkening;
  const mu = Math.sqrt(Math.max(0, 1 - rho * rho));
  return (1 - u * (1 - mu)) / (1 - u / 3);
}

/** Rec. 709 luminance of a linear RGB triple. The package's one copy. */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** A light's colour (chroma, brightest channel = 1) and relative intensity. */
export interface SunLight {
  readonly colour: Rgb;
  readonly intensity: number;
}

/**
 * The sunlight reaching the observer, for a `DirectionalLight`.
 *
 * `colour` is the transmittance normalised so its brightest channel is 1, and
 * `intensity` is chosen so that COLOUR × INTENSITY (what three.js multiplies)
 * is the transmittance divided by the luminance of the reference-elevation
 * transmittance: the scale the sky, the environment and the sun disc use. At
 * the reference elevation the light's luminance is therefore exactly 1, so a
 * caller keeps its existing white-light intensity as a scale factor and the
 * grading of every lit material only changes by what the atmosphere changes.
 *
 * THE SUN SETS OVER ITS DISC, not at a point. The visible fraction of the disc
 * above the (dipped) horizon scales the intensity, and the transmittance is
 * taken just above the horizon while any of the disc shows, so the light fades
 * over ~0.5° instead of snapping off.
 *
 * @param sunCosZenith sine of the sun's elevation (= cosine of its zenith).
 */
export function sunLight(
  sunCosZenith: number,
  params: AtmosphereParams
): SunLight {
  requireFinite('sunCosZenith', sunCosZenith);
  const altitude =
    params.observerAltitudeKm ?? EARTH_ATMOSPHERE.defaultObserverAltitudeKm;
  const r = EARTH_ATMOSPHERE.groundRadiusKm + altitude;
  const radius = EARTH_ATMOSPHERE.sunAngularRadiusRad;
  const horizonMu = horizonCosZenith(r);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sunCosZenith)));
  const horizonElevation = Math.asin(horizonMu);
  const visibleFraction = clamp01(
    (elevation - horizonElevation + radius) / (2 * radius)
  );
  if (visibleFraction === 0) return { colour: [0, 0, 0], intensity: 0 };

  // Just above the horizon while part of the disc shows; the tiny margin keeps
  // the grazing ray out of the planet in floating point.
  const mu = Math.max(sunCosZenith, horizonMu + 1e-6);
  const t = transmittanceToTop(r, mu, params);
  const reference = transmittanceToTop(
    r,
    Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
    params
  );
  const peak = Math.max(t[0], t[1], t[2]);
  if (peak <= 0) return { colour: [0, 0, 0], intensity: 0 };
  return {
    colour: [t[0] / peak, t[1] / peak, t[2] / peak],
    // colour × intensity = T · fraction / lum(T_ref): the sky's scale.
    intensity: (visibleFraction * peak) / luminance(reference),
  };
}
