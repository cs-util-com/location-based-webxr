/**
 * Waypoint → map-marker view-model mapping — the pure heart of component 7
 * (TASK.md §2.3 "2D map overview"). Turns the store's waypoint list, visited
 * ids, and next-unvisited id into the marker status the view layer draws.
 *
 * Pure, framework-free: no Leaflet, no DOM, no THREE. Same inputs → same
 * output.
 *
 * `next` is a **visual hint only**, not a gate — component 4 (proximity)
 * activates any waypoint by distance regardless of order, since waypoint
 * order is not enforced (plan: 2026-07-31-map-plan.md, decision 3).
 *
 * @see plans/2026-07-31-map-plan.md
 * @see plans/Shared-Contract.md
 */

import type { Waypoint } from "../../../store/types.js";

export type WaypointMarkerStatus = "visited" | "next" | "unvisited";

export interface WaypointMarkerViewModel {
  readonly id: string;
  readonly position: Waypoint["position"];
  readonly status: WaypointMarkerStatus;
  /** 1-based position in the draft's own waypoint list — an authoring
   *  convenience only (contract D3: proximity activation is distance-based,
   *  never order-based), so a Viewing-mode marker never needs it. */
  readonly order: number;
}

/** Pure. Same inputs → same output. Preserves the input waypoint order. */
export function computeMarkerViewModels(
  waypoints: readonly Waypoint[],
  visitedIds: readonly string[],
  nextId: string | null,
): readonly WaypointMarkerViewModel[] {
  const visited = new Set(visitedIds);
  return waypoints.map((wp, index) => ({
    id: wp.id,
    position: wp.position,
    status: visited.has(wp.id)
      ? "visited"
      : wp.id === nextId
        ? "next"
        : "unvisited",
    order: index + 1,
  }));
}
