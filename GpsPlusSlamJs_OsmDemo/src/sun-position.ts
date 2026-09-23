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
 * The MINIMUM angle between the sun and the eye at BOOT, radians.
 *
 * Carried over from `sun.ts`, where it was a property over every camera
 * position. It cannot be that any more (the user may put the sun behind the
 * camera on purpose), so it is asserted where a first-time viewer meets it:
 * the boot sun, now the REAL evening golden hour, swept over the picker's
 * places and every month. The reason is unchanged: a light on top of the eye
 * vector makes N·L maximal and nearly constant for every surface facing you,
 * which is the definition of flat.
 *
 * (The "plausible day" that lived here, `sunAt` with a fixed 55° noon, is
 * retired: the real sun for a place and a date is `sun-clock.ts`, plan
 * 2026-09-23-2149. This module stays import-free, because the look-dev page
 * loads `sunDirection` from it.)
 */
export const MIN_SUN_EYE_ANGLE_RAD = Math.PI / 8;

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
