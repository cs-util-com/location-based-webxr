/**
 * The visitor's view preference in the page's store (station blocks
 * design §4 "Where"): the value stored on the device under
 * `tour-viewer.visitor.prefs.v1`, as read at the page's start, and every
 * choice made since. The page merges each choice into a fresh read of
 * the device and writes it there (`storeVisitorChoice`), then hands the
 * merged value to the store (`visitorPrefsLoaded`); when the write is
 * refused, the store still holds the choice, so it lasts the visit.
 *
 * Not recorded: no `visitorPrefs/*` action is among the page's persisted
 * prefixes (`tour-viewer-session.ts`), and no tour change resets it.
 *
 * @see visitor-prefs-slice.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

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
    /** The value read from the device: at the page's start, and after
     *  each choice, which the page merges into a fresh read
     *  (`storeVisitorChoice`) so keys another tab wrote are kept. */
    visitorPrefsLoaded(_state, action: PayloadAction<unknown>) {
      return { stored: action.payload };
    },
  },
});

export const visitorPrefsReducer = visitorPrefsSlice.reducer;
export const { visitorPrefsLoaded } = visitorPrefsSlice.actions;

/** The stored value (any shape; read it through `preferredView`). */
export function selectVisitorPrefs(state: {
  readonly visitorPrefs: VisitorPrefsState;
}): unknown {
  return state.visitorPrefs.stored;
}
