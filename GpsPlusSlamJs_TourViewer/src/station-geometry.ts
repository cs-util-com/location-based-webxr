/**
 * The geometry of a station and its items as the editor changes them:
 * the bounds of a found radius and the preload radius it implies, where a
 * copy of a station or an item stands, the height rule, and a station's
 * rigid move. Pure, and at the top level of `src/` so the tour document's
 * reducers may use it (they never import `src/editor/`).
 *
 * Heights: the file holds ellipsoidal altitudes (the creator's GPS-world
 * Up). An item moved over other ground keeps its height ABOVE the ground,
 * unless the creator lifts it; "put on the ground" sets the altitude to the
 * ground's. A station moves rigidly: its items keep their local poses.
 *
 * @see station-geometry.ts.md
 */

import {
  offsetGeo,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  itemGeoPose,
  localPoseOf,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";

/** The smallest found radius a creator may set (m), inclusive. */
export const STATION_RADIUS_MIN_M = 2;
/** The largest found radius a creator may set (m), inclusive. */
export const STATION_RADIUS_MAX_M = 300;

/** How far east of its original an item's copy stands (m). */
export const ITEM_DUPLICATE_OFFSET_M = 1.5;

/** How far a station's copy stands beyond the original's preload ring,
 *  east (m): the copy's circle never overlaps the original's. */
const STATION_DUPLICATE_GAP_M = 5;

/** Whether `m` is a found radius a creator may set: a finite number from
 *  {@link STATION_RADIUS_MIN_M} to {@link STATION_RADIUS_MAX_M}. */
export function isStationRadius(m: number): boolean {
  return (
    Number.isFinite(m) && m >= STATION_RADIUS_MIN_M && m <= STATION_RADIUS_MAX_M
  );
}

/** The radius from which a station is preloaded and guided to: twice its
 *  found radius, so a visitor is told of it before reaching its edge. */
export function preloadRadiusM(foundRadiusM: number): number {
  return 2 * foundRadiusM;
}

/** `geo` moved `metres` east, at its own height and facing. */
function eastOf(geo: QrGeoPose, metres: number): QrGeoPose {
  const moved = offsetGeo(geo, { east: metres, north: 0, up: 0 });
  return { ...geo, lat: moved.latitude, lon: moved.longitude };
}

/** Where a copy of a station stands: twice its found radius plus 5 m east
 *  of it (clear of its preload ring), at its height, turned like it. */
export function duplicateStationGeo(frame: {
  readonly geo: QrGeoPose;
  readonly foundRadiusM: number;
}): QrGeoPose {
  return eastOf(
    frame.geo,
    preloadRadiusM(frame.foundRadiusM) + STATION_DUPLICATE_GAP_M,
  );
}

/** Where a copy of an item stands: {@link ITEM_DUPLICATE_OFFSET_M} east
 *  of it, at its height and facing. */
export function duplicateItemGeo(geo: QrGeoPose): QrGeoPose {
  return eastOf(geo, ITEM_DUPLICATE_OFFSET_M);
}

/** The altitude that keeps an item's height above the ground when the
 *  ground under it goes from `groundBefore` to `groundAfter` (all
 *  ellipsoidal metres). */
export function altKeepingHeight(input: {
  readonly alt: number;
  readonly groundBefore: number;
  readonly groundAfter: number;
}): number {
  return input.alt - input.groundBefore + input.groundAfter;
}

/** Where an item at `geo` in the station at `from` stands once the
 *  station moved to `to`: its local pose kept (a rigid move). */
export function rigidlyMoved(
  geo: QrGeoPose,
  from: QrGeoPose,
  to: QrGeoPose,
): QrGeoPose {
  return itemGeoPose(localPoseOf(geo, from), to);
}
