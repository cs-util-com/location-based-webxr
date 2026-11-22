/**
 * The draft question of the open tour, in the store: shared by the phone
 * page (`creator-draft.ts`) and the desktop editor (`editor/draft-offer.ts`),
 * so both render the offer, its "Delete it" progress and the note that an
 * edit waits from the same selectors.
 *
 * What stays outside: the draft's records and photo bytes (the page's side
 * table of the offer), and the edit gate's held actions and their promises
 * (`draft-edit-gate.ts`), which are resources, not state. The gate reports
 * only how many edits wait (`editsWaitingChanged`).
 *
 * Every answer names the question it answers (`generation`): a read, a
 * Restore or a "Delete it" that finishes after the tour was closed or read
 * again changes nothing.
 *
 * @see tour-draft-slice.ts.md
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { tourDocumentActions } from "./tour-document.js";

/**
 * - `none`: no draft question (nothing read yet, nothing found, or the
 *   draft was deleted).
 * - `reading`: the open tour's draft is being read.
 * - `offered`: a draft waits for an answer, and its offer shows.
 * - `declined`: put off with "Not now": still undecided, the offer hidden.
 * - `restored`: the draft came back into the tour.
 * - `unavailable`: no draft can be kept for this tour (`reason`).
 */
type TourDraftStatus =
  "none" | "reading" | "offered" | "declined" | "restored" | "unavailable";

/** Why no draft can be kept: no storage in this browser, another tab
 *  holds the tour's draft, or its read failed. */
type DraftUnavailableReason = "storage" | "other-tab" | "read-failed";

const REASONS: readonly string[] = ["storage", "other-tab", "read-failed"];

export interface TourDraftState {
  readonly status: TourDraftStatus;
  /** Set exactly while `status` is `unavailable`. */
  readonly reason: DraftUnavailableReason | null;
  /** The question: moves on every read and every end of a question. */
  readonly generation: number;
  /** The offer's words; set exactly while the draft is undecided
   *  (`offered` or `declined`). */
  readonly text: string | null;
  /** "Delete it" runs (only while `offered`). */
  readonly deleting: boolean;
  /** Edits waiting in the gate for the answer (the gate's count). */
  readonly editsWaiting: number;
}

export const initialTourDraftState: TourDraftState = {
  status: "none",
  reason: null,
  generation: 0,
  text: null,
  deleting: false,
  editsWaiting: 0,
};

interface Question {
  readonly generation: number;
}

function undecided(state: TourDraftState): boolean {
  return state.status === "offered" || state.status === "declined";
}

function current(state: TourDraftState, payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Question).generation === state.generation
  );
}

/** A new question, or none: every answer of the one before is stale. */
function nextQuestion(
  state: { -readonly [K in keyof TourDraftState]: TourDraftState[K] },
  status: "none" | "reading",
): void {
  state.generation += 1;
  state.status = status;
  state.reason = null;
  state.text = null;
  state.deleting = false;
}

const tourDraftSlice = createSlice({
  name: "tourDraft",
  initialState: initialTourDraftState,
  reducers: {
    /** The open tour's draft is read from now on: a new question. */
    readStarted(state) {
      nextQuestion(state, "reading");
    },
    /** The question ends without a tour closing (a page's teardown). */
    questionEnded(state) {
      nextQuestion(state, "none");
    },
    /** The read found a draft to offer, in these words. */
    found(state, action: PayloadAction<Question & { readonly text: string }>) {
      if (!current(state, action.payload) || state.status !== "reading") {
        return;
      }
      if (typeof action.payload.text !== "string") return;
      state.status = "offered";
      state.text = action.payload.text;
    },
    /** The read found nothing to offer. */
    noneFound(state, action: PayloadAction<Question>) {
      if (!current(state, action.payload) || state.status !== "reading") {
        return;
      }
      state.status = "none";
    },
    /** No draft can be kept. Never over an undecided offer: its records
     *  are in memory and its answers still work. */
    unavailable(
      state,
      action: PayloadAction<
        Question & { readonly reason: DraftUnavailableReason }
      >,
    ) {
      if (!current(state, action.payload) || undecided(state)) return;
      if (!REASONS.includes(action.payload.reason)) return;
      state.status = "unavailable";
      state.reason = action.payload.reason;
    },
    /** Restore: the draft is the tour's now. Not while "Delete it" runs. */
    restored(state, action: PayloadAction<Question>) {
      if (!current(state, action.payload) || !undecided(state)) return;
      if (state.deleting) return;
      state.status = "restored";
      state.text = null;
    },
    /** "Not now": undecided still, the offer hidden. */
    declined(state, action: PayloadAction<Question>) {
      if (!current(state, action.payload) || state.status !== "offered") {
        return;
      }
      if (state.deleting) return;
      state.status = "declined";
    },
    /** The offer shows again (a put-off draft asked about once more). */
    reshown(state, action: PayloadAction<Question>) {
      if (!current(state, action.payload) || state.status !== "declined") {
        return;
      }
      state.status = "offered";
    },
    /** "Delete it" starts: every answer is off until it ends. */
    deleteStarted(state, action: PayloadAction<Question>) {
      if (!current(state, action.payload) || state.status !== "offered") {
        return;
      }
      state.deleting = true;
    },
    /** "Delete it" ended: landed, the draft is gone; not, it still waits. */
    deleteEnded(
      state,
      action: PayloadAction<Question & { readonly landed: boolean }>,
    ) {
      if (!current(state, action.payload) || !state.deleting) return;
      state.deleting = false;
      if (action.payload.landed !== true) return;
      state.status = "none";
      state.text = null;
    },
    /** The gate's count of waiting edits. A first one asks a put-off
     *  draft again: the offer shows. */
    editsWaitingChanged(
      state,
      action: PayloadAction<{ readonly count: number }>,
    ) {
      const count = action.payload?.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        return;
      }
      state.editsWaiting = count;
      if (count > 0 && state.status === "declined") state.status = "offered";
    },
  },
  extraReducers: (builder) => {
    // No tour, no question.
    builder.addCase(tourDocumentActions.closed, (state) => {
      nextQuestion(state, "none");
    });
  },
});

export const tourDraftReducer = tourDraftSlice.reducer;
export const tourDraftActions = tourDraftSlice.actions;

interface WithTourDraft {
  readonly tourDraft: TourDraftState;
}

export function selectTourDraft(state: WithTourDraft): TourDraftState {
  return state.tourDraft;
}

/** Whether the draft waits for an answer (offered, or put off). */
export function selectDraftUndecided(state: WithTourDraft): boolean {
  return undecided(state.tourDraft);
}

/** What the offer shows, or null while it is hidden: its words, whether
 *  an edit waits for the answer, and whether "Delete it" runs. */
export interface DraftOfferShown {
  readonly text: string;
  readonly waits: boolean;
  readonly deleting: boolean;
}

export function selectDraftOffer(state: WithTourDraft): DraftOfferShown | null {
  const draft = state.tourDraft;
  if (draft.status !== "offered" || draft.text === null) return null;
  return {
    text: draft.text,
    waits: draft.editsWaiting > 0,
    deleting: draft.deleting,
  };
}

/** Whether an edit waits for a draft still being read (the page says
 *  so: `DRAFT_BEING_READ`). */
export function selectEditWaitsForRead(state: WithTourDraft): boolean {
  const draft = state.tourDraft;
  return draft.status === "reading" && draft.editsWaiting > 0;
}
