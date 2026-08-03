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

import { PICKER_PLACES, placeById } from "./picker-places.js";

/**
 * The Central Park edge in Manhattan — the demo's opening frame (DEC-R6b-3).
 *
 * MOVED FROM COLOGNE IN ROUND 7. The sixth session asked for Manhattan at
 * position 1 of the picker, and "the first entry in the list is not where you
 * are" was the specific defect that made it the default too.
 *
 * TAKEN FROM `PICKER_PLACES[0]` rather than written out again, and that is the
 * whole point: the two would otherwise drift, and the drift IS the defect
 * DEC-R6b-3 rejected. A hard-coded pair here would also be a fifteenth place —
 * reachable on every load and listed nowhere.
 *
 * The `??` is unreachable while the list is non-empty (`picker-places.test.ts`
 * asserts both its length and its first entry). It exists because the
 * alternative to a fallback is a module-load throw in a file whose entire job is
 * to never leave the demo without a position.
 */
export const DEFAULT_START: LatLng = PICKER_PLACES[0]?.position ?? {
  lat: 40.7677,
  lng: -73.9807,
};

/**
 * Parses `?lat=&lng=` or `?site=` from a query string, falling back to the
 * default.
 *
 * **`?lat=&lng=` wins over `?site=`** when both are given and the pair is
 * usable. The coordinate pair is the more specific instruction, and the e2e
 * suite depends on it: `AT_FIXTURE` must land on the captured fixture whatever
 * else is in the URL. An EMPTY pair is not a usable one (see below), so
 * `?lat=&lng=&site=…` still honours the site.
 *
 * Both coordinate parameters are required together: half an override would
 * silently mix a URL latitude with a default longitude and land somewhere
 * neither the user nor a test asked for.
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
  const coordinates = parseCoordinates(params);
  if (coordinates !== undefined) return coordinates;

  return parseSite(params) ?? DEFAULT_START;
}

/** The `?lat=&lng=` pair, or `undefined` when it is absent or unusable. */
function parseCoordinates(params: URLSearchParams): LatLng | undefined {
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");

  // Absent, empty or whitespace-only: all mean "no override was given", and
  // only the first of the three is caught by a finiteness test.
  if (rawLat === null || rawLng === null) return undefined;
  if (rawLat.trim() === "" || rawLng.trim() === "") return undefined;

  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;

  return { lat, lng };
}

/**
 * The `?site=` id, or `undefined` when it is absent or unrecognised.
 *
 * **THIS IS THE GUARANTEE THAT REPLACED THE SHARED TABLE (DEC-R6b-1).** Round 7
 * split the picker list from `CORPUS_SITES`, and DEC-R4-11's warning stands:
 * two lists drift, and the cost is that the places a human can reach stop being
 * the places the suite covers. So BOTH lists are searched here, and the picker
 * is searched first only because its entries are the ones a visitor will use.
 * A corpus site that is not in the dropdown — Sylt, Heidelberg, Berlin, which
 * the owner asked to remove — stays fully visitable through this route, and
 * `start-position.test.ts` asserts that for every entry in `CORPUS_SITES`.
 *
 * Reachability rather than dropdown membership is what makes "Sylt auf jeden
 * Fall raus" and "the tested places must stay visitable" both true at once.
 */
function parseSite(params: URLSearchParams): LatLng | undefined {
  const id = params.get("site")?.trim();
  if (id === undefined || id === "") return undefined;

  return (placeById(id) ?? siteById(id))?.position;
}
