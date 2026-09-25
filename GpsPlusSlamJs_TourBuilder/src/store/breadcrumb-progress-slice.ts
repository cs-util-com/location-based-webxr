/**
 * `breadcrumbProgress` slice — which breadcrumbs the visitor has passed.
 *
 * NOT persisted (design plan BW5) — unlike `tourProgress`, re-showing a
 * couple of already-passed breadcrumbs after a reload is cosmetic, not a
 * real loss. `markBreadcrumbVisited` is idempotent so the orchestrator's
 * per-tick check can re-fire safely. Resets on `clearTour`.
 *
 * @see plans/2026-09-17-breadcrumb-wayfinding-plan.md (BW3, BW5)
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clearTour } from "./tour-slice.js";

export interface BreadcrumbProgressSliceState {
  readonly visitedIndices: readonly number[];
}

const initialState: BreadcrumbProgressSliceState = { visitedIndices: [] };

const breadcrumbProgressSlice = createSlice({
  name: "breadcrumbProgress",
  initialState,
  reducers: {
    markBreadcrumbVisited(state, action: PayloadAction<number>) {
      if (!state.visitedIndices.includes(action.payload)) {
        state.visitedIndices.push(action.payload);
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(clearTour, (state) => {
      state.visitedIndices = [];
    });
  },
});

export const { markBreadcrumbVisited } = breadcrumbProgressSlice.actions;
export const breadcrumbProgressReducer = breadcrumbProgressSlice.reducer;
