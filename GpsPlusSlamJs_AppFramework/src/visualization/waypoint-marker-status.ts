/**
 * Waypoint → map-marker view-model mapping. Turns a list of waypoints, the
 * ids already visited, and the "next" hint id into per-marker display status
 * ("visited" | "next" | "unvisited") a map view can render directly.
 *
 * Pure, framework-free: no Leaflet, no DOM, no THREE. Same inputs → same
 * output.
 *
 * `nextId` is a **visual hint only**, not a gate — an app's own proximity
 * logic decides which waypoint activates, independent of marker order.
 */

/** Minimal position shape this module needs. */
export interface MapWaypointPosition {
  readonly lat: number;
  readonly lon: number;
  readonly altitude?: number;
}

/** Minimal waypoint shape this module needs — any object with at least these
 * two fields satisfies it structurally. */
export interface MapWaypointInput {
  readonly id: string;
  readonly position: MapWaypointPosition;
}

export type WaypointMarkerStatus = "visited" | "next" | "unvisited";

export interface WaypointMarkerViewModel {
  readonly id: string;
  readonly position: MapWaypointPosition;
  readonly status: WaypointMarkerStatus;
}

/** Pure. Same inputs → same output. Preserves the input waypoint order. */
export function computeMarkerViewModels(
  waypoints: readonly MapWaypointInput[],
  visitedIds: readonly string[],
  nextId: string | null,
): readonly WaypointMarkerViewModel[] {
  const visited = new Set(visitedIds);
  return waypoints.map((wp) => ({
    id: wp.id,
    position: wp.position,
    status: visited.has(wp.id)
      ? "visited"
      : wp.id === nextId
        ? "next"
        : "unvisited",
  }));
}
