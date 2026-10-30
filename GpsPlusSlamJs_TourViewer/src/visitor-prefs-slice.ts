/**
 * The visitor's view preference in the page's store (station blocks
 * design §4 "Where"): the value stored on the device under
 * `tour-viewer.visitor.prefs.v1`, as read at the page's start, and every
 * choice made since. The page mirrors it back to `localStorage`
 * (`saveVisitorPrefs`); when that throws, the store still holds the
 * choice, so it lasts the visit.
 *
 * Not recorded: no `visitorPrefs/*` action is among the page's persisted
 * prefixes (`tour-viewer-session.ts`), and no tour change resets it.
 *
 * @see visitor-prefs-slice.ts.md
 */

import { createSlice, current, type PayloadAction } from "@reduxjs/toolkit";

import { withPreferredView, type ViewPlacement } from "./visitor-prefs.js";

export interface VisitorPrefsState {
  /** The stored value as JSON parsed it (any shape: it is read
   *  defensively, `preferredView`), or null for none. */
  readonly stored: unknown;
}

const initialVisitorPrefsState: VisitorPrefsState = { stored: null };

const visitorPrefsSlice = createSlice({
  name: "visitorPrefs",
  initialState: initialVisitorPrefsState,
  reducers: {
    /** The value read from the device at the page's start. */
    visitorPrefsLoaded(_state, action: PayloadAction<unknown>) {
      return { stored: action.payload };
    },
    /** A visitor's choice for a kind at a placement; null clears it
     *  ("Use the creator's choice again"). */
    visitorViewChosen(
      state,
      action: PayloadAction<{
        readonly kind: string;
        readonly placement: ViewPlacement;
        readonly view: string | null;
      }>,
    ) {
      const { kind, placement, view } = action.payload;
      return {
        stored: withPreferredView(current(state).stored, kind, placement, view),
      };
    },
  },
});

export const visitorPrefsReducer = visitorPrefsSlice.reducer;
export const { visitorPrefsLoaded, visitorViewChosen } =
  visitorPrefsSlice.actions;

/** The stored value (any shape; read it through `preferredView`). */
export function selectVisitorPrefs(state: {
  readonly visitorPrefs: VisitorPrefsState;
}): unknown {
  return state.visitorPrefs.stored;
}
