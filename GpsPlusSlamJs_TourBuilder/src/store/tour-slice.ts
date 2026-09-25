/**
 * `tour` slice — the loaded, immutable tour (viewing mode).
 *
 * Set once on load via `loadTour`, cleared via `clearTour`. The reducer does
 * NOT validate: the loader runs `validateTour` first and only dispatches
 * `loadTour` with an already-valid `Tour` (contract §2.3, decision #8).
 *
 * `clearTour` is the cross-slice reset signal — `tourProgress` and `zones`
 * listen for it and reset themselves (see their `extraReducers`).
 *
 * @see plans/Shared-Contract.md §2.1 (TourSliceState) + §2.3 (actions)
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Tour } from "./types.js";

export interface TourSliceState {
  readonly tour: Tour | null;
}

const initialState: TourSliceState = { tour: null };

const tourSlice = createSlice({
  name: "tour",
  initialState,
  reducers: {
    // Return new state (rather than mutating the Immer draft) so a deeply
    // `readonly` Tour drops in without fighting WritableDraft over its
    // `readonly` arrays.
    loadTour(_state, action: PayloadAction<Tour>): TourSliceState {
      return { tour: action.payload };
    },
    clearTour(): TourSliceState {
      return { tour: null };
    },
  },
});

export const { loadTour, clearTour } = tourSlice.actions;
export const tourReducer = tourSlice.reducer;
