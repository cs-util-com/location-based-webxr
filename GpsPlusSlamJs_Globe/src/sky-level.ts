/**
 * The sky's level for the fill light (DEC-GL5-11), the one implementation
 * the terrain lab's relief and the globe's surface both read (DEC-H3).
 * The terrain lab's `node --test` files load it through the design
 * system's route loader.
 *
 * @see sky-level.ts.md
 */

import { smoothstep } from "./globe-ease.js";

const DEG = Math.PI / 180;

/**
 * The sky fill's parameters (DEC-GL5-11). The fill is the light the sky
 * gives a face the sun does not reach. While the sun is up the sky level is
 * `max(sin h, floor)`; below the horizon the floor fades (smoothly) to 0
 * over `twilightDeg` (civil twilight). `floor` is in the units of open flat
 * ground under a zenith sun; 0.5 is the terrain lab's measured choice (at
 * an 11 degree sun on the Alps it lifts the darkest tenth of `globe-albedo`
 * above 10 of 255 and keeps the relief at least as contrasty as at noon).
 */
export const SKY_FILL = Object.freeze({ floor: 0.5, twilightDeg: 6 });

/**
 * The sky's level at a sun height (`sunZ`, the sine of its elevation):
 * max(sin h, floor) while the sun is up, the floor faded to 0 over
 * `twilightDeg` below the horizon. Never falls as the sun rises.
 * RangeError for a non-finite height, a floor outside 0-1 or a twilight
 * outside 0-90 degrees.
 */
export function skyLevel(
  sunZ: number,
  floor: number = SKY_FILL.floor,
  twilightDeg: number = SKY_FILL.twilightDeg,
): number {
  if (!Number.isFinite(sunZ)) {
    throw new RangeError(`sun height must be finite, got ${sunZ}`);
  }
  if (!(floor >= 0 && floor <= 1)) {
    throw new RangeError(`sky floor must be in 0-1, got ${floor}`);
  }
  if (!(twilightDeg > 0 && twilightDeg < 90)) {
    throw new RangeError(`twilight must be in 0-90°, got ${twilightDeg}`);
  }
  const edge = Math.sin(twilightDeg * DEG);
  const fade = smoothstep((sunZ + edge) / edge);
  return Math.max(Math.max(0, sunZ), floor * fade);
}

/**
 * The shader's copy: `skyLevelOf(sunZ, floorLevel)`, the twilight baked
 * from `SKY_FILL` (the floor is a uniform in each shader that uses it).
 */
export const SKY_LEVEL_GLSL = /* glsl */ `
float skyLevelOf( float sunZ, float floorLevel ) {
  float fade = smoothstep( -${Math.sin(SKY_FILL.twilightDeg * DEG).toFixed(8)}, 0.0, sunZ );
  return max( max( 0.0, sunZ ), floorLevel * fade );
}`;
