/**
 * `tourProgress` slice — which waypoints the visitor has completed.
 *
 * Kept SEPARATE from `tour` (contract decision a/Q7): progress churns, the
 * loaded tour does not. `markWaypointVisited` is idempotent so a proximity
 * driver can fire it repeatedly without growing the list. Resets to empty when
 * `clearTour` is dispatched (cross-slice `extraReducers`).
 *
 * @see plans/Shared-Contract.md §2.1 + §2.3
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clearTour } from "./tour-slice.js";

export interface TourProgressSliceState {
  readonly visitedWaypointIds: readonly string[];
}

const initialState: TourProgressSliceState = { visitedWaypointIds: [] };

const tourProgressSlice = createSlice({
  name: "tourProgress",
  initialState,
  reducers: {
    markWaypointVisited(state, action: PayloadAction<string>) {
      // Idempotent: a proximity driver may re-fire this every frame it is in
      // range. Only append the first time.
      if (!state.visitedWaypointIds.includes(action.payload)) {
        state.visitedWaypointIds.push(action.payload);
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(clearTour, (state) => {
      state.visitedWaypointIds = [];
    });
  },
});

export const { markWaypointVisited } = tourProgressSlice.actions;
export const tourProgressReducer = tourProgressSlice.reducer;
