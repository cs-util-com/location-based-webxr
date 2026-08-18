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
   * Re-anchors with no distance test. Under AR this must never be set — see
   * {@link AnchorOptions.frozen}, which enforces that rather than trusting it.
   */
  readonly declared?: boolean;

  /**
   * An AR session is live: the origin must not move for any reason.
   *
   * **NOT THE SAME AS "`declared` is unset", and that is the whole point**
   * (plan §2.4). AR never sets `declared`, so the origin looks safe already —
   * but {@link nextAnchor} re-anchors on DISTANCE independently past
   * {@link REANCHOR_THRESHOLD_M}, so a long walk or one wild fix moves the
   * frame under a live session with nothing in AR's code having asked for it.
   *
   * Why that is fatal rather than untidy: the framework's `zero` is immutable
   * for the session. A scene frame that moves and a GPS frame that does not are
   * two disagreeing origins — precisely the disagreement the fixed-origin work
   * removed — and the city jumps by kilometres.
   *
   * **Beats `declared`.** The site picker stays reachable while AR runs
   * (DEC-12 keeps the map), and honouring a picker jump would move the scene
   * frame away from a `zero` that cannot follow. The user's route to a new
   * origin is to RELOAD the page there. Leaving AR and re-entering does not do
   * it: `setZeroPos` is a no-op once set, so a new session re-reads the same
   * `zero` (r509 review corrected the opposite claim here).
   *
   * Does NOT suppress the first anchor: `current === undefined` is a seed, not
   * a re-anchor, and the holder is constructed before AR ever starts.
   */
  readonly frozen?: boolean;
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

  // THE SEED IS NOT A RE-ANCHOR, so it is decided before `frozen` is consulted:
  // there is no origin to protect yet, and freezing here would hand back
  // `undefined`.
  if (current === undefined) {
    return { origin: position, reanchored: true };
  }

  // BEFORE the `declared` branch, deliberately. A live AR session outranks the
  // site picker, because moving the scene frame away from an immutable `zero`
  // is a worse outcome than ignoring a jump. The user's route to a new origin
  // is a reload, not leaving AR — `setZeroPos` is a no-op once set.
  if (options.frozen === true) {
    return { origin: current, reanchored: false };
  }

  if (options.declared === true) {
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

/** The scene's current anchor, and the one place that is allowed to move it. */
export interface AnchorHolder {
  /** Where the frame is anchored right now. Never `undefined` — see the seed. */
  readonly origin: LatLng;
  /**
   * Applies {@link nextAnchor} for a new position and keeps the result.
   *
   * @throws `RangeError` for a non-finite position, leaving the held origin
   *   untouched — a half-updated holder would be worse than a thrown error.
   */
  advance(position: LatLng, options?: AnchorOptions): AnchorDecision;
}

/**
 * Holds the scene anchor for a session.
 *
 * **WHY THIS IS A HOLDER RATHER THAN STATE INSIDE THE REFRESH CYCLE.** A
 * position change drives THREE consumers — the camera pivot, the terrain load
 * and the refresh — and the refresh runs last. While the refresh owned the
 * decision, the other two necessarily read the OUTGOING anchor: after a
 * Cologne → Tokyo pick the camera pivoted on a frame ~9 000 km from the scene it
 * was looking at, and a terrain load threaded through the same value would have
 * sampled the ground in a frame the buildings no longer used.
 *
 * Ordering the statements in `main.ts` carefully would also fix it, once. A
 * single decision point that every consumer reads afterwards fixes it
 * structurally — and this codebase has now watched the same "the consumers of
 * the frame must move together" constraint be violated three times by being
 * written down rather than enforced.
 *
 * @param start the resolved start position. The demo has no GPS path, so this
 *   is the only origin that exists before the user moves (DEC-R11-7 §4.1) — and
 *   the initial terrain load reads it before any `advance` has happened.
 */
export function createAnchorHolder(start: LatLng): AnchorHolder {
  let current = nextAnchor(undefined, start).origin;

  return {
    get origin() {
      return current;
    },
    advance(position, options) {
      // Assigned only after `nextAnchor` returns, so a throw cannot leave a
      // half-updated holder behind.
      const decision = nextAnchor(current, position, options);
      current = decision.origin;
      return decision;
    },
  };
}
