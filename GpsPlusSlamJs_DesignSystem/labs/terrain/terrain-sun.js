/**
 * The terrain lab's sun term (globe round-5 plan 2026-10-01-0945 §3.3 "One
 * light first"): the relief lit by the globe's own sun, so the continuity
 * metric, the colour approaches and the later cloud-shadow port all share
 * one light.
 *
 * - WHICH SUN: the globe lab's, exactly. The globe lights the Earth with the
 *   framework's `solarPosition(ms, 0, 0)` turned from 0°N 0°E's east-north-
 *   up frame into ECEF (`globe-sun.ts`); `sunEnuFromGlobe` takes that same
 *   input and turns it into the place's frame, so the page makes the
 *   globe's call and the relief cannot drift from the globe's sun.
 * - WHAT IS LIT HOW: the globe draws ground as three's Lambert under one
 *   directional light of intensity `GLOBE_SUN.intensity` with no sky light,
 *   tone mapped (Neutral). `sunLight` keeps that for open flat ground
 *   (exactly dot(N, L)) and adds a sky fill only where the relief differs
 *   from flat: `shadow` is the direct light's share, the rest is the flat
 *   ground's light spread by the sky view. `sunLitColour` is then the
 *   globe's own pipeline for an albedo.
 * - THE CLOUD-SHADOW HOOK: every direct term goes through `sunDirect`, and
 *   `visibility` (1 = clear) enters there and nowhere else, so the
 *   framework's `CloudShadow` column (`cloud-shadow.ts`: the light's colour
 *   times exp(-optical depth)) ports onto exactly this term. In the shader
 *   it is `terrainSunVisibility`, which returns 1 until that port.
 * - THE MAP STYLES under the sun read `sunRelativeShade`, the direct term
 *   normalised by the sun's height, which is their `singleLightShade` for
 *   that light: switching to the sun changes the light's direction only.
 *
 * `SUN_GLSL` is the shader's copy of these functions, line for line; this
 * file is the reference CI runs. Dependency-free except the far field's
 * colour curves (DEC-H3), so it runs under `node --test`.
 *
 * @see terrain-sun.js.md
 */
import {
  linearToSrgb,
  neutralToneMap,
  srgbToLinear,
} from "./terrain-far-field.js";

const DEG = Math.PI / 180;

/** The globe's sun light (GpsPlusSlamJs_Globe `GLOBE_SURFACE.sunIntensity`). */
export const GLOBE_SUN = Object.freeze({
  /** Held to the globe's source by a test (DEC-GL4-1: the owner's 5). */
  intensity: 5,
});

/**
 * The least sun height a relative shade divides by (sin 2°): below it a map
 * style's shade would explode, and the sun is then a sliver anyway.
 */
export const MIN_SUN_Z = Math.sin(2 * DEG);

/**
 * A unit vector (east, north, up) toward a sun at an elevation and an
 * azimuth (clockwise from north), both radians, in the frame they were
 * observed in.
 */
export function sunEnu({ elevationRad, azimuthRad }) {
  const horizontal = Math.cos(elevationRad);
  return [
    horizontal * Math.sin(azimuthRad),
    horizontal * Math.cos(azimuthRad),
    Math.sin(elevationRad),
  ];
}

/** The classic map light (north-west, 45° up): styles B and D's own. */
export const MAP_KEY_LIGHT = Object.freeze(
  sunEnu({ elevationRad: 45 * DEG, azimuthRad: 315 * DEG }),
);

/**
 * The globe's sun (its elevation and azimuth as seen at 0°N 0°E, the
 * framework's `solarPosition(ms, 0, 0)`) as a unit vector in the east-
 * north-up frame of a place. Exact for a direction: geodetic ENU axes are
 * the ellipsoid normal's, and the sun's distance makes the observing place
 * irrelevant (under 0.01°, `globe-sun.ts`). RangeError for a non-finite
 * angle or place.
 */
export function sunEnuFromGlobe(sun, latDeg, lngDeg) {
  for (const [name, v] of [
    ["elevation", sun?.elevationRad],
    ["azimuth", sun?.azimuthRad],
    ["latitude", latDeg],
    ["longitude", lngDeg],
  ]) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`${name} must be finite, got ${v}`);
    }
  }
  // At 0°N 0°E the ECEF axes are: east +y, north +z, up +x.
  const [e0, n0, u0] = sunEnu(sun);
  const x = u0;
  const y = e0;
  const z = n0;
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLng = Math.sin(lng);
  const cosLng = Math.cos(lng);
  return [
    -sinLng * x + cosLng * y,
    -sinLat * cosLng * x - sinLat * sinLng * y + cosLat * z,
    cosLat * cosLng * x + cosLat * sinLng * y + sinLat * z,
  ];
}

/**
 * The relief's shading normal (east, north, up) for a slope (m/m east and
 * north) and a gain that steepens it for the shading only (the slope gain
 * times the view's boost; E never enters it).
 */
export function reliefNormal(gx, gy, gain) {
  const nx = -gx * gain;
  const ny = -gy * gain;
  const len = Math.hypot(nx, ny, 1);
  return [nx / len, ny / len, 1 / len];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The sun's direct light on a normal, relative to a surface facing it:
 * max(0, N·L) times the visibility (1 = clear sky). THE one term the cloud
 * shadow dims.
 */
export function sunDirect(n, sun, visibility = 1) {
  return Math.max(0, dot(n, sun)) * visibility;
}

/**
 * A map style's shade under the sun: the direct term over the sun's height
 * (floored at `MIN_SUN_Z`), so open flat ground in a clear sky is 1, as the
 * styles' own shades are. 0 on flat ground with the sun down.
 */
export function sunRelativeShade(n, sun, visibility = 1) {
  return sunDirect(n, sun, visibility) / Math.max(sun[2], MIN_SUN_Z);
}

/**
 * The sun-lit light at a point, in the globe's units: `shadow` x the direct
 * term + (1 - `shadow`) x the flat ground's light x the sky view. Open flat
 * ground in a clear sky gets exactly max(0, L.z), the globe's dot(N, L),
 * whatever the shadow share. RangeError for a shadow share outside 0-1.
 *
 * @param {number[]} n  the shading normal
 * @param {number[]} sun  unit ENU toward the sun
 * @param {{ shadow: number, svf?: number, visibility?: number }} o
 */
export function sunLight(n, sun, { shadow, svf = 1, visibility = 1 }) {
  if (!(shadow >= 0 && shadow <= 1)) {
    throw new RangeError(`shadow must be in 0-1, got ${shadow}`);
  }
  return (
    shadow * sunDirect(n, sun, visibility) +
    (1 - shadow) * Math.max(0, sun[2]) * svf
  );
}

/**
 * What the globe draws for an albedo (sRGB 0-1) under a light (`sunLight`'s
 * units): three's Lambert, albedo / π x intensity x light, through the
 * Neutral tone mapping, back to sRGB.
 */
export function sunLitColour(
  albedoSrgb,
  light,
  intensity = GLOBE_SUN.intensity,
) {
  const k = (intensity * Math.max(0, light)) / Math.PI;
  return neutralToneMap(albedoSrgb.map((v) => srgbToLinear(v) * k)).map((v) =>
    Math.min(1, Math.max(0, linearToSrgb(Math.max(0, v)))),
  );
}

/**
 * The shader's copy of this file (needs three's tone-mapping chunk and the
 * uniforms `uSun` (unit ENU toward the key light) and `uSunIntensity`).
 * `terrainSunVisibility` is the cloud-shadow port's seat: it receives the
 * fragment's ENU position (m, x east, y north), its height above the datum
 * (m) and the direction to the sun, and returns 1 until then.
 */
export const SUN_GLSL = /* glsl */ `
const float MIN_SUN_Z = ${MIN_SUN_Z.toFixed(8)};

// The cloud-shadow port's seat: the share of the sun's direct light that
// reaches this point (1 = clear). Every direct term goes through it.
float terrainSunVisibility(vec2 enu, float heightM, vec3 toSun) {
  return 1.0;
}

// terrain-sun.js reliefNormal.
vec3 reliefNormal(vec2 grad, float gain) {
  return normalize(vec3(-grad * gain, 1.0));
}

// terrain-sun.js sunDirect.
float sunDirect(vec3 n, float visibility) {
  return max(0.0, dot(n, uSun)) * visibility;
}

// terrain-sun.js sunRelativeShade.
float sunRelativeShade(vec3 n, float visibility) {
  return sunDirect(n, visibility) / max(uSun.z, MIN_SUN_Z);
}

// terrain-sun.js sunLight.
float sunLight(vec3 n, float shadow, float svf, float visibility) {
  return shadow * sunDirect(n, visibility)
    + (1.0 - shadow) * max(0.0, uSun.z) * svf;
}

// terrain-sun.js sunLitColour: three's Lambert at the globe's intensity,
// Neutral tone mapped, as the globe draws its ground.
vec3 sunLitColour(vec3 albedoSrgb, float light) {
  vec3 lin = sRGBTransferEOTF(vec4(albedoSrgb, 1.0)).rgb
    * uSunIntensity * max(0.0, light) / 3.141592653589793;
  return sRGBTransferOETF(vec4(clamp(NeutralToneMapping(lin), 0.0, 1.0), 1.0)).rgb;
}
`;
