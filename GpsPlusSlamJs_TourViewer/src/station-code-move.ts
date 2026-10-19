/**
 * A re-measured code takes whole stations with it (tour editor plan
 * 2026-10-17-1816, D17): when a code's saved position is IMPROVED, every
 * station whose ANCHOR is within the code's reach (about 40 m) and no
 * nearer to another of the tour's codes moves rigidly with it - the
 * station's geo pose by the code's correction (`move-with-code.ts`), its
 * items not at all. An item's local pose is relative to its station, so
 * it follows by construction; this logic never rewrites one. Pure.
 *
 * @see station-code-move.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { moveWithCode, takesAlong } from "./move-with-code.js";

export interface StationCodeMove {
  /** The code's saved pose before the improvement. */
  readonly from: QrGeoPose;
  /** Its improved pose. */
  readonly to: QrGeoPose;
  /** The tour's other codes (and known spots), as they were before: a
   *  station nearer one of them stays with it (the M4b tie rule). */
  readonly others: readonly QrGeoPose[];
  /** Stations another improved code already took along in this settle:
   *  left as they are (one code per station). */
  readonly claimed?: ReadonlySet<string>;
}

export interface StationsMoved {
  /** Every station, in order; an unmoved one is the very same object. */
  readonly stations: readonly TourStation[];
  /** The ids of the stations moved, in order. */
  readonly moved: readonly string[];
}

/**
 * `stations` with each station the improved code takes along moved
 * rigidly with it. A moved station keeps its id, story, radii and its
 * `items` array itself: only `geo` changes.
 */
export function moveStationsWithCode(
  stations: readonly TourStation[],
  move: StationCodeMove,
): StationsMoved {
  const moved: string[] = [];
  const out = stations.map((station) => {
    if (move.claimed?.has(station.id) === true) return station;
    if (!takesAlong(station.geo, move.from, move.others)) return station;
    moved.push(station.id);
    return { ...station, geo: moveWithCode(station.geo, move.from, move.to) };
  });
  return { stations: out, moved };
}
