/**
 * The debug layer's page state (`debugLayer`): whether "Show debug data"
 * is on, whose walk the layer shows (the tour's own, or debug data added
 * beside it) and the camera captures it drew, each by its picture's entry
 * name and its place. The map and the 3D view on the globe both draw from
 * it, so the two views never keep two copies that mean different things.
 *
 * Debug data, never the tour: no history, no draft, no save reads it. The
 * thumbnails are decoded pictures (blob URLs), so they stay out of the
 * store, in the page's side table keyed by the same entry names
 * (`debug-thumbs.ts`).
 *
 * @see debug-layer-slice.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Whose walk the layer shows: the tour file's own, or debug data added
 *  beside the tour ("Add debug data…"). */
type DebugLayerSource = "walk" | "added";

/** A camera capture as the layer drew it: its picture's entry name (the
 *  capture's id) and its place (degrees, metres over the ellipsoid). */
export interface DebugPlace {
  readonly image: string;
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

export interface DebugLayerState {
  /** "Show debug data": on for every layer that starts. */
  readonly shown: boolean;
  /** Null while no layer runs. */
  readonly source: DebugLayerSource | null;
  /** The captures drawn, in capture order; null until the layer drew
   *  (and while none runs). */
  readonly captures: readonly DebugPlace[] | null;
}

export const initialDebugLayerState: DebugLayerState = {
  shown: true,
  source: null,
  captures: null,
};

/** The captures a drawing may keep: a name and a finite place each, the
 *  first of any name drawn twice (a thumbnail is keyed by its name). */
export function debugPlacesOf(
  captures: readonly {
    readonly image: unknown;
    readonly lat: unknown;
    readonly lon: unknown;
    readonly alt: unknown;
  }[],
): DebugPlace[] {
  const seen = new Set<string>();
  const kept: DebugPlace[] = [];
  for (const c of captures) {
    const { image, lat, lon, alt } = c;
    if (typeof image !== "string" || image === "" || seen.has(image)) continue;
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      typeof alt !== "number" ||
      ![lat, lon, alt].every(Number.isFinite) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      continue;
    }
    seen.add(image);
    kept.push({ image, lat, lon, alt });
  }
  return kept;
}

const debugLayerSlice = createSlice({
  name: "debugLayer",
  initialState: initialDebugLayerState,
  reducers: {
    /** A layer starts for `source`: shown, nothing drawn yet. */
    started(
      state,
      action: PayloadAction<{ readonly source: DebugLayerSource }>,
    ) {
      const { source } = action.payload;
      if (source !== "walk" && source !== "added") return;
      state.shown = true;
      state.source = source;
      state.captures = null;
    },
    /** The layer drew its captures (replacing any drawn before); ignored
     *  while no layer runs. */
    drawn(
      state,
      action: PayloadAction<{
        readonly captures: readonly {
          readonly image: string;
          readonly lat: number;
          readonly lon: number;
          readonly alt: number;
        }[];
      }>,
    ) {
      if (state.source === null) return;
      state.captures = debugPlacesOf(action.payload.captures);
    },
    /** "Show debug data" switched. */
    shownChanged(state, action: PayloadAction<{ readonly on: boolean }>) {
      state.shown = action.payload.on === true;
    },
    /** The layer stopped (the tour closed, another source replaced it):
     *  nothing drawn, no source. The switch keeps its state until the
     *  next start. */
    cleared(state) {
      state.source = null;
      state.captures = null;
    },
  },
});

export const debugLayerActions = debugLayerSlice.actions;
export const debugLayerReducer = debugLayerSlice.reducer;

/** The slice in a store's state. */
export function selectDebugLayer(root: {
  readonly debugLayer: DebugLayerState;
}): DebugLayerState {
  return root.debugLayer;
}
