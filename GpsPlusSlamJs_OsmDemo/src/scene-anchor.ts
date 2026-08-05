/**
 * The scene anchor — where the ENU frame's origin sits, and when it moves.
 *
 * The demo used to derive its origin from the user's current position on every
 * publish, so **every vertex in the scene moved whenever the user did**. The AR
 * framework's origin is the opposite: `setZeroPos` sets `zero` once per session
 * and never again, and every GPS observation is stored relative to it. Geometry
 * built the old way could therefore never share a scene with AR content — it
 * would shift wholesale on every refresh while the AR content stayed put.
 *
 * So the origin is now a property of the SCENE, not of the current position.
 *
 * **Two rules, because two things can move the user and they differ in kind:**
 *
 * - **A declared place change re-anchors unconditionally.** Choosing a site is
 *   a discontinuity, not travel. The picker spans Cologne to Tokyo — ~9 000 km
 *   — where the frame's fixed longitude scale is wrong by ~29 %, so the city
 *   would be sheared into unrecognisable geometry rather than merely offset.
 * - **Ordinary navigation re-anchors only past {@link REANCHOR_THRESHOLD_M}.**
 *   A step, a drag or a locate keeps the origin, which is the entire point.
 *
 * @see scene-anchor.ts.md
 */

import { greatCircleDistance, UNITS } from "h3-js";

import type { LatLng } from "gps-plus-slam-osm";

/**
 * How far the user may travel before the origin is re-taken, in metres.
 *
 * **5 km, the conservative end of the owner's ~5–10 km range (DEC-R11-7).** It
 * never fires during a walk or a normal map drag, and it halves the worst-case
 * frame distortion against the 10 km end.
 *
 * The error this bounds is **not** float32 — that term is negligible here, a
 * fraction of a millimetre at the demo's whole extent. It is the equirectangular
 * approximation in `enuFrameAt`, which fixes the longitude scale at the origin's
 * latitude: the easting error grows as roughly `tan(φ₀)·Δφ`, giving ~1 m at
 * 2.4 km and ~19 m at 10 km.
 *
 * That figure is against **true geodesy**, not against the AR content: the
 * framework's own `calcRelativeCoordsInMeters` makes the identical
 * approximation with the same fixed cosine, so both subsystems are wrong in
 * precisely the same way — which is what makes them agree with each other.
 * Locally the residual is a scale error of ~0.2 % at a 10 km offset, about half
 * a metre across a city block.
 */
export const REANCHOR_THRESHOLD_M = 5_000;

/** Where the frame is anchored, and whether this call moved it. */
export interface AnchorDecision {
  readonly origin: LatLng;
  /**
   * True when the origin was re-taken, so the caller must rebuild the scene
   * wholesale — which is exactly the pre-existing behaviour and therefore
   * already known to work.
   */
  readonly reanchored: boolean;
}

export interface AnchorOptions {
  /**
   * The user chose a new place rather than travelling to it.
   *
   * Re-anchors with no distance test. Under AR this must never be set: the
   * framework's `zero` is immutable, and re-anchoring during a live session
   * would reintroduce the very disagreement this module removes.
   */
  readonly declared?: boolean;
}

/**
 * The anchor for a scene, given where it currently is and where the user is.
 *
 * @param current the existing anchor, or `undefined` for the first call of a
 *   session — which adopts `position` rather than comparing against nothing.
 * @throws `RangeError` if `position` is not a finite lat/lng. A `NaN` would
 *   poison every ENU coordinate derived from the frame, and
 *   `greatCircleDistance` returns `NaN` rather than throwing — so a plain
 *   `distance > threshold` would be false and the bad value would silently
 *   become the basis of every vertex in the scene.
 */
export function nextAnchor(
  current: LatLng | undefined,
  position: LatLng,
  options: AnchorOptions = {},
): AnchorDecision {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    throw new RangeError(
      `nextAnchor: position must be a finite lat/lng, got ${position.lat},${position.lng}`,
    );
  }

  if (current === undefined || options.declared === true) {
    return { origin: position, reanchored: true };
  }

  const travelled = greatCircleDistance(
    [current.lat, current.lng],
    [position.lat, position.lng],
    UNITS.m,
  );

  // STRICTLY GREATER, so the boundary keeps the anchor rather than being a coin
  // flip on the comparison operator that happened to be typed.
  return travelled > REANCHOR_THRESHOLD_M
    ? { origin: position, reanchored: true }
    : { origin: current, reanchored: false };
}
