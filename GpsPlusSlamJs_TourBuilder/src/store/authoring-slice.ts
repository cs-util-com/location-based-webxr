/**
 * `authoring` slice — the tour DRAFT (authoring mode).
 *
 * Mirrors the `Tour` fields (minus a generated top-level `id`, added at export
 * by `selectExportedTour`). This slice is PERSISTED/recordable — authoring walks
 * replay deterministically (contract D12), mirroring the recorder's `refPoints`.
 * Asset BYTES never live here; the slice holds `AssetEntry` (id/type/filename)
 * only, bytes flow through the injected `AssetProvider` (contract §3).
 *
 * Invariants held at author time so the draft always exports a valid `Tour`:
 *   - model/sprite are mutually exclusive per waypoint (contract invariant 2):
 *     attaching one clears the other.
 *   - `removeAsset` also clears any waypoint slot referencing it, so no draft
 *     ever carries a dangling asset reference (contract invariant 1).
 *
 * @see plans/Shared-Contract.md §2.1 (AuthoringSliceState) + §2.3 + §4
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  AssetEntry,
  AssetId,
  TourCoord,
  Waypoint,
  WaypointContent,
} from "./types.js";

/** Asset-backed content slots (transcript is inline text, edited via updateWaypoint). */
export type AssetSlot = "model" | "sprite" | "audio";

/** Suggested radii written onto each new waypoint at drop time (contract §4). */
export const DEFAULT_PREFETCH_RADIUS_M = 25; // IDLE → PREFETCHING
export const DEFAULT_ACTIVE_RADIUS_M = 10; // PREFETCHING → ACTIVE

export interface AuthoringSliceState {
  readonly name: string;
  readonly description: string;
  readonly assets: readonly AssetEntry[];
  readonly waypoints: readonly Waypoint[];
  readonly breadcrumb: readonly TourCoord[];
}

const initialState: AuthoringSliceState = {
  name: "",
  description: "",
  assets: [],
  waypoints: [],
  breadcrumb: [],
};

/** Mutable per-waypoint fields an editor can change (id + slot wiring excluded). */
export interface WaypointChanges {
  readonly position?: TourCoord;
  readonly prefetchRadius?: number;
  readonly activeRadius?: number;
  readonly content?: Partial<WaypointContent>;
}

const authoringSlice = createSlice({
  name: "authoring",
  initialState,
  reducers: {
    setTourMeta(
      state,
      action: PayloadAction<{ name: string; description: string }>,
    ) {
      state.name = action.payload.name;
      state.description = action.payload.description;
    },

    addWaypoint(
      state,
      action: PayloadAction<{ id: string; position: TourCoord }>,
    ) {
      state.waypoints.push({
        id: action.payload.id,
        position: action.payload.position,
        prefetchRadius: DEFAULT_PREFETCH_RADIUS_M,
        activeRadius: DEFAULT_ACTIVE_RADIUS_M,
        content: {},
      });
    },

    updateWaypoint(
      state,
      action: PayloadAction<{ id: string; changes: WaypointChanges }>,
    ) {
      const wp = state.waypoints.find((w) => w.id === action.payload.id);
      if (!wp) return;
      const { position, prefetchRadius, activeRadius, content } =
        action.payload.changes;
      if (position !== undefined) wp.position = position;
      if (prefetchRadius !== undefined) wp.prefetchRadius = prefetchRadius;
      if (activeRadius !== undefined) wp.activeRadius = activeRadius;
      if (content !== undefined) wp.content = { ...wp.content, ...content };
    },

    removeWaypoint(state, action: PayloadAction<string>) {
      state.waypoints = state.waypoints.filter((w) => w.id !== action.payload);
    },

    /** Reorders the draft's own waypoint list — the numbering shown in the
     *  panel and on the map. Purely an authoring convenience: proximity
     *  activation is distance-based, never order-based (plan D3), so this
     *  never changes when a waypoint's content unlocks in the field. */
    moveWaypoint(
      state,
      action: PayloadAction<{ id: string; toIndex: number }>,
    ) {
      const fromIndex = state.waypoints.findIndex(
        (w) => w.id === action.payload.id,
      );
      if (fromIndex === -1) return;
      const clampedTo = Math.max(
        0,
        Math.min(action.payload.toIndex, state.waypoints.length - 1),
      );
      if (clampedTo === fromIndex) return;
      const [moved] = state.waypoints.splice(fromIndex, 1);
      state.waypoints.splice(clampedTo, 0, moved!);
    },

    attachAsset(
      state,
      action: PayloadAction<{
        waypointId: string;
        slot: AssetSlot;
        asset: AssetEntry;
      }>,
    ) {
      const { waypointId, slot, asset } = action.payload;
      const wp = state.waypoints.find((w) => w.id === waypointId);
      if (!wp) return;
      // Register in the central asset registry (dedup by id).
      if (!state.assets.some((a) => a.id === asset.id)) {
        state.assets.push(asset);
      }
      // Wire the waypoint slot; enforce model/sprite mutual exclusivity.
      const content = wp.content as {
        model?: AssetId;
        sprite?: AssetId;
        audio?: AssetId;
        transcript?: string;
      };
      content[slot] = asset.id;
      if (slot === "model") delete content.sprite;
      if (slot === "sprite") delete content.model;
    },

    removeAsset(state, action: PayloadAction<AssetId>) {
      const id = action.payload;
      state.assets = state.assets.filter((a) => a.id !== id);
      // Clear any dangling references so the draft stays exportable.
      for (const wp of state.waypoints) {
        const content = wp.content as {
          model?: AssetId;
          sprite?: AssetId;
          audio?: AssetId;
        };
        if (content.model === id) delete content.model;
        if (content.sprite === id) delete content.sprite;
        if (content.audio === id) delete content.audio;
      }
    },

    addBreadcrumbPoint(state, action: PayloadAction<TourCoord>) {
      state.breadcrumb.push(action.payload);
    },

    clearAuthoring() {
      return initialState;
    },
  },
});

export const {
  setTourMeta,
  addWaypoint,
  updateWaypoint,
  removeWaypoint,
  moveWaypoint,
  attachAsset,
  removeAsset,
  addBreadcrumbPoint,
  clearAuthoring,
} = authoringSlice.actions;
export const authoringReducer = authoringSlice.reducer;
