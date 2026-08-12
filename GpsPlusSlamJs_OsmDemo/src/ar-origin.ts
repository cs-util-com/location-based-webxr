/**
 * Where AR mode anchors the city, and the two conversions it needs.
 *
 * **WHY THIS IS ITS OWN MODULE.** Both conversions are one-liners and both are
 * the kind of one-liner that is wrong for months: the framework says `lon` and
 * this demo says `lng`, and the geoid turns an orthometric DEM height into the
 * ellipsoidal one the GPS-world frame is measured in. Neither has a natural
 * home in `ar-mode.ts` (which owns a session lifecycle) and both need testing
 * without a WebXR session, a renderer or a DOM.
 *
 * **THE ORIGIN IS THE FRAMEWORK'S `zero`, NOT THE DEMO'S POSITION** (DEC-R11-6).
 * The demo picks a start position from a place-picker and moves it on every map
 * click; the framework's `zero` is taken from the first GPS fix and is immutable
 * for the session. AR must use the latter, because the alignment matrix the
 * fusion produces is expressed against it — anchoring the mesh anywhere else
 * means the camera and the city disagree by however far the two have drifted.
 *
 * `zero` is `null` until a fix arrives, and that is why AR entry WAITS rather
 * than falling back to the map position. DEC-R11-6 rejected re-anchoring on the
 * first non-null `zero`, so entering early and correcting later is not
 * available: there is nothing to correct to.
 *
 * @see ar-origin.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

/** The framework's coordinate shape. `lon`, where this demo says `lng`. */
export interface FrameworkLatLong {
  readonly lat: number;
  readonly lon: number;
}

/**
 * `{lat, lon}` → `{lat, lng}`.
 *
 * **The whole adapter DEC-R11-6 calls for.** Trivial and worth naming: the two
 * shapes are structurally similar enough that TypeScript accepts neither for
 * the other, so the failure is a compile error rather than a silent 0 — but
 * only as long as nobody reaches for a cast. This is the alternative to that
 * cast.
 */
export function toDemoLatLng(origin: FrameworkLatLong): LatLng {
  return { lat: origin.lat, lng: origin.lon };
}

/**
 * The datum AR asks the worker for, given the geoid undulation at the origin.
 *
 * Returns the value `terrain-field.ts` wants as `absoluteDatum`, so the caller
 * never has to remember the sign. `heightAt` computes `surfaceHeight − datum`,
 * so producing an ellipsoidal height from an orthometric DEM means subtracting
 * `−N`, i.e. the datum is the NEGATED undulation.
 *
 * **The sign is the whole content of this function and the reason it exists.**
 * Getting it backwards puts the city ~2N — about 94 m at Cologne — out of
 * place, in the direction that reads as a GPS+SLAM fusion bug rather than as an
 * elevation one, which is a much more expensive place to go looking. That
 * warning is `geoid.ts`'s, and it is why the demo pays for a function instead
 * of writing a minus sign at the call site.
 */
export function absoluteDatumFor(undulationMetres: number): number {
  return -undulationMetres;
}

/**
 * Whether AR may start yet.
 *
 * A `null` origin means no GPS fix has landed. Entering AR then would anchor
 * the city to nothing and there is no correction available later, because
 * DEC-R11-6 rejected re-anchoring on the first non-null `zero`.
 */
export function canEnterAr(origin: FrameworkLatLong | null): boolean {
  return origin !== null;
}
