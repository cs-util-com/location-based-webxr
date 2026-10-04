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
