/**
 * Where the sun is, given where the camera is (W12, R4-5, DEC-R4-6).
 *
 * THE COMPLAINT. The ground is deliberately reflective (DEC-R2-1) so that facet
 * edges show as a specular highlight slides across them — and with a FIXED light
 * and an orbiting eye, that highlight only appears over a band of camera
 * azimuths. The owner's words: _"wenn man aus dem richtigen Winkel guckt, sieht
 * man schön die Detailunterschiede, aber das ist meistens einfach nicht der
 * Fall"_. A highlight appears where the half-vector between light and eye aligns
 * with a facet normal, so as the eye moves and the light does not, the condition
 * is met somewhere and missed everywhere else.
 *
 * WHY THE OBVIOUS FIX IS THE WRONG ONE, AND THIS IS THE POINT OF THE FILE. The
 * first instinct — put the light AT the camera — makes it worse. A headlight
 * puts the light vector on top of the eye vector, so N·L becomes maximal and
 * nearly constant for every surface facing you: that is the definition of flat,
 * and it destroys exactly the contour and relief the change was meant to reveal.
 * It is the flash-photography look. The owner hedged on this in the notes and
 * the hedge was right; DEC-R4-6 records the reversal.
 *
 * WHAT IS DONE INSTEAD. The sun's AZIMUTH follows the camera's with a fixed
 * offset, at a fixed low elevation. The lighting relationship is then constant
 * as you orbit — the highlight is never lost — while N·L still varies strongly
 * across facets, because the light is never anywhere near the eye. The low
 * elevation is the other half: grazing light is what makes small height
 * differences read, which is why every cartographic hillshade uses one.
 *
 * WHY THIS DOES NOT NEED A FRAME LOOP. DEC-R3-9 keeps rendering on demand — a
 * permanent rAF was measured at ~6x the e2e suite runtime and burns a phone's
 * battery repainting a static city. The sun only has to move when the camera
 * does, which is exactly when a frame is already being scheduled.
 *
 * ONE SUN VECTOR. `building-view.ts` drives both the `DirectionalLight` and the
 * sky's painted sun disc from this function. Two independently-set sun positions
 * would be the two-derivations-of-one-thing defect this project keeps removing,
 * and here it would be visible: a sun in the sky that disagrees with where the
 * highlights fall.
 *
 * @see sun.ts.md
 */

/**
 * How far the sun sits to the side of the camera, radians.
 *
 * 45°: far enough that the light is never a headlight (see the file header),
 * close enough that the lit faces are mostly the ones you are looking at. To the
 * LEFT, which is arbitrary but fixed — the point is that it never changes.
 */
export const SUN_AZIMUTH_OFFSET_RAD = Math.PI / 4;

/**
 * The sun's height above the horizon, radians.
 *
 * 30°, and low on purpose. A high sun flattens relief (everything faces it
 * equally); a grazing one turns a small height difference into a long tonal
 * gradient, which is the whole reason hillshading uses ~45° or lower. Not lower
 * than this, or the buildings' own walls shade most of the ground.
 */
export const SUN_ELEVATION_RAD = Math.PI / 6;

/**
 * The MINIMUM angle between the sun and the eye, radians.
 *
 * Not a tuning knob — it is the formal statement of "this is not a headlight",
 * and `sun.test.ts` asserts it as a property over the whole range of camera
 * positions. Without it, a later tweak to the offset or the elevation could
 * quietly reintroduce the flat look this file exists to prevent, and the only
 * symptom would be that the scene stopped having contrast.
 */
export const MIN_SUN_EYE_ANGLE_RAD = Math.PI / 8;

/** A direction in the render frame: `+x` east, `+y` up, `−z` north. */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The camera's azimuth about the vertical axis, radians.
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
  return Math.atan2(dx, dz);
}

/**
 * A UNIT vector pointing from the scene towards the sun.
 *
 * This is the direction a `DirectionalLight` must be placed along, and the
 * direction the sky's sun disc must be drawn at. It is deliberately unit-length
 * rather than positioned: a `DirectionalLight` has no falloff, so the distance
 * is a rendering detail belonging to the caller.
 */
export function sunDirection(cameraAzimuthRad: number): Vector3Like {
  const azimuth = cameraAzimuthRad + SUN_AZIMUTH_OFFSET_RAD;
  const horizontal = Math.cos(SUN_ELEVATION_RAD);
  return {
    x: horizontal * Math.sin(azimuth),
    y: Math.sin(SUN_ELEVATION_RAD),
    z: horizontal * Math.cos(azimuth),
  };
}
