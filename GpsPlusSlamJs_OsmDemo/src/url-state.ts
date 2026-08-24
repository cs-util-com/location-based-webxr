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
 * picked a named place. Presentation state — category, layers, ground mode —
 * stays OUT (DEC-R12-5): every new control would otherwise have to decide
 * whether it belongs in a URL, and an old link would silently pin choices whose
 * meaning has moved. The accepted cost is that a shared link lands on the right
 * place with the default presentation.
 *
 * THE CAMERA'S TARGET WENT IN LATER (DEC-R13-7), and the POSE still stays out.
 * DEC-R12-5 rejected a pose because one recorded against a scene anchor is
 * meaningless after a re-anchor; a target in lat/lng has no anchor in it, so
 * that objection does not reach this encoding.
 *
 * TWO WRITERS, SIX KEYS, AND NEITHER TOUCHES THE OTHER'S. `placeQuery` owns
 * `lat`/`lng`/`site`; `cameraQuery` owns `clat`/`clng`/`cdist`. Anything else in
 * the query survives both, so a debug flag lives through a walk and a future
 * parameter needs no change here. They share one query string through
 * `history.replaceState`, so whichever runs last decides all of it — preserving
 * what you do not own is the whole reason that is safe.
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

/**
 * The keys the PLACE writer owns and clears before writing.
 *
 * Everything else in the query is left untouched — including the camera's
 * `clat`/`clng`/`cdist`, which is what lets the two writers share one query
 * string without either normalising the other away.
 */
const OWNED_KEYS = ["lat", "lng", "site"] as const;

/** Where the camera is looking, and from how far away. */
export interface CameraInUrl {
  /** The point the camera is aimed at, on the ground. */
  readonly target: LatLng;
  /** Metres from the camera to that point. */
  readonly distanceM: number;
}

/**
 * The camera distance is written as whole metres, between these bounds.
 *
 * WHOLE METRES because the distance exists so a reloaded link is zoomed roughly
 * where the reporter was, and sub-metre precision on a hundreds-of-metres number
 * would only churn the URL.
 *
 * **BOUNDED AT BOTH ENDS, AND BOTH ENDS ARE REAL** (raised in review on #276).
 * This is the one field the reader cannot sanity-check from the value alone —
 * lat/lng have obvious ranges and this does not — and `MapControls` is
 * constructed without `minDistance`/`maxDistance`, so nothing downstream clamps
 * it either.
 *
 * - **Below 1 m**, `toFixed(0)` writes `"0"`, which {@link parseCameraTarget}
 *   then refuses — a write the read side silently drops, which is the worst
 *   kind of round-trip hole because the URL looks fine.
 * - **Beyond the far plane**, a restored camera renders an empty scene and
 *   cannot recover: the writer only fires on a `change` event the user now has
 *   no visible geometry to trigger. A pasted link that has been truncated or
 *   hand-edited is exactly the case this feature exists to survive.
 */
const MIN_DISTANCE_M = 1;
/**
 * The far plane the page BOOTS with, 4800 m — **written out rather than
 * imported**, because this module is deliberately free of the 3D view:
 * importing `FAR_PLANE_M` would make a pure URL parser depend on
 * `building-view.ts` and, through it, on three.js. `url-state.test.ts` asserts
 * it equals `FAR_PLANE_M * DEFAULT_RENDER_MULTIPLIER`, which is this repo's
 * usual answer to "two values that match today with nothing saying they must".
 *
 * **RAISED 2400 → 4800 BY DEC-K2 (2026-08-22).** It used to be the 1x baseline.
 * Since the page boots at `DEFAULT_RENDER_MULTIPLIER` it drew to 4800 m while
 * still refusing to SHARE any camera beyond 2400 — so a user who zoomed out and
 * pasted the link sent a truncated view with no error on either side. That is
 * the round-trip hole this module's own comments warn about, in the direction
 * nobody checked when the default moved.
 *
 * ⚠️ **A link is bounded by the DEFAULT, and a recipient who has turned their
 * dial down to 1x can restore a target past their far plane and see nothing.**
 * Accepted: a pasted link always opens a freshly booted page, which is at the
 * default; the 1x case is a deliberate act by the recipient with an obvious
 * remedy, while silent truncation is neither visible nor recoverable.
 */
export const MAX_DISTANCE_M = 4800;

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

/**
 * The query string `search` should become for `camera` (DEC-R13-7).
 *
 * **A PARTIAL POSE, AND THE PARTIALITY IS THE POINT.** DEC-R12-5 rejected the
 * camera pose outright, because "a pose recorded against one scene anchor is
 * meaningless after a re-anchor" — and it was right about that. A target in
 * lat/lng is **anchor-independent by construction**, so the trap does not apply
 * to this encoding, which is what makes DEC-R13-7 a safe partial reversal rather
 * than a change of mind. Orientation stays out: it is the noisiest thing to
 * sample and the part that spins while dragging.
 *
 * The argument DEC-R12-5 did not weigh is that the URL is the REPORTING TOOL for
 * these sessions. Twice in the ninth session a finding could not be pointed at —
 * "wüsste ich nicht, wie ich dir das irgendwie sinnvoll als Testbereich nennen
 * kann".
 *
 * **IT PRESERVES EVERYTHING IT DOES NOT OWN**, exactly as {@link placeQuery}
 * does, and that is not politeness: both writers go through
 * `history.replaceState`, so whichever runs last decides the whole query. A
 * writer that rebuilt the string from scratch would erase the other's keys.
 */
export function cameraQuery(search: string, camera: CameraInUrl): string {
  const params = new URLSearchParams(search);
  // `clat`/`clng`/`cdist` — DELIBERATELY NOT `lat`/`lng`. `parseStartPosition`
  // gives that pair priority over `?site=`, so a camera target written under
  // those names would silently move the USER. A viewpoint and a position are
  // different facts and the URL has to say which is which.
  //
  // NO `delete` LOOP HERE, unlike `placeQuery` (raised in review on #276).
  // `URLSearchParams.set` replaces an existing key IN PLACE and appends a new
  // one, while deleting first moves all three to the END of the query — so a
  // camera that had not actually moved still produced a different string, and
  // `writeCamera`'s identity guard could not suppress the redundant history
  // write. `placeQuery` needs its deletes because its two forms are mutually
  // exclusive; all three keys here are always written.
  params.set("clat", format(camera.target.lat));
  params.set("clng", format(camera.target.lng));
  params.set("cdist", String(clampDistance(camera.distanceM)));

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * The distance as whole metres inside {@link MIN_DISTANCE_M} …
 * {@link MAX_DISTANCE_M}.
 *
 * CLAMPED ON THE WRITE SIDE, REFUSED ON THE READ SIDE, and the asymmetry is
 * deliberate. A value out of range coming from the app is the app's own camera
 * having gone somewhere odd, and the useful answer is the nearest sensible
 * viewpoint; the same value arriving in a URL is a link that has been mangled,
 * and the useful answer is to ignore it and open normally.
 *
 * A non-finite distance clamps to the minimum rather than writing `"NaN"` —
 * this is the one place in the module with no validation behind it, since the
 * value comes from a `Vector3.distanceTo` rather than from a user.
 */
function clampDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM)) return MIN_DISTANCE_M;
  return Math.min(
    MAX_DISTANCE_M,
    Math.max(MIN_DISTANCE_M, Math.round(distanceM)),
  );
}

/**
 * Writes `camera` into `url`, and does nothing when it is already there.
 *
 * THE GUARD IS WHAT MAKES THE DEBOUNCE SUFFICIENT. A drag settles into a
 * position that rounds to the same five decimals long before it stops
 * generating events, so without this the app would call the history API
 * repeatedly to write the URL it already had — the same reason
 * {@link writePlace} compares rather than assigns.
 */
export function writeCamera(url: PlaceUrl, camera: CameraInUrl): void {
  const next = cameraQuery(url.search, camera);
  if (next === url.search) return;
  url.replace(next);
}

/**
 * The camera target in a query string, or `undefined` when it is absent or
 * unusable.
 *
 * THE READ SIDE LIVES HERE, next to its writer, rather than in
 * `start-position.ts`. That module answers one question — where does the demo
 * open — and a viewpoint is not a position: folding this into
 * `parseStartPosition` would put two different facts behind one return value.
 * The round trip is what the test pins.
 *
 * **`Number('')` IS `0`, NOT `NaN`**, so emptiness is checked before finiteness
 * — the same trap `start-position.ts` documents, where `?lat=&lng=` opened the
 * demo in the Gulf of Guinea. All three parameters are required together: a
 * partial camera state is not a viewpoint.
 */
export function parseCameraTarget(search: string): CameraInUrl | undefined {
  const params = new URLSearchParams(search);
  const lat = numberIn(params, "clat");
  const lng = numberIn(params, "clng");
  const distanceM = numberIn(params, "cdist");
  if (lat === undefined || lng === undefined || distanceM === undefined) {
    return undefined;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  // A camera at or behind its own target has no viewing direction to restore,
  // and one beyond the far plane restores a view of NOTHING — see
  // `MIN_DISTANCE_M`/`MAX_DISTANCE_M` for why nothing downstream catches either.
  if (distanceM < MIN_DISTANCE_M || distanceM > MAX_DISTANCE_M)
    return undefined;
  return { target: { lat, lng }, distanceM };
}

/** One finite parameter, or `undefined` if absent, blank or unusable. */
function numberIn(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
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
