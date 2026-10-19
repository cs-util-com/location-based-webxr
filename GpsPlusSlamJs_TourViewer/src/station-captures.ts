/**
 * Which station a walk photo or the ring around a code goes with, for the
 * visitor (visitor plan 2026-10-18-2349 M2): the station whose
 * presence shows it (`station-content.ts`).
 *
 * - **A baked walk photo** keeps the station the creator's Finish gave it
 *   (`TourCapture.station`): the bake already ran the rule.
 * - **A photo joined live** (a tour never finished since its photo spots
 *   were baked) gets the rule the Finish runs (`assignToStations`, R =
 *   `STATION_RADIUS_M`): the nearest station within R, against the tour's
 *   own stations. One the rule would start a NEW station for has no station
 *   to follow: it comes back `loose`, and the caller shows it always, as
 *   every photo was shown before (the station a Finish would create does
 *   not exist in this tour, so no presence can be judged for it).
 * - **The ring around a code** (a tour without a walk) goes with the
 *   station nearest the code within the same R; a code beyond every
 *   station's R has none, and its ring stands always, as a loose photo
 *   does (a visitor at that code would otherwise see nothing after the
 *   lock).
 *
 * Pure.
 *
 * @see station-captures.ts.md
 */

import {
  assignToStations,
  nearestStationWithin,
  STATION_RADIUS_M,
  type StationPoint,
} from "./station-assign.js";

/** A station as these rules read it: its id and its spot. */
export interface StationSpot {
  readonly id: string;
  readonly geo: StationPoint;
}

/** What a capture must carry: its spot, and the station a bake gave it. */
export interface CaptureSpot {
  readonly geo: StationPoint;
  readonly station?: string;
}

/**
 * `captures`, in their order, grouped by the station each goes with; the
 * ones no station takes are `loose`.
 */
export function capturesByStation<T extends CaptureSpot>(
  captures: readonly T[],
  stations: readonly StationSpot[],
): { byStation: Map<string, T[]>; loose: T[] } {
  const known = new Set(stations.map((s) => s.id));
  let minted = 0;
  const { stationOf } = assignToStations({
    stations: stations.map((s) => ({ id: s.id, anchor: s.geo })),
    elements: captures,
    positionOf: (c) => c.geo,
    // A bake's choice stands; a station the tour lacks is the rule's call.
    ownStationOf: (c) =>
      c.station !== undefined && known.has(c.station) ? c.station : undefined,
    newStationId: () => {
      minted += 1;
      // Never a tour id: a tour's station ids are path-safe ids without ":".
      return `loose:${String(minted)}`;
    },
  });
  const byStation = new Map<string, T[]>();
  const loose: T[] = [];
  captures.forEach((c, i) => {
    const id = stationOf[i]!;
    if (!known.has(id)) {
      loose.push(c);
      return;
    }
    const list = byStation.get(id);
    if (list === undefined) byStation.set(id, [c]);
    else list.push(c);
  });
  return { byStation, loose };
}

/** The station nearest `at` within `STATION_RADIUS_M` horizontally
 *  (inclusive; the earlier one on a tie), else null: the rule a live walk
 *  photo gets, so the ring and the walk agree on what a station holds. */
export function nearestStationId(
  stations: readonly StationSpot[],
  at: { readonly lat: number; readonly lon: number },
): string | null {
  return nearestStationWithin(
    stations.map((s) => ({ id: s.id, anchor: s.geo })),
    at,
    STATION_RADIUS_M,
  );
}
