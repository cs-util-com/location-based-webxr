/**
 * Where the demo starts, from the URL.
 *
 * WHY THIS IS ITS OWN MODULE. It began as a helper inside `main.ts`, which is
 * DOM wiring and therefore has no unit tests — so every rejection branch here
 * was unreachable by the suite. The e2e suite only ever passes a valid pair, so
 * the whole guard could have been deleted and the gate would have stayed green.
 * A pure `search: string` in, `LatLng` out makes each branch testable without a
 * browser, which is the only reason the bug below was findable at all.
 *
 * @see start-position.ts.md
 */

import { siteById, type LatLng } from "gps-plus-slam-osm";

/**
 * Cologne Cathedral — where the fixtures and the field tests are.
 *
 * TAKEN FROM THE CORPUS TABLE rather than written out again (W5, DEC-R4-11).
 * A hard-coded pair here would be a seventh place: reachable by every user on
 * every load, and covered by no fixture — which is precisely the "the place you
 * see is not the place that is tested" gap the shared table closes.
 *
 * The `??` is unreachable while `cologne-cathedral` is in the table, and
 * `sites.test.ts` asserts it is (the site is the open R3-1/R4-7 finding, so its
 * removal would be a decision rather than an accident). It exists because the
 * alternative to a fallback is a module-load throw in a file whose entire job is
 * to never leave the demo without a position.
 */
export const DEFAULT_START: LatLng = siteById("cologne-cathedral")
  ?.position ?? {
  lat: 50.9413,
  lng: 6.9583,
};

/**
 * Parses `?lat=&lng=` from a query string, falling back to the default.
 *
 * Both parameters are required together: half an override would silently mix a
 * URL latitude with a default longitude and land somewhere neither the user nor
 * a test asked for.
 *
 * **`Number('')` is `0`, not `NaN` — and that is the whole reason this function
 * checks for emptiness before it checks for finiteness.** The README advertises
 * the literal form `?lat=&lng=`, which is exactly a present-but-empty pair: it
 * passes `Number.isFinite`, it passes the range check, and the demo silently
 * opens at 0°N 0°E in the Gulf of Guinea with no data and no error. `Number(' ')`
 * is `0` too, so a whitespace-only value does the same.
 */
export function parseStartPosition(search: string): LatLng {
  const params = new URLSearchParams(search);
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");

  // Absent, empty or whitespace-only: all mean "no override was given", and
  // only the first of the three is caught by a finiteness test.
  if (rawLat === null || rawLng === null) return DEFAULT_START;
  if (rawLat.trim() === "" || rawLng.trim() === "") return DEFAULT_START;

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_START;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return DEFAULT_START;

  return { lat, lng };
}
