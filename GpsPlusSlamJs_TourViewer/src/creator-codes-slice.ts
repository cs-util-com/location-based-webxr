/**
 * The creator's codes as this page holds them, outside the tour (the
 * debug-captures plan M3a): the code in hand, its fresh measurement, the
 * running visit's sighting of it and its latest sighting of every stored
 * code. Each is the page's or the visit's, never the tour's, so it has no
 * history and no draft of its own; the tour's codes - their texts and the
 * measurement per code - are the document's (`tourDocument`'s `codes`).
 *
 * The hand moves with the document's code actions (one dispatch, both
 * slices: the payload names the hand after the change); the sightings have
 * their own. `creator-codes.ts` is the one module that dispatches them.
 *
 * @see creator-codes-slice.ts.md
 */

import {
  createSlice,
  current,
  type Draft,
  type PayloadAction,
} from "@reduxjs/toolkit";

import { tourDocumentActions, type LevelText } from "./tour-document.js";
import type { CodeMeasurement, CodeSighting } from "./visit-settle.js";

/** A stored code's latest sighting in a visit (the visit log reads it). */
export interface StoredSighting {
  readonly visit: number;
  readonly sighting: CodeSighting;
}

export interface CreatorCodesState {
  /** The code in hand: the code taken last, ready to be written as
   *  `qr/<id>.json`; null until the mint's async identity hash landed. */
  readonly hand: LevelText | null;
  /** The hand's measurement in this page (the fused pose, the size, the AR
   *  visit), what the settle re-mints it from; null for a code taken as a
   *  stored reference, even when the document still holds an earlier
   *  visit's measurement of it (two readers do not filter by visit). */
  readonly handMeasurement: CodeMeasurement | null;
  /** The running visit's latest stable sighting of the code in hand (or of
   *  a code seen while the hand was empty): what a later visit is corrected
   *  through and what hides the entry hint. Cleared at each visit's end -
   *  odometry does not carry over. */
  readonly visitSighting: CodeSighting | null;
  /**
   * The latest stable sighting in the running visit of EVERY code with a
   * stored pose, in the order the codes were first sighted (a code sighted
   * again keeps its place). Only the visit log reads it. Tagged with its
   * visit, so a visit that ended without a settle cannot leak into the next
   * one's log.
   */
  readonly storedSightings: readonly {
    readonly levelId: string;
    readonly seen: StoredSighting;
  }[];
}

const initialCreatorCodesState: CreatorCodesState = {
  hand: null,
  handMeasurement: null,
  visitSighting: null,
  storedSightings: [],
};

/** The slice as it stands (its state is immutable data, written by
 *  returning a new state, as the tour document's is). */
function plain(state: Draft<CreatorCodesState>): CreatorCodesState {
  return current(state);
}

/** `before` with `next` applied. */
function withFields(
  state: Draft<CreatorCodesState>,
  next: Partial<CreatorCodesState>,
): CreatorCodesState {
  return { ...plain(state), ...next };
}

const creatorCodesSlice = createSlice({
  name: "creatorCodes",
  initialState: initialCreatorCodesState,
  reducers: {
    /** The running visit's latest stable sighting of the code in hand. */
    sightingSeen(state, action: PayloadAction<CodeSighting>) {
      return withFields(state, { visitSighting: action.payload });
    },
    /** A code's sightings of this visit are void (its printed size
     *  changed): its stored-code sighting goes, and the visit's sighting if
     *  it is that code's. */
    sightingsForgotten(state, action: PayloadAction<{ levelId: string }>) {
      const before = plain(state);
      const { levelId } = action.payload;
      return {
        ...before,
        storedSightings: before.storedSightings.filter(
          (s) => s.levelId !== levelId,
        ),
        visitSighting:
          before.visitSighting?.levelId === levelId
            ? null
            : before.visitSighting,
      };
    },
    /** A stored code seen stable in `visit` (the latest one per code). */
    storedCodeSighted(
      state,
      action: PayloadAction<{
        levelId: string;
        visit: number;
        sighting: CodeSighting;
      }>,
    ) {
      const before = plain(state);
      const { levelId, visit, sighting } = action.payload;
      const entry = { levelId, seen: { visit, sighting } };
      const known = before.storedSightings.some((s) => s.levelId === levelId);
      return {
        ...before,
        storedSightings: known
          ? before.storedSightings.map((s) =>
              s.levelId === levelId ? entry : s,
            )
          : [...before.storedSightings, entry],
      };
    },
    /** A visit ended: its sightings go (the hand and its measurement stay
     *  for the next visit of the same tour). */
    visitEnded(state) {
      return withFields(state, { storedSightings: [], visitSighting: null });
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(tourDocumentActions.codeTaken, (state, action) =>
        withFields(state, {
          hand: action.payload.level,
          handMeasurement: action.payload.measurement,
        }),
      )
      .addCase(tourDocumentActions.codeTakenFromDraft, (state, action) =>
        withFields(state, { hand: action.payload.level }),
      )
      .addCase(tourDocumentActions.codeLetGo, (state) =>
        withFields(state, { hand: null, handMeasurement: null }),
      )
      .addCase(tourDocumentActions.codeSaved, (state, action) =>
        withFields(state, { hand: action.payload.hand }),
      )
      .addCase(tourDocumentActions.codesRestored, (state, action) =>
        withFields(state, { hand: action.payload.hand }),
      )
      // A tour's close: the hand and its measurement go. The visit's
      // sightings are left to the visit's end, as a tour cannot close
      // inside a visit (scan-to-open never switches tours, and the open
      // controls sit outside the AR overlay).
      .addCase(tourDocumentActions.codesForgotten, (state) =>
        withFields(state, { hand: null, handMeasurement: null }),
      );
  },
});

export const creatorCodesActions = creatorCodesSlice.actions;

export const creatorCodesReducer = creatorCodesSlice.reducer;

/** The slice inside a store's state. */
export function selectCreatorCodes(root: {
  readonly creatorCodes: CreatorCodesState;
}): CreatorCodesState {
  return root.creatorCodes;
}
