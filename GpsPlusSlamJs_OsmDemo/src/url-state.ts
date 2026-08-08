/**
 * The URL as a projection of where the user is (DEC-R12-5).
 *
 * WHY THIS EXISTS. `start-position.ts` has read `?lat=&lng=` and `?site=` since
 * round 4, and nothing has ever written them — so the eighth testing session
 * jumped to London, reloaded, and came back to New York. The ask was not only
 * "remember where I was": it was so a finding can arrive as a LINK, and so the
 * Playwright suite can navigate to the same place a human was looking at. The
 * read side already carries half of that (`AT_FIXTURE` is a `?lat=&lng=` URL the
 * whole e2e suite stands on); this is the missing half.
 *
 * WHAT GOES IN, AND WHY SO LITTLE. The position, and the site id when the user
 * picked a named place. Presentation state — category, layers, ground mode — and
 * the camera pose stay OUT (DEC-R12-5): every new control would otherwise have
 * to decide whether it belongs in a URL, an old link would silently pin choices
 * whose meaning has moved, and a pose recorded against one scene anchor is
 * meaningless after a re-anchor. The accepted cost is that a shared link lands on
 * the right place with the default presentation.
 *
 * THIS MODULE OWNS THREE KEYS AND NOTHING ELSE. Anything already in the query
 * string survives, so a debug flag lives through a walk and a future parameter
 * needs no change here.
 *
 * @see url-state.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

/** Where the user is, and whether they got there by naming the place. */
export interface PlaceInUrl {
  readonly position: LatLng;
  /**
   * The picker/corpus id, when a named place was CHOSEN.
   *
   * Absent for a map click or a GPS fix — those are positions, not places, and
   * writing the nearest site's id would assert something the user did not say.
   *
   * `| undefined` is explicit because the repo runs `exactOptionalPropertyTypes`:
   * the caller reads a `string | undefined` variable that is cleared after every
   * move, and forcing it to omit the key instead would push a conditional spread
   * into the one place that must stay obvious.
   */
  readonly siteId?: string | undefined;
}

/**
 * Decimals written for a coordinate.
 *
 * FIVE, matching the `toFixed(5)` in the refresh cycle's status message, so a
 * pasted link and the line on screen name the same point. ~1.1 m at the equator,
 * which is finer than the res-13 cell the demo reasons in and coarser than GPS
 * jitter — the combination that lets {@link writePlace} skip the common case.
 */
const POSITION_DECIMALS = 5;

/** The keys this module owns. Everything else in the query is left untouched. */
const OWNED_KEYS = ["lat", "lng", "site"] as const;

/**
 * The query string `search` should become for `place`.
 *
 * Pure, and takes the current query rather than reading `window`, because the
 * interesting behaviour is what happens to the parameters that are ALREADY there
 * — which is exactly what a test of a `window`-reading function cannot state
 * cheaply.
 *
 * Returns a leading-`?` query, or `""` when nothing is left to write.
 */
export function placeQuery(search: string, place: PlaceInUrl): string {
  const params = new URLSearchParams(search);
  // CLEARED FIRST, BOTH FORMS. A site jump followed by a walk must not leave the
  // old `?site=` beside the new coordinates: the parser would resolve it
  // correctly (the pair wins) but a human reading the link would not.
  for (const key of OWNED_KEYS) params.delete(key);

  if (place.siteId !== undefined && place.siteId !== "") {
    params.set("site", place.siteId);
  } else {
    params.set("lat", format(place.position.lat));
    params.set("lng", format(place.position.lng));
  }

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * A coordinate at the written precision, with signed zero normalised away.
 *
 * `(-0).toFixed(5)` is already `"0.00000"`, so the `+ 0` is belt-and-braces
 * against a future format change rather than a live fix — but the store
 * normalises signed zero for the same round-trip reason, and a URL is the one
 * place the value is genuinely re-parsed.
 */
function format(value: number): string {
  return (value + 0).toFixed(POSITION_DECIMALS);
}

/** The slice of the browser's URL this module writes through. */
export interface PlaceUrl {
  /** The current query string, including the leading `?`. */
  readonly search: string;
  /** Replace the query with this one. `""` means "no query at all". */
  replace(search: string): void;
}

/**
 * Writes `place` into `url`, and does nothing when it is already there.
 *
 * THE GUARD IS NOT AN OPTIMISATION. The demo dispatches a position change on
 * every map click and every GPS fix; at the written precision, jitter under a
 * metre produces an identical string. Without the comparison the app would call
 * into the history API at GPS sample rate to write the URL it already had.
 */
export function writePlace(url: PlaceUrl, place: PlaceInUrl): void {
  const next = placeQuery(url.search, place);
  if (next === url.search) return;
  url.replace(next);
}

/** The `window` members {@link browserPlaceUrl} needs. Narrow, so tests can fake it. */
export interface PlaceUrlWindow {
  readonly location: { readonly search: string; readonly pathname: string };
  readonly history: {
    replaceState(data: unknown, unused: string, url: string): void;
  };
}

/**
 * {@link PlaceUrl} over the real browser URL.
 *
 * REPLACE, NEVER PUSH. A walk across the map is dozens of position changes;
 * pushing would fill the back stack with every step, so the back button would
 * undo the walk one click at a time instead of leaving the demo. The URL tracks
 * the current view rather than narrating how it was reached.
 */
export function browserPlaceUrl(win: PlaceUrlWindow): PlaceUrl {
  return {
    get search() {
      return win.location.search;
    },
    replace(search: string) {
      // AN EMPTY STRING IS A NO-OP FOR `replaceState`, which would silently keep
      // the old query — so "no query" has to be spelled as the path itself.
      win.history.replaceState(
        null,
        "",
        search === ""
          ? win.location.pathname
          : `${win.location.pathname}${search}`,
      );
    },
  };
}
