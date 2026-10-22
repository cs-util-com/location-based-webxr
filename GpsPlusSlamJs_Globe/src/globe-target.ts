/**
 * Where the globe turns to (globe plan 2026-09-26-0539 §7.5): a target from
 * the URL, from a GPS fix, or a fallback once the wait for a fix has run
 * out. Phase 1 has no GPS (DEC-PRG-10), so the lab passes `fix: null`.
 *
 * @see globe-target.ts.md
 */

/** A WGS84 latitude and longitude, in degrees. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * OsmDemo's opening frame, Central Park (owner decision, globe plan §9).
 * Phase 5 injects OsmDemo's own start position and this literal goes.
 */
export const GLOBE_FALLBACK_TARGET: LatLng = Object.freeze({
  lat: 40.7677,
  lng: -73.9807,
});

/** A plain decimal number: no hex, no `Infinity`, no empty string. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * One `"lat,lng"` token in degrees, or `undefined` when the text is absent
 * or malformed in any way. Absent is the only failure: `Number("")` is 0,
 * the trap `start-position.ts` documents, and a camera sent to (0, 0) by a
 * blank field would look like a working page.
 */
export function parseLatLngText(text: string | null): LatLng | undefined {
  if (text === null) return undefined;
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length !== 2) return undefined;
  const [latText, lngText] = parts as [string, string];
  if (!DECIMAL.test(latText) || !DECIMAL.test(lngText)) return undefined;
  // `+ 0` folds -0 into 0, so equal texts give equal targets.
  const lat = Number(latText) + 0;
  const lng = Number(lngText) + 0;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** A camera pose a link can carry (`view=`): where, how high, which way. */
export interface GlobeView {
  readonly lat: number;
  readonly lng: number;
  /** Above the ellipsoid, km. */
  readonly altitudeKm: number;
  /** From north toward east, degrees in [0, 360). */
  readonly headingDeg: number;
  /** Above the local horizontal, degrees in [-90, 90]. */
  readonly pitchDeg: number;
}

/** The highest altitude a view may name (km): the lab's own zoom-out limit. */
const VIEW_MAX_ALTITUDE_KM = 50_000;

/**
 * One `"lat,lng,altitudeKm,headingDeg,pitchDeg"` token (the pose a Debug
 * export carries, volume-cloud plan §16), or `undefined` when absent or malformed in
 * any way, as `parseLatLngText`: a pose that cannot be read never moves the
 * camera. The heading is wrapped into [0, 360); the latitude must be in
 * [-90, 90], the longitude in [-180, 180], the altitude above 0 and at most
 * 50,000 km, the pitch in [-90, 90].
 */
export function parseViewText(text: string | null): GlobeView | undefined {
  if (text === null) return undefined;
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length !== 5 || !parts.every((p) => DECIMAL.test(p))) {
    return undefined;
  }
  const [lat, lng, altitudeKm, heading, pitchDeg] = parts.map(
    (p) => Number(p) + 0,
  ) as [number, number, number, number, number];
  if (![lat, lng, altitudeKm, heading, pitchDeg].every(Number.isFinite)) {
    return undefined;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || Math.abs(pitchDeg) > 90) {
    return undefined;
  }
  if (!(altitudeKm > 0 && altitudeKm <= VIEW_MAX_ALTITUDE_KM)) return undefined;
  const headingDeg = (((heading % 360) + 360) % 360) + 0;
  return { lat, lng, altitudeKm, headingDeg, pitchDeg };
}

/**
 * A view as its link token: the place to 5 decimals (about a metre), the
 * altitude to the metre, the angles to 0.1 degree. `parseViewText` reads it
 * back within that precision.
 */
export function formatViewText(view: GlobeView): string {
  const heading = ((view.headingDeg % 360) + 360) % 360;
  return [
    view.lat.toFixed(5),
    view.lng.toFixed(5),
    view.altitudeKm.toFixed(3),
    heading.toFixed(1),
    view.pitchDeg.toFixed(1),
  ].join(",");
}

/** Where the chosen target came from; `waiting` means there is none yet. */
export type GlobeTargetSource = "url" | "fix" | "fallback" | "waiting";

/**
 * The target, by precedence: the URL, then the fix, then the fallback, but
 * the fallback only once `fixWaitExpired`; before that the answer is
 * `waiting` and the globe keeps spinning.
 */
export function chooseGlobeTarget(input: {
  url: LatLng | undefined;
  fix: LatLng | null;
  fallback: LatLng;
  fixWaitExpired: boolean;
}): { target: LatLng | null; source: GlobeTargetSource } {
  if (input.url) return { target: input.url, source: "url" };
  if (input.fix) return { target: input.fix, source: "fix" };
  if (input.fixWaitExpired) {
    return { target: input.fallback, source: "fallback" };
  }
  return { target: null, source: "waiting" };
}
