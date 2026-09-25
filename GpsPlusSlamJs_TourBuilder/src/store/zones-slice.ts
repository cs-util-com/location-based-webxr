/**
 * `zones` slice — per-waypoint proximity zone state (component 4's output).
 *
 * The proximity state machine (component 4) owns the TRANSITION logic; this
 * slice only stores the result. `initZones` seeds every waypoint to `IDLE` at
 * tour load; `setWaypointZone` updates a single entry (hysteresis-gated, so
 * rare — never frame-rate, contract §2.2). Resets on `clearTour`.
 *
 * @see plans/Shared-Contract.md §2.1 (ZonesSliceState) + §2.3 + D11
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clearTour } from "./tour-slice.js";
import type { ZoneState } from "./types.js";

export interface ZonesSliceState {
  readonly byWaypointId: Readonly<Record<string, ZoneState>>;
}

const initialState: ZonesSliceState = { byWaypointId: {} };

const zonesSlice = createSlice({
  name: "zones",
  initialState,
  reducers: {
    initZones(state, action: PayloadAction<readonly string[]>) {
      const next: Record<string, ZoneState> = {};
      for (const id of action.payload) next[id] = "IDLE";
      state.byWaypointId = next;
    },
    setWaypointZone(
      state,
      action: PayloadAction<{ id: string; zone: ZoneState }>,
    ) {
      state.byWaypointId[action.payload.id] = action.payload.zone;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(clearTour, (state) => {
      state.byWaypointId = {};
    });
  },
});

export const { initZones, setWaypointZone } = zonesSlice.actions;
export const zonesReducer = zonesSlice.reducer;
