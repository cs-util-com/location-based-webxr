/**
 * The desktop editor's start card (`editorStart`): two questions, then one
 * "Open the editor" button. Question 1 is where the creator starts from (a
 * tour they made, a new empty tour, the example); question 2, for the
 * first two only, is an optional scan of the place, shown while editing
 * and never part of the tour. This slice holds the answers and the names
 * of the files held for them; the files themselves are the page's
 * (`edit-main.ts`), since a Blob is never state. Pure.
 *
 * @see start-card.ts.md
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { EditorFileKind } from "./classify-editor-file.js";
import { NOT_A_TOUR, NOT_A_ZIP } from "./editor-open.js";

/** Where the creator starts from: a tour they made, a new one, the
 *  example. */
export type StartFrom = "tour" | "new" | "example";

const STARTS: readonly string[] = ["tour", "new", "example"];

export interface EditorStartState {
  /** Question 1's answer, or none yet. */
  readonly from: StartFrom | null;
  /** The name of the tour file held for "A tour I made", or none. */
  readonly tour: string | null;
  /** The name of the scan held for question 2, or none. */
  readonly scan: string | null;
}

export const initialEditorStartState: EditorStartState = {
  from: null,
  tour: null,
  scan: null,
};

/** A held name: non-empty text, or null to let it go. */
function isName(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value !== "");
}

const editorStartSlice = createSlice({
  name: "editorStart",
  initialState: initialEditorStartState,
  reducers: {
    /** Question 1 answered; an answer it does not know changes nothing. */
    startChosen(state, action: PayloadAction<{ from: StartFrom }>) {
      const { from } = action.payload;
      if (STARTS.includes(from)) state.from = from;
    },
    /** A tour file held for "A tour I made" (null: none). */
    tourHeld(state, action: PayloadAction<{ name: string | null }>) {
      const { name } = action.payload;
      if (isName(name)) state.tour = name;
    },
    /** A scan held for question 2 (null: none). */
    scanHeld(state, action: PayloadAction<{ name: string | null }>) {
      const { name } = action.payload;
      if (isName(name)) state.scan = name;
    },
    /** The card shown afresh: nothing answered, nothing held. */
    startReset() {
      return initialEditorStartState;
    },
  },
});

export const editorStartActions = editorStartSlice.actions;
export const editorStartReducer = editorStartSlice.reducer;

export function selectEditorStart(root: {
  editorStart: EditorStartState;
}): EditorStartState {
  return root.editorStart;
}

/** What the card shows for its answers. */
export interface StartCardView {
  /** The tour picker (file, drop, link) shows: "A tour I made". */
  readonly tourStep: boolean;
  /** Question 2, the optional scan, shows: a tour I made, or a new one. */
  readonly scanStep: boolean;
  /** "Open the editor" has something to open. */
  readonly canOpen: boolean;
  /** One line under the button: what it will do, or what it waits for. */
  readonly summary: string;
}

/** The card's lines the page writes (its questions are in edit.html). */
export const NEW_TOUR_SAVE_QUESTION = "Where should your new tour be saved?";
export const EMPTY_GLOBE_HINT =
  "Right-click the ground to place your first station.";

/**
 * What the card shows for `state`; `link` is the link field's text (a
 * link typed counts as a tour to open). Pure.
 */
export function startCardView(
  state: EditorStartState,
  link: string,
): StartCardView {
  const { from, tour, scan } = state;
  const scanStep = from === "tour" || from === "new";
  const withScan =
    scanStep && scan !== null ? `, then shows the scan ${scan}` : "";
  if (from === "tour") {
    const linked = link.trim() !== "";
    if (tour === null && !linked) {
      return {
        tourStep: true,
        scanStep,
        canOpen: false,
        summary: "Choose your tour file or paste its link first.",
      };
    }
    return {
      tourStep: true,
      scanStep,
      canOpen: true,
      summary:
        tour !== null
          ? `Opens ${tour}${withScan}.`
          : `Opens the tour behind the link${withScan}.`,
    };
  }
  if (from === "new") {
    return {
      tourStep: false,
      scanStep,
      canOpen: true,
      summary: `Starts a new, empty tour. The editor asks where to save it first${withScan}.`,
    };
  }
  if (from === "example") {
    return {
      tourStep: false,
      scanStep,
      canOpen: true,
      summary:
        "Opens the example tour to look around. Nothing is saved unless you choose Save.",
    };
  }
  return {
    tourStep: false,
    scanStep: false,
    canOpen: false,
    summary: "Choose where you start from.",
  };
}

/** A file left out of a pick, and why. */
interface IgnoredFile {
  readonly file: File;
  readonly reason: string;
}

/** Said when more than one tour came at once. */
export const ONE_TOUR_AT_A_TIME =
  "These are several tours. Choose one tour at a time.";

/** Said when more than one scan came at once. */
export const ONE_SCAN_AT_A_TIME =
  "These are several scans. Add one scan at a time.";

/** Said when the file list was empty. */
export const NO_FILE = "No file was given.";

/** Files chosen or dropped in the tour picker, sorted. */
export type TourPick =
  | {
      readonly kind: "held";
      /** The tour to open (or a file the open refuses in its own words). */
      readonly tour: File | null;
      /** A scan that came along, kept for question 2. */
      readonly scan: File | null;
      readonly ignored: readonly IgnoredFile[];
    }
  | { readonly kind: "refuse"; readonly reason: string };

/** Said when a scan came where the tour was asked for. */
export function scanKeptInsteadLine(name: string): string {
  return `${name} is a scan, not a tour: it is kept below as the scan. Now choose your tour.`;
}

/**
 * Files given to the tour picker, sorted: at most one tour and one scan,
 * held together. A scan is never held as the tour: alone, it is kept for
 * question 2. A file sorted as neither for the open's own reasons (no zip,
 * no tour in it) is held as the tour when it is the only candidate, so the
 * open refuses it in its own words; a precise reason (a scan whose
 * identity is broken) is said now. Files left out are named. Pure.
 */
export function sortTourPick(kinds: readonly EditorFileKind[]): TourPick {
  const tours = kinds.filter((k) => k.kind === "tour");
  const scans = kinds.filter((k) => k.kind === "scan");
  const neither = kinds.flatMap((k) =>
    k.kind === "neither" ? [{ file: k.file, reason: k.reason }] : [],
  );
  if (tours.length > 1) return { kind: "refuse", reason: ONE_TOUR_AT_A_TIME };
  if (scans.length > 1) return { kind: "refuse", reason: ONE_SCAN_AT_A_TIME };
  const tour = tours[0]?.file ?? null;
  const scan = scans[0]?.file ?? null;
  if (tour !== null || scan !== null) {
    return { kind: "held", tour, scan, ignored: neither };
  }
  const [first, ...rest] = neither;
  if (first === undefined) return { kind: "refuse", reason: NO_FILE };
  if (first.reason !== NOT_A_TOUR && first.reason !== NOT_A_ZIP) {
    return { kind: "refuse", reason: `${first.file.name}: ${first.reason}` };
  }
  return { kind: "held", tour: first.file, scan: null, ignored: rest };
}

/** A file given to question 2, sorted. */
export type ScanPick =
  | { readonly kind: "held"; readonly scan: File }
  | { readonly kind: "refuse"; readonly reason: string };

/** Said when a tour came where the scan was asked for. */
export function tourNotScanLine(name: string): string {
  return `${name} is a tour, not a scan. To open it, choose "A tour I made" above.`;
}

/** A file given to question 2: a scan is held; a tour, or a file with no
 *  recording, is refused in words. Pure. */
export function sortScanPick(kind: EditorFileKind): ScanPick {
  if (kind.kind === "scan") return { kind: "held", scan: kind.file };
  const { name } = kind.file;
  if (kind.kind === "tour") {
    return { kind: "refuse", reason: tourNotScanLine(name) };
  }
  if (kind.reason === NOT_A_TOUR || kind.reason === NOT_A_ZIP) {
    return {
      kind: "refuse",
      reason: `${name} is not a scan: it holds no Recorder recording and no debug data.`,
    };
  }
  return { kind: "refuse", reason: `${name}: ${kind.reason}` };
}
