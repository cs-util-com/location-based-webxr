/**
 * The 3D editor's Add pin and Add long text, as data (pure): where a new
 * item goes in its station - inside the circle, clear of the items already
 * there - and the item itself, named by its number, standing on the ground
 * where that has loaded and seated in the station it was added to.
 *
 * @see new-pin.ts.md
 */
import type {
  TourPin,
  TourReadingSign,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { worldBlocks } from "../tour-document.js";

/** How far a new pin keeps from every item of its station (m). */
const CLEAR_M = 2.2;

/** The rings (m from the anchor) and the places on each a new pin tries,
 *  nearest first; each ring stays inside the station's circle. */
const RINGS_M = [4, 6, 8, 10] as const;
const PER_RING = 12;

/**
 * Where a new pin goes in `station`'s frame (metres north and east of its
 * anchor): the first place on rings of 4 to 10 m (each within the found
 * radius), starting due north and going round, that keeps `CLEAR_M` from
 * every item; with none free, 4 m north (or the radius, if smaller).
 */
export function freePinSpot(station: TourStation): {
  northM: number;
  eastM: number;
} {
  const radius = Math.max(0, station.foundRadiusM);
  const taken = worldBlocks(station).map((i) => ({
    north: i.pose.position[0],
    east: i.pose.position[2],
  }));
  for (const ring of RINGS_M) {
    const r = Math.min(ring, radius);
    for (let k = 0; k < PER_RING; k += 1) {
      const a = (k / PER_RING) * 2 * Math.PI;
      const spot = { northM: Math.cos(a) * r, eastM: Math.sin(a) * r };
      const clear = taken.every(
        (t) => Math.hypot(t.north - spot.northM, t.east - spot.eastM) > CLEAR_M,
      );
      if (clear) return spot;
    }
  }
  return { northM: Math.min(RINGS_M[0], radius), eastM: 0 };
}

/** What a new item is made from: its station, its id, when it is made
 *  and the ground's height at a place (null: not loaded there). */
export interface NewItemInput {
  readonly station: TourStation;
  readonly id: string;
  readonly nowIso: string;
  readonly groundAt: (place: {
    readonly lat: number;
    readonly lon: number;
  }) => number | null;
}

/** A new item's geo pose: the station's free spot, on the ground there
 *  (the anchor's height where none has loaded). */
function freeGeo(input: NewItemInput): TourPin["geo"] {
  const { station } = input;
  const spot = freePinSpot(station);
  const geo = itemGeoPose(
    { position: [spot.northM, 0, spot.eastM], rotation: [0, 0, 0, 1] },
    station.geo,
  );
  const ground = input.groundAt({ lat: geo.lat, lon: geo.lon });
  return {
    ...geo,
    alt: ground !== null && Number.isFinite(ground) ? ground : geo.alt,
  };
}

/** One more than how many items of `kind` the station holds. */
function nextNumber(station: TourStation, kind: string): string {
  return String(worldBlocks(station).filter((i) => i.kind === kind).length + 1);
}

/**
 * A new pin of `station` (its id `id`, made at `nowIso`) at its free spot,
 * on the ground there by `groundAt` (the anchor's height where none has
 * loaded), named "New pin n" with n one more than the station's pins.
 */
export function newPin(input: NewItemInput): TourPin {
  return {
    id: input.id,
    kind: "shortText",
    view: "pin",
    caption: `New pin ${nextNumber(input.station, "shortText")}`,
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
}

/** The body a new long text starts with: the format requires one. */
export const NEW_LONG_TEXT_BODY = "Write the text here.";

/**
 * A new long text of `station`, as `newPin` makes a pin: a reading sign
 * (the short sign that opens the whole text on a tap) at the free spot,
 * titled "New long text n", its body `NEW_LONG_TEXT_BODY`.
 */
export function newLongText(input: NewItemInput): TourReadingSign {
  return {
    id: input.id,
    kind: "longText",
    view: "reading",
    title: `New long text ${nextNumber(input.station, "longText")}`,
    body: NEW_LONG_TEXT_BODY,
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
}
