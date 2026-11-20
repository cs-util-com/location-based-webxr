/**
 * The creator's setup path: step 1 asks ONE question and only routes;
 * each of its four answers leads to a short checklist of wizard steps,
 * shown as step 2 with the current item active. The answer lives in the
 * page's store (the `setupPath` slice: the stage, the question and the
 * card all read it) and on the device, so a reload resumes the same path.
 *
 * Pure apart from the guarded storage access; the wiring is in
 * `setup-stage.ts` (what shows) and `main.ts` (what a tap does).
 *
 * @see setup-path.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { WizardStep } from "./wizard.js";

/** The four answers of step 1, in the order the page lists them. */
export const SETUP_ANSWERS = [
  /** New tour, shared now: storage, link, print, hang, then create. */
  "share-now",
  /** The tour exists and has a link. */
  "have-link",
  /** The tour zip is on this phone. */
  "file-here",
  /** Start on this phone, share later: a starter zip saved and opened. */
  "start-here",
] as const;
export type SetupAnswer = (typeof SETUP_ANSWERS)[number];

/** Each answer's checklist, in order. Every path ends in create, then
 *  done; only the paths with a link print a code before creating. */
export const SETUP_PATHS: Readonly<Record<SetupAnswer, readonly WizardStep[]>> =
  {
    "share-now": ["host", "link", "print", "hang", "measure", "done"],
    "have-link": ["link", "print", "hang", "measure", "done"],
    "file-here": ["file", "measure", "done"],
    "start-here": ["starter", "measure", "done"],
  };

/** Where an answer's checklist starts. A maker who already chose where
 *  the tour lives (`tour-host.ts`) starts the share-now path at its link. */
export function firstStepOf(
  answer: SetupAnswer,
  hostChosen: boolean,
): WizardStep {
  if (answer === "share-now" && hostChosen) return "link";
  return SETUP_PATHS[answer][0] ?? "measure";
}

/** The step a freshly opened tour lands on (a step this maker reached
 *  with this tour still wins, `wizard.presentTour`): print where the path
 *  has a link to print, create where the tour is a file on this phone. */
export function stepAfterTourOpens(answer: SetupAnswer | null): WizardStep {
  return answer === "file-here" || answer === "start-here"
    ? "measure"
    : "print";
}

/** The answer once a tour has opened: the chosen one, else the one that
 *  matches how it opened (a launch link, a remembered link, the "already
 *  have a tour" section), so an open tour never sits under the question. */
export function answerForOpenedTour(
  answer: SetupAnswer | null,
  how: "link" | "file",
): SetupAnswer {
  return answer ?? (how === "link" ? "have-link" : "file-here");
}

/** A stored answer, or null for anything else. */
export function parseSetupAnswer(value: string | null): SetupAnswer | null {
  return (SETUP_ANSWERS as readonly string[]).includes(value ?? "")
    ? (value as SetupAnswer)
    : null;
}

/** Where the answer is kept on the device. */
export const SETUP_ANSWER_KEY = "tour-viewer.setup.path";

interface AnswerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored answer; null for none, a blocked store or no store. */
export function readSetupAnswer(
  store: AnswerStore | undefined,
): SetupAnswer | null {
  try {
    return parseSetupAnswer(store?.getItem(SETUP_ANSWER_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Keep the answer (null: back to the question). A refused write leaves
 *  the page's store holding it, so it lasts the visit. */
export function writeSetupAnswer(
  store: AnswerStore | undefined,
  answer: SetupAnswer | null,
): void {
  try {
    store?.setItem(SETUP_ANSWER_KEY, answer ?? "");
  } catch {
    // Blocked site data: the answer lasts this visit only.
  }
}

export interface SetupPathState {
  /** The chosen answer; null while the question shows. */
  readonly answer: SetupAnswer | null;
}

const setupPathSlice = createSlice({
  name: "setupPath",
  initialState: { answer: null } as SetupPathState,
  reducers: {
    /** An answer chosen, inferred from an open, or read from the device;
     *  null puts the question back. */
    setupAnswered(_state, action: PayloadAction<SetupAnswer | null>) {
      return { answer: action.payload };
    },
  },
});

export const setupPathReducer = setupPathSlice.reducer;
export const { setupAnswered } = setupPathSlice.actions;

export function selectSetupAnswer(state: {
  readonly setupPath: SetupPathState;
}): SetupAnswer | null {
  return state.setupPath.answer;
}
