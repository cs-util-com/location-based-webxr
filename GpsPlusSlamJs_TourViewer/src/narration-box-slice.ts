/**
 * The narration box's playback in the page's store: which narrated text
 * the box shows (`key`), whether its voice plays, whether a finger is
 * scrubbing it, and where it is (the lit word and the line it is on).
 * More than the box reads it: the compass's speaking sign and the story's
 * next step and quiz that will share the bottom area. The voice itself
 * (one audio element per text, `narration-player.ts`) stays outside, an
 * imperative resource and the clock; the box dispatches here only when
 * one of these values changes, never per frame.
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
  /** The lit word's index in the text, -1 before the first. */
  readonly word: number;
  /** The line the lit word is on, from 0. */
  readonly line: number;
}

const initialNarrationBoxState: NarrationBoxState = {
  key: null,
  playing: false,
  scrubbing: false,
  word: -1,
  line: 0,
};

interface NarrationBoxFollow {
  readonly playing: boolean;
  readonly word: number;
  readonly line: number;
}

const narrationBoxSlice = createSlice({
  name: "narrationBox",
  initialState: initialNarrationBoxState,
  reducers: {
    /** The box shows the text `key`; another text starts at its start. */
    narrationBoxShown(state, action: PayloadAction<string>) {
      if (state.key === action.payload) return state;
      return { ...initialNarrationBoxState, key: action.payload };
    },
    narrationBoxHidden() {
      return initialNarrationBoxState;
    },
    /** Where the voice is now; ignored while hidden or with a bad place. */
    narrationBoxFollowed(state, action: PayloadAction<NarrationBoxFollow>) {
      const { playing, word, line } = action.payload;
      if (
        state.key === null ||
        !Number.isInteger(word) ||
        !Number.isInteger(line) ||
        word < -1 ||
        line < 0
      ) {
        return state;
      }
      return { ...state, playing: playing === true, word, line };
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
  narrationBoxFollowed,
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
