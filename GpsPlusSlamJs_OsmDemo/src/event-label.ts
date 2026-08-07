/**
 * The geo-event button's terminal label (F56).
 *
 * WHY THIS EXISTS. An event tile is ~900 m across and the demo opens at zoom
 * 18, showing a couple of hundred metres — so pressing the button very often
 * draws the winner outside the viewport and the map looks unchanged. The label
 * is what makes that legible: "Event at 14:15 · 640 m NE" says the feature
 * worked and where to look, without moving the camera.
 *
 * MOVING THE CAMERA WAS THE ALTERNATIVE AND WAS DECLINED (F56, owner decision
 * 2026-08-04). This demo does not take over the viewport uninvited; a HUD in
 * the 3D view is scoped as its own round.
 *
 * Pure and separately testable, because the arithmetic — a bearing across the
 * antimeridian, a distance that should read "1.2 km" not "1204 m" — has more
 * edge cases than the button that shows it.
 *
 * @see event-label.ts.md
 */

import type { GeoEvent, LatLng } from "gps-plus-slam-osm";

/** The eight compass points, in bearing order from north. */
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The button's resting label. Matches `index.html`, which renders it first. */
export const GEO_EVENT_IDLE_LABEL = "Next geo-event";

/** The button's in-progress label. */
export const GEO_EVENT_BUSY_LABEL = "Finding…";

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * HAVERSINE, not the planar approximation `newGeoEventFor` sorts with. That one
 * only has to decide an ORDER over tiles a kilometre apart, where any monotonic
 * function of true distance does; this number is shown to a person, so it has
 * to be right rather than merely monotonic.
 */
export function distanceMetres(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Initial great-circle bearing in degrees, normalised to [0, 360).
 *
 * The `atan2` form handles the antimeridian for free — a naive `to.lng -
 * from.lng` would report "east" for a target one degree west of the date line.
 */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const dLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const y = Math.sin(dLng) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLng);
  return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
}

/** The nearest of the eight compass points to a bearing. */
export function compassPoint(bearing: number): string {
  const normalised = ((bearing % 360) + 360) % 360;
  // +0.5 then floor, so each point owns the 45 degrees CENTRED on it — a bare
  // floor would label due north "NE" for its entire eastern half.
  const index = Math.floor(normalised / 45 + 0.5) % COMPASS.length;
  return COMPASS[index] ?? "N";
}

/**
 * A distance a person can read: metres below a kilometre, else one decimal.
 *
 * Rounded to 10 m under 1 km because the underlying cell is ~4 m across and a
 * bare metre count would imply precision the H3 quantisation does not have.
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.max(0, Math.round(metres / 10) * 10)} m`;
  }
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * The button's terminal label for a computed event.
 *
 * Returns the "nothing found" wording when the event has no picks, which is a
 * legitimate outcome rather than an error: a tile that is all water genuinely
 * has no event.
 */
export function describeGeoEvent(
  user: LatLng,
  event: GeoEvent,
  formatTime: (at: number) => string = (at) =>
    new Date(at).toLocaleTimeString(),
): string {
  // THE SEARCHED AREA IS PART OF THE ANSWER (F57), and it is the "nothing
  // found" case that needs it most. DEC-R9-15 means the tile set is your own
  // plus any neighbour already downloaded, so two people standing together can
  // legitimately see a different number of events while agreeing about each one.
  // "No event nearby" alone cannot distinguish "there is none" from "you have
  // not loaded enough to know", and the second reads as a bug.
  const searched = `searched ${event.tilesSearched} tile${event.tilesSearched === 1 ? "" : "s"}`;

  const nearest = event.picks[0];
  if (nearest === undefined) return `No event nearby · ${searched}`;

  const metres = distanceMetres(user, nearest.position);
  const where = compassPoint(bearingDegrees(user, nearest.position));
  return `Event at ${formatTime(event.eventTime)} · ${formatDistance(metres)} ${where} · ${searched}`;
}

/**
 * The button's label for a whole view state — the WHOLE of what it displays.
 *
 * A PURE FUNCTION OF (busy, position, event), which is what makes the label
 * state rather than a side effect of the last thing that happened. It used to
 * be written at the call site on success and reset to the resting text on
 * failure, so it could disagree with the map: a failed search reset a label that
 * described markers still on screen, and nothing put it back.
 *
 * The consequence worth knowing about: because the distance is measured from the
 * CURRENT position, the label re-reads as the user walks — "640 m NE" becomes
 * "210 m NE" — which is the behaviour F56 wanted and previously could not have,
 * since the string was frozen at the moment the search returned.
 */
export function geoEventButtonLabel(
  view: { position: LatLng; geoEvent: GeoEvent | undefined },
  busy: boolean,
  formatTime?: (at: number) => string,
): string {
  if (busy) return GEO_EVENT_BUSY_LABEL;
  if (view.geoEvent === undefined) return GEO_EVENT_IDLE_LABEL;
  return describeGeoEvent(view.position, view.geoEvent, formatTime);
}
