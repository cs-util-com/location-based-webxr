/**
 * The narration box's playback in the page's store: which narrated text
 * the box shows (`key`), whether its voice plays, and whether a finger is
 * scrubbing it. It is the shared answer to "is a narration heard" for the
 * views that will sit beside the box (the story's next step and a quiz in
 * the same bottom area). Where the voice is (the lit word, its line) stays
 * in the box until a reader needs it. The voice itself (one audio element
 * per text, `narration-player.ts`) stays outside, an imperative resource
 * and the clock; the box dispatches here only when one of these values
 * changes: on a new text, a tap, a drag's start and end, the voice's end.
 *
 * Not recorded: no `narrationBox/*` action is among the page's persisted
 * prefixes (`tour-viewer-session.ts`).
 *
 * @see narration-box-slice.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface NarrationBoxState {
  /** The shown text's key, or null while the box is hidden. */
  readonly key: string | null;
  /** The visitor asked for the voice and has not paused it. */
  readonly playing: boolean;
  /** A finger is dragging the words (the voice is held meanwhile). */
  readonly scrubbing: boolean;
}

const initialNarrationBoxState: NarrationBoxState = {
  key: null,
  playing: false,
  scrubbing: false,
};

const narrationBoxSlice = createSlice({
  name: "narrationBox",
  initialState: initialNarrationBoxState,
  reducers: {
    /** The box shows the text `key`; another text starts silent. */
    narrationBoxShown(state, action: PayloadAction<string>) {
      if (state.key === action.payload) return state;
      return { ...initialNarrationBoxState, key: action.payload };
    },
    narrationBoxHidden() {
      return initialNarrationBoxState;
    },
    /** Whether the shown text's voice plays; ignored while hidden. */
    narrationBoxPlaying(state, action: PayloadAction<boolean>) {
      if (state.key === null) return state;
      return { ...state, playing: action.payload === true };
    },
    narrationBoxScrubbing(state, action: PayloadAction<boolean>) {
      if (state.key === null) return state;
      return { ...state, scrubbing: action.payload === true };
    },
  },
});

export const narrationBoxReducer = narrationBoxSlice.reducer;
export const {
  narrationBoxShown,
  narrationBoxHidden,
  narrationBoxPlaying,
  narrationBoxScrubbing,
} = narrationBoxSlice.actions;

export function selectNarrationBox(state: {
  readonly narrationBox: NarrationBoxState;
}): NarrationBoxState {
  return state.narrationBox;
}

/** A shown text's voice is heard: playing and not held by a scrub. */
export function selectNarrationSpeaking(state: {
  readonly narrationBox: NarrationBoxState;
}): boolean {
  const s = state.narrationBox;
  return s.key !== null && s.playing && !s.scrubbing;
}
