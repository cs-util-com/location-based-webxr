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
 * - WHAT IS LIT HOW: the globe draws ground with three's
 *   MeshStandardMaterial (roughness 0.9) under one directional light of
 *   intensity `GLOBE_SUN.intensity` with no sky light, tone mapped
 *   (Neutral). Its diffuse term is Lambert's, albedo / π x intensity x
 *   dot(N, L), and that is what is modelled here; its GGX specular (a
 *   small share on dark ground) and the atmosphere's veil are not. `sunLight` keeps that for open flat ground
 *   (exactly dot(N, L)) while the sun stands above the sky floor, and adds
 *   a sky fill only where the relief differs from flat: `shadow` is the
 *   direct light's share, the rest is the sky level spread by the sky
 *   view. Below the floor the sky holds it (`SKY_FILL`, DEC-GL5-11), so a
 *   low sun's shadows keep their colour. `sunLitColour` is then the
 *   globe's own pipeline for an albedo.
 * - THE CLOUD-SHADOW HOOK: every direct term goes through `sunDirect`, and
 *   `visibility` (1 = clear) enters there and nowhere else (never the sky
 *   fill: a cloud's shadow takes the direct light only), so the
 *   framework's `CloudShadow` column (`cloud-shadow.ts`: the light's colour
 *   times exp(-optical depth)) ports onto exactly this term. In the shader
 *   it is `terrainSunVisibility`, which returns 1 until that port.
 * - THE MAP STYLES under the sun read `sunRelativeShade`, the direct term
 *   normalised by the sun's height, which is their `singleLightShade` for
 *   that light: switching to the sun changes the light's direction only.
 *
 * `SUN_GLSL` is the shader's copy of these functions, line for line; this
 * file is the reference CI runs. Dependency-free except the far field's
 * colour curves, style B's light and the package's one `smoothstep`
 * (DEC-H3), so it runs under `node --test`.
 *
 * @see terrain-sun.js.md
 */
import { GLOBE_SUN, farColour } from "./terrain-far-field.js";
import { smoothstep } from "./terrain-style.js";
import { NATURAL } from "./terrain-styles.js";

export { GLOBE_SUN };

const DEG = Math.PI / 180;

/**
 * The least sun height a relative shade divides by (sin 2°): below it a map
 * style's shade would explode, and the sun is then a sliver anyway.
 */
export const MIN_SUN_Z = Math.sin(2 * DEG);

/**
 * The sky fill's parameters (DEC-GL5-11). The fill is the light the sky
 * gives a face the sun does not reach; it used to follow the sun's height,
 * `sin h`, so at a low sun it vanished with the direct light (0.2 x sin 11°
 * on the Alps, under one 8-bit level) and the shadowed faces went black.
 * The sky level is now `max(sin h, floor)` while the sun is up, faded to 0
 * through the twilight below the horizon:
 *
 * - `floor` (0-1, in the units of open flat ground under a zenith sun): the
 *   least sky level while the sun is up. Wherever sin h >= floor nothing
 *   changes (the globe's flat ground is matched as before); below it the
 *   light rises by (1 - shadow) x svf x (floor - sin h), so the change is
 *   bounded and falls to 0 at a sun of asin(floor). The clear sky's light,
 *   relative to the sun's beam, does not fall with the sun's height as the
 *   beam's projection does (it holds or rises toward the horizon, where the
 *   beam weakens in the air), so a floor is the plausible shape; the lab's
 *   beam stays at full strength.
 * - `twilightDeg`: the depth below the horizon over which the floor fades
 *   (smoothly) to 0: civil twilight.
 *
 * The default floor is the measured choice: at an 11° sun on the Alps it
 * lifts `globe-albedo`'s darkest tenth above 10 of 255 at 30 and 10 km and
 * keeps the relief at least as contrasty as at noon (terrain-sun.js.md).
 */
export const SKY_FILL = Object.freeze({ floor: 0.5, twilightDeg: 6 });

/**
 * The sky's level for the fill at a sun height (`sunZ`, the sine of its
 * elevation): max(sin h, floor) while the sun is up, the floor faded to 0
 * over `twilightDeg` below the horizon. Never falls as the sun rises.
 * RangeError for a non-finite height, a floor outside 0-1 or a twilight
 * outside 0-90°.
 */
export function skyLevel(
  sunZ,
  floor = SKY_FILL.floor,
  twilightDeg = SKY_FILL.twilightDeg,
) {
  if (!Number.isFinite(sunZ)) {
    throw new RangeError(`sun height must be finite, got ${sunZ}`);
  }
  if (!(floor >= 0 && floor <= 1)) {
    throw new RangeError(`sky floor must be in 0-1, got ${floor}`);
  }
  if (!(twilightDeg > 0 && twilightDeg < 90)) {
    throw new RangeError(`twilight must be in 0-90°, got ${twilightDeg}`);
  }
  const fade = smoothstep(-Math.sin(twilightDeg * DEG), 0, sunZ);
  return Math.max(Math.max(0, sunZ), floor * fade);
}

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

/**
 * The classic map light, styles B and D's own (north-west, 45° up): derived
 * from style B's light, so the map lights have one source (review
 * 2026-10-01-1650 m7; a test holds style D's to the same).
 */
export const MAP_KEY_LIGHT = Object.freeze(
  sunEnu({
    elevationRad: NATURAL.lightAltitudeDeg * DEG,
    azimuthRad: NATURAL.lightAzimuthDeg * DEG,
  }),
);

/**
 * The line the page shows while the relief is lit by the globe's sun and
 * that sun is on or below the horizon (review 2026-10-01-1650 m3): the
 * imagery styles open on the clock's present, so at night they open dark,
 * and without a word that reads as a fault. Null while the sun is up.
 * `timeMs` names the moment (UTC), when known.
 */
export function sunDownNote(sunZ, timeMs = null) {
  if (!(sunZ <= 0)) return null;
  const when = Number.isFinite(timeMs)
    ? ` at ${new Date(timeMs).toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "";
  return (
    `The sun is below the horizon here${when}, so the relief lit by it has ` +
    "only the fading twilight sky, then goes dark. Set a daytime (#time=) " +
    "or choose the map lights."
  );
}

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
 * term + (1 - `shadow`) x the sky level (`skyLevel`) x the sky view. While
 * the sun stands above the sky floor, open flat ground in a clear sky gets
 * exactly max(0, L.z), the globe's dot(N, L), whatever the shadow share;
 * below it the sky holds the floor (DEC-GL5-11). The visibility (a cloud's
 * shadow) dims the direct term only, never the sky. RangeError for a
 * shadow share or a floor outside 0-1.
 *
 * @param {number[]} n  the shading normal
 * @param {number[]} sun  unit ENU toward the sun
 * @param {{ shadow: number, svf?: number, visibility?: number,
 *   skyFloor?: number }} o
 */
export function sunLight(
  n,
  sun,
  { shadow, svf = 1, visibility = 1, skyFloor = SKY_FILL.floor },
) {
  if (!(shadow >= 0 && shadow <= 1)) {
    throw new RangeError(`shadow must be in 0-1, got ${shadow}`);
  }
  return (
    shadow * sunDirect(n, sun, visibility) +
    (1 - shadow) * skyLevel(sun[2], skyFloor) * svf
  );
}

/**
 * What the globe draws for an albedo (sRGB 0-1) under a light (`sunLight`'s
 * units): the diffuse term of its MeshStandardMaterial, albedo / π x
 * `intensity` x light, through the Neutral tone mapping, back to sRGB.
 * `intensity` defaults to the globe's (`GLOBE_SUN.intensity`); a page's
 * `sunIntensity` key passes its own. The far field's `farColour` is the
 * one implementation (DEC-H3).
 */
export function sunLitColour(
  albedoSrgb,
  light,
  intensity = GLOBE_SUN.intensity,
) {
  return farColour(albedoSrgb, light, intensity);
}

/**
 * The shader's copy of this file (needs three's tone-mapping chunk and the
 * uniforms `uSun` (unit ENU toward the key light), `uSunIntensity` and
 * `uSkyFloor` (`SKY_FILL.floor`, or the page's `sky` key)).
 * `terrainSunVisibility` is the cloud-shadow port's seat: it receives the
 * fragment's ENU position (m, x east, y north), its height above the datum
 * (m) and the direction to the sun, and returns 1 until then.
 */
export const SUN_GLSL = /* glsl */ `
const float MIN_SUN_Z = ${MIN_SUN_Z.toFixed(8)};
const float TWILIGHT_Z = ${Math.sin(SKY_FILL.twilightDeg * DEG).toFixed(8)};

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

// terrain-sun.js skyLevel: the fill's light, the sun's height or the floor
// while the sun is up, faded through the twilight. Never dimmed by the
// visibility: a cloud's shadow takes the direct light only.
float skyLevel() {
  float fade = smoothstep(-TWILIGHT_Z, 0.0, uSun.z);
  return max(max(0.0, uSun.z), uSkyFloor * fade);
}

// terrain-sun.js sunLight.
float sunLight(vec3 n, float shadow, float svf, float visibility) {
  return shadow * sunDirect(n, visibility)
    + (1.0 - shadow) * skyLevel() * svf;
}

// terrain-sun.js sunLitColour: the diffuse term of the globe's
// MeshStandardMaterial at its sun's intensity, Neutral tone mapped, as the
// globe draws its ground.
vec3 sunLitColour(vec3 albedoSrgb, float light) {
  vec3 lin = sRGBTransferEOTF(vec4(albedoSrgb, 1.0)).rgb
    * uSunIntensity * max(0.0, light) / 3.141592653589793;
  return sRGBTransferOETF(vec4(clamp(NeutralToneMapping(lin), 0.0, 1.0), 1.0)).rgb;
}
`;
