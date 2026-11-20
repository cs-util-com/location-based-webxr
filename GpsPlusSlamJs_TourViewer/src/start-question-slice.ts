/**
 * The setup's start answer in the page's store (creator setup flow, round
 * 2): which panel step 2 shows - one of the start question's four answers,
 * or "share", reached from Done for a tour started on this phone. Two
 * views read it: step 2's panel (`start-question.ts`) and the host tiles,
 * which offer no starter for "share" (`host-picker.ts`, through
 * `main.ts`).
 *
 * Never saved and not recorded: no `startQuestion/*` action is among the
 * page's persisted prefixes (`tour-viewer-session.ts`); a reload starts at
 * the question again.
 *
 * @see start-question-slice.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** The four answers of step 1, in the page's order. */
export const START_ANSWERS = ["new", "link", "file", "later"] as const;
export type StartAnswer = (typeof START_ANSWERS)[number];

/** Step 2's panel: an answer, or "share" - a tour started on this phone
 *  being put online from Done. */
export type StartPanel = StartAnswer | "share";

export interface StartQuestionState {
  /** The panel step 2 shows, or null before any answer. */
  readonly panel: StartPanel | null;
}

const initialStartQuestionState: StartQuestionState = { panel: null };

const PANELS: readonly string[] = [...START_ANSWERS, "share"];

const startQuestionSlice = createSlice({
  name: "startQuestion",
  initialState: initialStartQuestionState,
  reducers: {
    /** An answer tapped (or Done's "Make your code now"); a panel it does
     *  not know changes nothing. */
    startPanelShown(state, action: PayloadAction<StartPanel>) {
      if (PANELS.includes(action.payload)) state.panel = action.payload;
    },
  },
});

export const startQuestionReducer = startQuestionSlice.reducer;
export const { startPanelShown } = startQuestionSlice.actions;

/** The panel step 2 shows, or null before any answer. */
export function selectStartPanel(state: {
  readonly startQuestion: StartQuestionState;
}): StartPanel | null {
  return state.startQuestion.panel;
}
