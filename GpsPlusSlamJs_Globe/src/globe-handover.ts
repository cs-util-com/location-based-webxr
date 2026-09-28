/**
 * The pin's hand-over (round-2 plan 2026-09-26-2055 DEC-FB2-3, M3g): the
 * link that opens the OSM demo's city where the globe's dive ended, with
 * the camera as far out as the demo allows and, while the sun is up, the
 * globe's time. A quick cut, not the seamless descent (that is the globe
 * plan's phase 5).
 *
 * @see globe-handover.ts.md
 */

import type { LatLng } from "./globe-target.js";

/**
 * The OSM demo's side of the contract, written out (this package does not
 * depend on the demo):
 * - `maxCameraDistanceM`: `MAX_DISTANCE_M` in its `url-state.ts`; a `cdist`
 *   above it is refused, and the demo then opens its default view;
 * - `minSunElevationDeg`: `SUN_CLOCK.minElevationDeg` in its
 *   `sun-clock.ts`, civil twilight, below which its sky does not render
 *   reliably.
 */
export const OSM_HANDOVER = {
  maxCameraDistanceM: 4800,
  minSunElevationDeg: -6,
} as const;

/** The globe's instant as the OSM demo reads it (`?date=&time=`). */
export interface HandOverSun {
  /** The apparent solar date at the target's longitude. */
  readonly date: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
  /** Apparent solar time at the target, hours in [0, 24). */
  readonly solarHours: number;
  /** The sun's elevation at the target, degrees. */
  readonly elevationDeg: number;
}

/**
 * The OSM demo's address beside the lab. The lab is served at
 * `<root>labs/globe/` by the design system's dev server and at
 * `<root>lookdev/labs/globe/` on the site, and the demo is the site's
 * `<root>osm/`. Relative segments only: the deploy rewrites quoted
 * absolute route prefixes under `/lookdev/` (build-lookdev's rebase), which
 * would send the link to the demo's source files. A page served anywhere
 * else falls back to the origin's city.
 */
export function osmDemoBase(pageHref: string): string {
  const url = new URL(pageHref);
  const marker = "labs/globe/";
  const at = url.pathname.lastIndexOf(`/${marker}`);
  let root = at < 0 ? "/" : url.pathname.slice(0, at + 1);
  if (root.endsWith("/lookdev/")) root = root.slice(0, -"lookdev/".length);
  return new URL(`${root}osm/`, url.origin).href;
}

/** Five decimals (about a metre), signed zero folded, as the demo writes. */
const coordinate = (value: number): string => (value + 0).toFixed(5);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * "HH:MM" from hours, the way the demo prints its clock: floored, with a
 * hair of tolerance so an instant booted at a minute reads that minute.
 */
function solarClock(hours: number): string {
  const total = Math.floor(hours * 60 + 1e-6) % (24 * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * The hand-over link: the demo at `target` (`lat`/`lng` move the user,
 * `clat`/`clng`/`cdist` the camera, at its farthest), and the globe's time
 * as `date`/`time` when `sun` is given and at or above civil twilight.
 * Without a time the demo boots at its own afternoon sun: the jump in the
 * light is part of the cut.
 *
 * RangeError for a target that is not a latitude and longitude.
 */
export function handOverUrl(input: {
  readonly pageHref: string;
  readonly target: LatLng;
  readonly sun?: HandOverSun | null;
}): string {
  const { lat, lng } = input.target;
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
    throw new RangeError(
      `target must be a latitude and longitude, got ${lat}, ${lng}`,
    );
  }
  const url = new URL(osmDemoBase(input.pageHref));
  const q = url.searchParams;
  q.set("lat", coordinate(lat));
  q.set("lng", coordinate(lng));
  q.set("clat", coordinate(lat));
  q.set("clng", coordinate(lng));
  q.set("cdist", String(OSM_HANDOVER.maxCameraDistanceM));
  const sun = input.sun;
  if (sun && sun.elevationDeg >= OSM_HANDOVER.minSunElevationDeg) {
    const { year, month, day } = sun.date;
    q.set("date", `${year}-${pad2(month)}-${pad2(day)}`);
    q.set("time", solarClock(sun.solarHours));
  }
  // Kept readable, as the lab's own hash is: "11:30", not "11%3A30".
  return url.href.replaceAll("%3A", ":");
}
