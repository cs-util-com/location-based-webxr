/**
 * The arithmetic of a sound in the world, pure: how loud an ambient zone is
 * at a distance, when a visitor is inside a narration circle, and how the
 * background glides down under a voice. The world parts (`zone.ts`,
 * `spot.ts`) and the sound seam (`world-sound.ts`) read these; the ground
 * glow draws the same curve the ear hears.
 *
 * @see sound-reach.ts.md
 */

/** A narration circle's radius when its block names none (a lenient read's
 *  floor) and the editor's starting value. The circle and the tracked
 *  camera share the scene frame, so only the tracking's own noise reaches
 *  the distance; 6 m holds under every tracking model swept
 *  (`sound-reach.sweep.test.ts`) and was stable on a field walk. */
export const NARRATION_DEFAULT_RADIUS_M = 6;

/** How far beyond the radius a visitor inside counts as still inside; 1 m
 *  or more holds a neighbour off under poor tracking, 1.5 m leaves room. */
export const NARRATION_MARGIN_M = 1.5;

/** An ambient zone's reach when the editor adds one: a constant until it
 *  is heard outdoors on a phone. */
export const AMBIENT_DEFAULT_MAX_M = 20;

/** The background's share of its loudness while a voice is heard. */
export const BACKGROUND_UNDER_VOICE = 0.3;

/** The lowering's time constant (s). */
export const LOWER_GLIDE_S = 0.35;

/** An ambient zone's loudness fields, as the format holds them. */
export interface ZoneReach {
  readonly maxM: number;
  readonly minM?: number;
  readonly volume: number;
}

/**
 * The zone's loudness at `distanceM` from its centre: `volume` within
 * `minM` (0 when absent), falling linearly to 0 at `maxM`, 0 beyond. A
 * distance that is not a finite non-negative number is silence.
 */
export function zoneGain(distanceM: number, zone: ZoneReach): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  const min = zone.minM ?? 0;
  if (distanceM <= min) return zone.volume;
  if (distanceM >= zone.maxM) return 0;
  return zone.volume * (1 - (distanceM - min) / (zone.maxM - min));
}

/**
 * Whether a visitor at `distanceM` from a narration circle's centre is
 * inside it: entering at `radiusM`, leaving only beyond `radiusM +
 * marginM` (`wasInside` says which edge applies). Not a finite distance:
 * outside.
 */
export function circleInside(
  distanceM: number,
  radiusM: number,
  marginM: number,
  wasInside: boolean,
): boolean {
  if (!Number.isFinite(distanceM)) return false;
  return distanceM <= (wasInside ? radiusM + marginM : radiusM);
}

/** `current` moved toward `target` over `dtS` seconds with the time
 *  constant {@link LOWER_GLIDE_S}; no time, or time running back, no move. */
export function glide(current: number, target: number, dtS: number): number {
  if (!(dtS > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-dtS / LOWER_GLIDE_S));
}
