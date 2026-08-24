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
 * 2026-08-04) — **AND THAT WAS REVERSED ON 2026-08-19 (DEC-U12).** The map now
 * pans to the winner at the current zoom when the button is pressed. The
 * objection F56 recorded was to an UNINVITED viewport takeover, and a move
 * triggered by an explicit press is not uninvited; holding the zoom is what
 * keeps it a pan rather than a takeover.
 *
 * So the paragraph above is why this module used to carry the whole
 * description, and it no longer does: the button is one of two constants
 * (F4a), the description goes to the toast, and what survives here is
 * {@link geoEventReadout} — the distance and bearing that re-read as the user
 * walks, which was F56's actual win and is the one thing neither the pan nor
 * the toast replaces.
 *
 * Pure and separately testable, because the arithmetic — a bearing across the
 * antimeridian, a distance that should read "1.2 km" not "1204 m" — has more
 * edge cases than the button that shows it.
 *
 * @see event-label.ts.md
 */

import { formatDistance as sharedFormatDistance } from "gps-plus-slam-app-framework/utils/format-distance";
import type { GeoEvent, LatLng } from "gps-plus-slam-osm";

/** The eight compass points, in bearing order from north. */
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/**
 * The button's resting label. Matches `index.html`, which renders it first.
 *
 * "QUESTS" IS A UI WORD ONLY (DEC-U11). The store, the worker protocol, this
 * module and every doc still say `geoEvent`; the owner accepted that the button
 * and the console will disagree, and a rename through the code was declined
 * because it would have been a wide mechanical diff over the same worker
 * protocol the DEM race was changing in the same round — which is where a real
 * change hides.
 */
export const GEO_EVENT_IDLE_LABEL = "Show Quests";

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
  // The workspace's shared formatter (2026-08-24), with this app's rule:
  // metres to the nearest 10, kilometres to one decimal. The step is the
  // decision worth keeping - these distances come from a GPS fix and a tile
  // centre, so a metre of apparent precision would be a claim the data does not
  // support. `format-distance.test.ts` pins the output against the old body.
  return sharedFormatDistance(metres, { metreStep: 10, metreDecimals: 0 });
}

/**
 * The button's terminal label for a computed event.
 *
 * Returns the "nothing found" wording when the event has no picks, which is a
 * legitimate outcome rather than an error: a tile that is all water genuinely
 * has no event.
 */
/**
 * The RESOLVED slot, worded so a picked day is visible.
 *
 * WHY THE DATE IS CONDITIONAL (W6, and DEC-G1's real requirement). The label was
 * time-only, which was fine while every search meant "now" — it could only ever
 * be today. A picker makes "next Tuesday at 18:00" expressible, and a time-only
 * label would show `18:15` for it, indistinguishable from today's. So the date
 * appears exactly when it is not today, which keeps the common case short and
 * makes the uncommon one unambiguous.
 *
 * THE VALUE SHOWN IS THE RESOLVED SLOT, NOT THE REQUESTED INSTANT, and that is
 * not a detail: `nextEventTime` quantises to the next quarter-hour, so a request
 * for 18:07 legitimately produces an 18:15 event. Showing what was asked for
 * would make the marker and the label disagree about the same thing.
 */
export function describeEventTime(
  at: number,
  today: Date = new Date(),
): string {
  const when = new Date(at);
  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();
  const time = when.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return time;
  return `${when.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

export function describeGeoEvent(
  user: LatLng,
  event: GeoEvent,
  formatTime: (at: number) => string = (at) => describeEventTime(at),
): string {
  // THE SEARCHED AREA IS PART OF THE ANSWER (F57), and it is the "nothing
  // found" case that needs it most. DEC-R9-15 means the tile set is your own
  // plus any neighbour already downloaded, so two people standing together can
  // legitimately see a different number of events while agreeing about each one.
  // "No event nearby" alone cannot distinguish "there is none" from "you have
  // not loaded enough to know", and the second reads as a bug.
  const searched = `searched ${event.tilesSearched} tile${event.tilesSearched === 1 ? "" : "s"}`;

  const nearest = event.picks[0];
  if (nearest === undefined) return `No quest nearby · ${searched}`;

  // THE TILE COUNT IS GONE FROM THE SUCCESS PATH (F4e), and kept above.
  //
  // The owner called it noise, and on success it is: there is a marker on the
  // map, which answers the question the count was helping with. In the EMPTY
  // case it is the only thing distinguishing "there is none here" from "you
  // have not loaded enough to know" (F57), and the second reads as a bug — so
  // that half stays exactly as it was.
  const metres = distanceMetres(user, nearest.position);
  const where = compassPoint(bearingDegrees(user, nearest.position));
  return `Quest at ${formatTime(event.eventTime)} · ${formatDistance(metres)} ${where}`;
}

/**
 * The button's label: one of two constants, and never a description.
 *
 * REWRITTEN 2026-08-19 (F4a). This used to be a pure function of
 * `(busy, position, event)` that returned the whole description — which is
 * exactly why the button grew from "Next geo-event" to "Event at 14:15 ·
 * 640 m NE · searched 7 tiles" and back on every press, the resizing the
 * owner reported.
 *
 * The behaviour that paragraph used to describe — a distance that RE-READS
 * as the user walks — was F56's real win and is not gone: it moved to
 * {@link geoEventReadout}. This function keeps only the part that must not
 * change size.
 *
 * TWO constants and not one: `GEO_EVENT_BUSY_LABEL` is the in-progress state
 * root `CLAUDE.md`'s async-feedback rule requires, so collapsing to a single
 * string would delete the feedback rather than the resizing. They differ in
 * width, so the button also carries a `min-width` — a constant label on an
 * auto-width button is only half the fix.
 */
export function geoEventButtonLabel(busy: boolean): string {
  return busy ? GEO_EVENT_BUSY_LABEL : GEO_EVENT_IDLE_LABEL;
}

/**
 * The standing, compact readout beside the button.
 *
 * WHY THIS EXISTS AT ALL, and it is not in the original feedback. F56's
 * recorded win was that the label RE-READS AS THE USER WALKS — "640 m NE"
 * becoming "210 m NE" — because it is a pure function of the current position
 * rather than a string frozen when the search returned. Making the button
 * constant (F4a) deletes that, and neither of its replacements brings it back:
 * a toast fades, and a map pan does not restate anything. The milestone review
 * of the plan caught the loss; this is what preserves it.
 *
 * DISTANCE AND BEARING ONLY — no time, no tile count. Those do not change as
 * the user moves, so they belong in the transient message that announced the
 * result, not in a readout whose whole purpose is that it keeps changing.
 *
 * Empty string when there is no quest, so the caller can hide the element
 * rather than reserve space for nothing.
 */
export function geoEventReadout(view: {
  position: LatLng;
  geoEvent: GeoEvent | undefined;
}): string {
  const nearest = view.geoEvent?.picks[0];
  if (nearest === undefined) return "";
  const metres = distanceMetres(view.position, nearest.position);
  return `${formatDistance(metres)} ${compassPoint(bearingDegrees(view.position, nearest.position))}`;
}
