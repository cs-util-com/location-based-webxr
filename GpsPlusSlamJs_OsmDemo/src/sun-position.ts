/**
 * Where the sun is, as a physical position rather than as a function of the
 * camera (§1, DEC-R6-3).
 *
 * WHAT THIS REPLACES, AND WHY THE OLD ANSWER WAS RIGHT AT THE TIME. `sun.ts`
 * made the sun's AZIMUTH follow the camera's with a fixed 45° offset, so the
 * lighting relationship was constant as the eye orbited and a specular highlight
 * on the reflective ground was never lost (DEC-R4-6). That solved a real
 * complaint — _"wenn man aus dem richtigen Winkel guckt, sieht man schön die
 * Detailunterschiede, aber das ist meistens einfach nicht der Fall"_ — and it
 * worked because the sky was a painted texture that could simply be rotated to
 * match.
 *
 * WHY IT CANNOT SURVIVE §1. The sky is now three's `Sky` shader, a real
 * atmospheric-scattering model whose horizon glow, colour and brightness are all
 * derived from the sun's actual position. A sun that follows the camera makes
 * that entire sky rotate as you pan: the glow slides along the horizon and the
 * whole world reads as broken rather than as lit. The two are incompatible, and
 * DEC-R6-3 chose the physical sun.
 *
 * WHAT PAYS FOR THE REVERSAL. Two things, and they are the reason this is not
 * simply a regression:
 *
 * - **§2's slope treatment does not depend on the light direction at all.**
 *   Contour lines of constant steepness are visible from every azimuth, so the
 *   relief DEC-R4-6 was protecting is now carried by geometry rather than by a
 *   highlight. That is why the two stages are coupled: if §2 slips, this should
 *   slip with it.
 * - **A physical sun is what makes the environment map affordable.**
 *   `PMREMGenerator.fromScene` is a render pass; under a camera-following sun it
 *   would run on every drag, which is exactly the per-frame cost DEC-R3-9's
 *   on-demand renderer exists to avoid. A sun that only moves when the user
 *   changes the time runs it on a deliberate action and never otherwise.
 *
 * THE COMPASS CONVENTION IS THE ONE THING TO GET RIGHT. Azimuth is measured
 * **clockwise from north**, and north is the render frame's **−z** (the same
 * convention `mesh-data.ts` and `cell-mesh.ts` use). `sun.ts` measured from `+z`
 * instead, which was internally consistent but is not what a user means by
 * "azimuth" — and this value is about to become a user-facing control.
 *
 * @see sun-position.ts.md
 */

/** A direction in the render frame: `+x` east, `+y` up, `−z` north. */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where the sun is in the sky, as angles. */
export interface SunAngles {
  /** Height above the horizon, radians. Negative is below it. */
  readonly elevationRad: number;
  /** Clockwise from north, radians. */
  readonly azimuthRad: number;
}

/**
 * The sun's elevation at local noon, radians.
 *
 * 55°, which is a plausible summer noon for the demo's default latitude
 * (Cologne, 50.94° N, where the real figure runs from ~16° in December to ~62°
 * in June). NOT derived from a date and a latitude, and that is a deliberate
 * limit rather than an oversight: a real solar-position model is a well-defined
 * piece of work with its own tests, and nothing in this demo yet needs the sun
 * to be in the *correct* place — only in a *consistent and controllable* one.
 * Filed rather than faked; see the sidecar.
 */
export const MAX_SUN_ELEVATION_RAD = (55 * Math.PI) / 180;

/**
 * The MINIMUM angle between the sun and the eye at the DEFAULT time, radians.
 *
 * Carried over from `sun.ts`, where it was a property over every camera
 * position. It cannot be that any more — the user is now allowed to put the sun
 * behind the camera on purpose — so it is asserted at the default instead, which
 * is what a first-time viewer sees. The reason is unchanged: a light on top of
 * the eye vector makes N·L maximal and nearly constant for every surface facing
 * you, which is the definition of flat.
 */
export const MIN_SUN_EYE_ANGLE_RAD = Math.PI / 8;

/**
 * The time of day the demo opens on, in `0..1` across the day.
 *
 * 0.98 — late evening, giving an elevation of about 3.4° and an azimuth of about
 * 266° (just north of west). DEC-R6-3 took the prototype's golden hour, and the
 * low angle is not only taste: grazing light turns a small height difference
 * into a long tonal gradient, which is why every cartographic hillshade uses
 * one. A high sun flattens relief because everything faces it equally.
 *
 * EVENING RATHER THAN MORNING, which is arbitrary but fixed: "golden hour"
 * conventionally means the evening one, and the default camera looks north-west
 * from the south-east, so an evening sun is in front of the viewer rather than
 * behind them.
 */
export const DEFAULT_TIME_OF_DAY = 0.98;

/**
 * The sun's angles at a time of day in `0..1`.
 *
 * `0` is sunrise due east, `0.5` is noon due south, `1` is sunset due west. The
 * elevation follows a half-sine so noon is the maximum and the two halves of the
 * day are symmetric; the azimuth sweeps 90° → 270° linearly, which stays inside
 * one turn and therefore needs no wrap — a wrap here would snap the sky round
 * mid-drag.
 *
 * **This is a plausible day, not a correct one.** It has no date, no latitude
 * and no equation of time. See {@link MAX_SUN_ELEVATION_RAD}.
 *
 * Out-of-range input is CLAMPED rather than extrapolated, and a non-finite value
 * falls back to the default: the hotkey steps this and an off-by-one would
 * otherwise put the sun below the horizon, where the scattering shader's output
 * is undefined rather than merely dark.
 */
export function sunAt(timeOfDay: number): SunAngles {
  const t = Number.isFinite(timeOfDay)
    ? Math.min(1, Math.max(0, timeOfDay))
    : DEFAULT_TIME_OF_DAY;
  return {
    elevationRad: MAX_SUN_ELEVATION_RAD * Math.sin(Math.PI * t),
    azimuthRad: (Math.PI / 2) * (1 + 2 * t),
  };
}

/**
 * A UNIT vector pointing from the scene towards the sun.
 *
 * This is the direction a `DirectionalLight` must be placed along AND the vector
 * the sky shader's `sunPosition` uniform takes. **One function, two consumers**,
 * because two independently-derived sun positions would be visible: a sun in the
 * sky that disagrees with where the highlights fall.
 *
 * Unit-length rather than positioned: a `DirectionalLight` has no falloff, so the
 * distance is a rendering detail belonging to the caller.
 */
export function sunDirection(angles: SunAngles): Vector3Like {
  const horizontal = Math.cos(angles.elevationRad);
  return {
    // Clockwise from north, with north on −z: east is +x at 90°, so the
    // horizontal components are (sin A, −cos A) rather than (sin A, cos A).
    x: horizontal * Math.sin(angles.azimuthRad),
    y: Math.sin(angles.elevationRad),
    z: -horizontal * Math.cos(angles.azimuthRad),
  };
}

/**
 * The camera's azimuth about the vertical axis, radians — **clockwise from
 * north**, the same convention as {@link SunAngles.azimuthRad}.
 *
 * KEPT FROM `sun.ts` even though the sun no longer depends on it (DEC-R6-3): it
 * is a genuine measurement of the view and worth having available. **NOTHING
 * CURRENTLY READS IT except the tests** — check that before assuming a change
 * here is observable anywhere. It survives the dead-code check only because the
 * test imports it, so that claim will not fail loudly on its own.
 *
 * IT USED TO MEASURE FROM `+z`, inherited from `sun.ts` along with the function,
 * and so returned an angle 180° out from every other angle in this file. Nothing
 * read it, so nothing was visibly wrong — the trap was a future caller reaching
 * for the one function here that returns "an azimuth" and getting one measured
 * from the opposite pole. Raised in review on #264.
 *
 * Measured from the offset between the camera and what it is looking at, so it
 * is the direction the VIEW comes from rather than where the camera happens to
 * sit in world space. Returns 0 for a camera directly above its target, which is
 * degenerate rather than wrong — at that point every azimuth looks the same.
 */
export function cameraAzimuth(
  camera: Vector3Like,
  target: Vector3Like,
): number {
  const dx = camera.x - target.x;
  const dz = camera.z - target.z;
  if (dx === 0 && dz === 0) return 0;
  // North is −z, so the north component is −dz — the inverse of `sunDirection`,
  // and `sun-position.test.ts` asserts the round trip rather than trusting it.
  return Math.atan2(dx, -dz);
}
