/**
 * Store selectors — the single read surface for every component (3–10).
 *
 * SELECTOR CONTRACT: components that read store state MUST use these selectors;
 * a component needing a new read adds it HERE rather than selecting inline. This
 * keeps state-shape knowledge in one file so a slice refactor touches one place.
 *
 * Selectors are pure and framework-free (no THREE, no RTK) and are typed against
 * MINIMAL structural state shapes, not the concrete store type — the real
 * `ViewingRootState` / `AuthoringRootState` (which also carry the framework base
 * slices) are structurally assignable to these, so selectors work on the live
 * store while staying decoupled from the factory.
 *
 * @see plans/Shared-Contract.md §2.3
 */

import type { TourSliceState } from "./tour-slice.js";
import type { TourProgressSliceState } from "./tour-progress-slice.js";
import type { ZonesSliceState } from "./zones-slice.js";
import type { BreadcrumbProgressSliceState } from "./breadcrumb-progress-slice.js";
import type { AuthoringSliceState } from "./authoring-slice.js";
import type {
  AssetEntry,
  AssetId,
  Tour,
  Waypoint,
  ZoneState,
} from "./types.js";

/** Minimal shapes the selectors need — the concrete root states extend these. */
export interface ViewingStateShape {
  readonly tour: TourSliceState;
  readonly tourProgress: TourProgressSliceState;
  readonly zones: ZonesSliceState;
  readonly breadcrumbProgress: BreadcrumbProgressSliceState;
}
export interface AuthoringStateShape {
  readonly authoring: AuthoringSliceState;
}

// ── Viewing selectors (contract §2.3) ────────────────────────────────────────

export function selectTour(state: ViewingStateShape): Tour | null {
  return state.tour.tour;
}

export function selectOrderedWaypoints(
  state: ViewingStateShape,
): readonly Waypoint[] {
  return state.tour.tour?.waypoints ?? [];
}

export function selectVisitedWaypointIds(
  state: ViewingStateShape,
): readonly string[] {
  return state.tourProgress.visitedWaypointIds;
}

/** Distance-nearest breadcrumb progress (design plan BW3/BW5) — distinct
 *  from `selectVisitedWaypointIds`, which is tour-order over waypoints. */
export function selectVisitedBreadcrumbIndices(
  state: ViewingStateShape,
): readonly number[] {
  return state.breadcrumbProgress.visitedIndices;
}

export function selectNextUnvisitedWaypoint(
  state: ViewingStateShape,
): Waypoint | null {
  const visited = new Set(state.tourProgress.visitedWaypointIds);
  return selectOrderedWaypoints(state).find((w) => !visited.has(w.id)) ?? null;
}

export function selectTourProgress(state: ViewingStateShape): {
  visited: number;
  total: number;
} {
  const waypoints = selectOrderedWaypoints(state);
  const visited = new Set(state.tourProgress.visitedWaypointIds);
  // Count only visited ids that are real waypoints of the loaded tour, so a
  // stale id can never report progress > total.
  return {
    visited: waypoints.filter((w) => visited.has(w.id)).length,
    total: waypoints.length,
  };
}

export function selectWaypointZone(
  state: ViewingStateShape,
  id: string,
): ZoneState {
  return state.zones.byWaypointId[id] ?? "IDLE";
}

export function selectActiveWaypointIds(
  state: ViewingStateShape,
): readonly string[] {
  return Object.entries(state.zones.byWaypointId)
    .filter(([, zone]) => zone === "ACTIVE")
    .map(([id]) => id);
}

/**
 * Resolve a waypoint's at-most-one visual slot. Takes a `Waypoint` (not state)
 * — the caller already has it from `selectOrderedWaypoints`. `null` for a
 * content-less (breadcrumb-only) stop.
 */
export function selectWaypointVisual(
  wp: Waypoint,
): { kind: "model" | "sprite"; assetId: AssetId } | null {
  if (wp.content.model !== undefined) {
    return { kind: "model", assetId: wp.content.model };
  }
  if (wp.content.sprite !== undefined) {
    return { kind: "sprite", assetId: wp.content.sprite };
  }
  return null;
}

// ── Additive conveniences (back-ported to contract §2.3) ─────────────────────

export function selectAssets(state: ViewingStateShape): readonly AssetEntry[] {
  return state.tour.tour?.assets ?? [];
}

export function selectWaypointById(
  state: ViewingStateShape,
  id: string,
): Waypoint | undefined {
  return selectOrderedWaypoints(state).find((w) => w.id === id);
}

export function selectIsWaypointVisited(
  state: ViewingStateShape,
  id: string,
): boolean {
  return state.tourProgress.visitedWaypointIds.includes(id);
}

// ── Authoring selectors ──────────────────────────────────────────────────────

export function selectAuthoringWaypoints(
  state: AuthoringStateShape,
): readonly Waypoint[] {
  return state.authoring.waypoints;
}

export function selectAuthoringName(state: AuthoringStateShape): string {
  return state.authoring.name;
}

export function selectAuthoringDescription(state: AuthoringStateShape): string {
  return state.authoring.description;
}

/**
 * Bridge the authoring draft into a canonical, packageable `Tour` (contract
 * D12). Packaging (component 5) reads exactly this. A stable top-level `id` is
 * derived from the draft name (id generation is authoring's concern per the
 * contract's "open conventions"); the result is shaped to pass `validateTour`.
 */
export function selectExportedTour(state: AuthoringStateShape): Tour {
  const a = state.authoring;
  const slug =
    a.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "draft";
  return {
    id: `tour-${slug}`,
    name: a.name,
    description: a.description,
    assets: a.assets,
    waypoints: a.waypoints,
    breadcrumb: a.breadcrumb,
  };
}
