/**
 * The automatic-station rule (tour editor plan 2026-10-17-1816, W3, D20,
 * D21): which station a new element (a pin, a photo, later a model)
 * belongs to. A version 3 tour has no loose items: each
 * lives in a station, its pose relative to the station's anchor.
 *
 * - A station's ANCHOR is fixed at its first element and is never
 *   re-centred by code. A centre of mass was rejected (D20): each new
 *   element would move it, and every earlier item's pose with it.
 * - A new element joins the NEAREST station whose anchor is within R
 *   (horizontally; R itself counts as inside, a tie goes to the earlier
 *   station); otherwise it starts a new station anchored where it is.
 * - Elements are taken in the caller's order, so a chain along a path
 *   becomes a chain of stations. The order is part of the contract.
 * - An element may name its OWN station (`ownStationOf`): it joins the
 *   station of that id if one stands already, else it starts it, anchored
 *   where it is - even within R of another (the phone's "New station
 *   here", owner decision D8 of the editor round-2 plan; and an undo that
 *   brings back an object whose emptied station a save dropped). In
 *   order, like every element: an earlier element is never taken into a
 *   station a later one starts.
 *
 * Pure. One rule for every place a station is created: the phone's Finish
 * for the walk's photos and the AR placements (M5a), the AR station UI
 * (M5c) and the editor (M5b).
 *
 * @see station-assign.ts.md
 */

import { horizontalM } from "./move-with-code.js";

/**
 * R: the most a station's elements are from its anchor, horizontally.
 * PROVISIONAL until measured: the plan measures R over 15-40 m on recorded
 * walks (the error at a station's edge - heading error times the distance
 * from the anchor, plus tracking drift between placements - against the
 * station's size). 25 m is the plan's default (D20).
 */
export const STATION_RADIUS_M = 25;

/** A geographic point with an absolute altitude (m). */
export interface StationPoint {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

/** A station as the rule reads it: its id and its fixed anchor. */
export interface StationSeat {
  readonly id: string;
  readonly anchor: StationPoint;
}

function checkRadius(radiusM: number): void {
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new RangeError(
      `station-assign: the radius must be a positive number of metres, got ${String(radiusM)}`,
    );
  }
}

/** The nearest station whose anchor is within `radiusM` of `at`
 *  (horizontally, inclusive; a tie goes to the earlier one), else null. */
export function nearestStationWithin(
  stations: readonly StationSeat[],
  at: { readonly lat: number; readonly lon: number },
  radiusM: number = STATION_RADIUS_M,
): string | null {
  checkRadius(radiusM);
  let best: { id: string; d: number } | null = null;
  for (const station of stations) {
    const d = horizontalM(station.anchor, at);
    if (d <= radiusM && (best === null || d < best.d)) {
      best = { id: station.id, d };
    }
  }
  return best?.id ?? null;
}

/** A station as the per-station rule reads it: its id, its anchor and its
 *  own found radius (m), which the creator may have changed. */
export interface HoldingStation {
  readonly id: string;
  readonly geo: { readonly lat: number; readonly lon: number };
  readonly foundRadiusM: number;
}

/**
 * The station that holds `at`: the nearest whose anchor is within ITS OWN
 * `foundRadiusM` (horizontally, inclusive; a tie goes to the earlier
 * station), else null. The rule every placement and move of a tour runs
 * (the tour document's `placed` and `moved`): a station's own radius
 * decides, so a radius set in the editor is
 * respected. A radius that is not a positive finite number holds nothing
 * (a broken hand-edited file must not swallow every object).
 */
export function stationHolding(
  stations: readonly HoldingStation[],
  at: { readonly lat: number; readonly lon: number },
): string | null {
  let best: { id: string; d: number } | null = null;
  for (const station of stations) {
    const r = station.foundRadiusM;
    if (!Number.isFinite(r) || r <= 0) continue;
    const d = horizontalM(station.geo, at);
    if (d <= r && (best === null || d < best.d)) {
      best = { id: station.id, d };
    }
  }
  return best?.id ?? null;
}

/**
 * Assign `elements`, in order, to `stations` and to the new stations the
 * rule starts. The given stations come back first, as they are (the same
 * objects, in their order); new ones follow in the order they started.
 *
 * @throws RangeError for a radius that is not a positive finite number;
 *   Error for a new station id that is already taken (two stations under
 *   one id would merge their items).
 */
export function assignToStations<T>(input: {
  readonly stations: readonly StationSeat[];
  readonly elements: readonly T[];
  readonly positionOf: (element: T) => StationPoint;
  readonly newStationId: () => string;
  /** The station `element` (at `index`) is to be in, whatever the rule
   *  would say; undefined for the rule's own choice. */
  readonly ownStationOf?: (element: T, index: number) => string | undefined;
  readonly radiusM?: number;
}): { stations: StationSeat[]; stationOf: string[] } {
  const radiusM = input.radiusM ?? STATION_RADIUS_M;
  checkRadius(radiusM);
  const stations = [...input.stations];
  const taken = new Set(stations.map((s) => s.id));
  /** The ids this call minted: an element's own station must not be one
   *  (two stations under one id would merge their items). */
  const minted = new Set<string>();
  function start(id: string, at: StationPoint): string {
    taken.add(id);
    stations.push({ id, anchor: { lat: at.lat, lon: at.lon, alt: at.alt } });
    return id;
  }
  const stationOf = input.elements.map((element, index) => {
    const at = input.positionOf(element);
    const own = input.ownStationOf?.(element, index);
    if (own !== undefined) {
      if (minted.has(own)) {
        throw new Error(
          `station-assign: the station id "${own}" was minted for another station`,
        );
      }
      return taken.has(own) ? own : start(own, at);
    }
    const joined = nearestStationWithin(stations, at, radiusM);
    if (joined !== null) return joined;
    const id = input.newStationId();
    if (taken.has(id)) {
      throw new Error(`station-assign: the new station id "${id}" is taken`);
    }
    minted.add(id);
    return start(id, at);
  });
  return { stations, stationOf };
}
