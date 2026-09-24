/**
 * Altitude-driven lighting model.
 *
 * Maps the sun's altitude angle (radians, as returned by SunCalc.getPosition)
 * to intensity, colour, and ambient level values suitable for a Three.js scene.
 *
 * @see sun-altitude-lighting.ts.md for the full specification.
 */

/** RGB colour of the direct sunlight as a hex integer (0xRRGGBB). */
export type LightColor = number;

/** Lighting outputs derived from a single sun altitude sample. */
export interface SunLightingResult {
  /**
   * Direct-light intensity in the range [0, 1].
   * 0 = no direct light (night / below horizon);
   * 1 = full midday intensity.
   */
  readonly intensity: number;

  /**
   * Colour of the direct light as a 24-bit hex integer (for Three.js Color /
   * MeshStandardMaterial emissive).
   * Warm orange near the horizon, white at zenith, deep blue-violet during
   * astronomical twilight.
   */
  readonly color: LightColor;

  /**
   * Ambient (sky) light level in the range [0, 1].
   * Always >= intensity (sky is never darker than direct sun).
   * Represents scattered/diffuse skylight and stays elevated during civil
   * twilight even when the sun is below the horizon.
   */
  readonly ambientLevel: number;
}

/**
 * Derive a lighting model from a sun altitude angle.
 *
 * @param altitudeRad - Sun altitude in radians [-π/2, π/2].
 *   Negative values indicate the sun is below the horizon.
 *   Obtained from SunCalc.getPosition(date, lat, lng).altitude.
 * @returns SunLightingResult with intensity, color, and ambientLevel.
 */
// ---------------------------------------------------------------------------
// Phase boundary constants (in radians)
// ---------------------------------------------------------------------------
const DEG_TO_RAD = Math.PI / 180;
const ALT_NIGHT_MAX = -18 * DEG_TO_RAD; // -0.314159...
const ALT_CIVIL_MIN = -6 * DEG_TO_RAD; // -0.104719...
const ALT_GOLDEN_MIN = 0; // 0
const ALT_GOLDEN_MAX = 6 * DEG_TO_RAD; // 0.104719...
const ALT_DAYTIME_MAX = 60 * DEG_TO_RAD; // 1.047197... (~60 deg)

// Default night floor values (also used for non-finite input defensiveness)
const NIGHT_RESULT: SunLightingResult = {
  intensity: 0,
  color: 0x0a0a1e,
  ambientLevel: 0.02,
};

/**
 * Standard cubic smoothstep function in [0, 1].
 * Returns 0 if x <= min, 1 if x >= max, and 3x^2 - 2x^3 in between.
 */
function smoothstep(min: number, max: number, value: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const x = (value - min) / (max - min);
  return x * x * (3 - 2 * x);
}

/** Linear interpolation between scalar values a and b. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linear interpolation between two RGB color tuples, returning a 24-bit integer (0xRRGGBB).
 */
function lerpColor(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  t: number
): LightColor {
  const r = Math.max(0, Math.min(255, Math.round(lerp(r1, r2, t))));
  const g = Math.max(0, Math.min(255, Math.round(lerp(g1, g2, t))));
  const b = Math.max(0, Math.min(255, Math.round(lerp(b1, b2, t))));
  return (r << 16) | (g << 8) | b;
}

/**
 * Derive a lighting model from a sun altitude angle.
 *
 * @param altitudeRad - Sun altitude in radians [-π/2, π/2].
 *   Negative values indicate the sun is below the horizon.
 *   Obtained from SunCalc.getPosition(date, lat, lng).altitude.
 * @returns SunLightingResult with intensity, color, and ambientLevel.
 */
export function sunAltitudeToLighting(altitudeRad: number): SunLightingResult {
  if (!Number.isFinite(altitudeRad)) {
    return NIGHT_RESULT;
  }

  if (altitudeRad < ALT_NIGHT_MAX) {
    // Night phase (< -18 deg)
    return NIGHT_RESULT;
  }

  if (altitudeRad < ALT_CIVIL_MIN) {
    // Astronomical twilight phase (-18 deg to -6 deg)
    const t = smoothstep(ALT_NIGHT_MAX, ALT_CIVIL_MIN, altitudeRad);
    return {
      intensity: 0,
      color: lerpColor(0x0a, 0x0a, 0x1e, 0x1a, 0x10, 0x40, t),
      ambientLevel: lerp(0.02, 0.15, t),
    };
  }

  if (altitudeRad < ALT_GOLDEN_MIN) {
    // Civil twilight / dawn phase (-6 deg to 0 deg)
    const t = smoothstep(ALT_CIVIL_MIN, ALT_GOLDEN_MIN, altitudeRad);
    return {
      intensity: lerp(0, 0.15, t),
      color: lerpColor(0x1a, 0x10, 0x40, 0xff, 0x60, 0x20, t),
      ambientLevel: lerp(0.15, 0.35, t),
    };
  }

  if (altitudeRad < ALT_GOLDEN_MAX) {
    // Golden hour phase (0 deg to 6 deg)
    const t = smoothstep(ALT_GOLDEN_MIN, ALT_GOLDEN_MAX, altitudeRad);
    return {
      intensity: lerp(0.15, 0.55, t),
      color: lerpColor(0xff, 0x60, 0x20, 0xff, 0xb0, 0x60, t),
      ambientLevel: lerp(0.35, 0.65, t),
    };
  }

  // Daytime phase (> 6 deg, ramping up to zenith at ~60 deg)
  const t = smoothstep(ALT_GOLDEN_MAX, ALT_DAYTIME_MAX, altitudeRad);
  return {
    intensity: lerp(0.55, 1.0, t),
    color: lerpColor(0xff, 0xb0, 0x60, 0xff, 0xff, 0xff, t),
    ambientLevel: lerp(0.65, 1.0, t),
  };
}
