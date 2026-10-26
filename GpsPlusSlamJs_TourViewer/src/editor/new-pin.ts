/**
 * The 3D inspector's Add pin, as data (pure): where a new pin goes in its
 * station - inside the circle, clear of the items already there - and the
 * pin itself, named by its number, standing on the ground where that has
 * loaded and seated in the station it was added to.
 *
 * @see new-pin.ts.md
 */
import type {
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

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
  const taken = station.items.map((i) => ({
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

/**
 * A new pin of `station` (its id `id`, made at `nowIso`) at its free spot,
 * on the ground there by `groundAt` (the anchor's height where none has
 * loaded), named "New pin n" with n one more than the station's pins.
 */
export function newPin(input: {
  readonly station: TourStation;
  readonly id: string;
  readonly nowIso: string;
  readonly groundAt: (place: {
    readonly lat: number;
    readonly lon: number;
  }) => number | null;
}): TourObject {
  const { station } = input;
  const spot = freePinSpot(station);
  const geo = itemGeoPose(
    { position: [spot.northM, 0, spot.eastM], rotation: [0, 0, 0, 1] },
    station.geo,
  );
  const ground = input.groundAt({ lat: geo.lat, lon: geo.lon });
  const pins = station.items.filter((i) => i.kind === "pin").length;
  return {
    id: input.id,
    kind: "pin",
    label: `New pin ${String(pins + 1)}`,
    createdAtIso: input.nowIso,
    geo: {
      ...geo,
      alt: ground !== null && Number.isFinite(ground) ? ground : geo.alt,
    },
    station: station.id,
  };
}
