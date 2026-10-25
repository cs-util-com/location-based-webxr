/**
 * The visitor's walk in the page's store (root CLAUDE.md, the Redux rule): the run's
 * progress (every station's state, its skip clock, the branch path), the
 * last skip while it can still be undone (`lastSkip`, settled by
 * `skipSettled`), the one-line note of what just happened (`note`), and
 * the quick action's arm (`quickArmedId`, "Can't get there?" asked for one
 * station), the sheet's peek or list, and a "Welcome back" waiting for the
 * next AR entry. The reducer applies the run's pure transitions
 * (`station-run.ts` `applyWalkStep`): one rule, in the store. The station
 * guide (`station-guide.ts`) dispatches only on events, never per frame,
 * and one call's changes as ONE batch (`walkBatched`) at its end, so a
 * store subscriber that re-enters the guide sees a consistent walk.
 *
 * The sheet is the visitor's choice, with
 * two changes that follow the walk, here so they hold for every writer: a
 * station found (its story starts) closes the list, and the tour's finish
 * opens it once (`completionSeen`) - finished, not merely complete: a
 * tour completed by its last station's end waits until the visitor leaves
 * it or taps "Finish the tour" (`station-run.ts`).
 *
 * The walk's rules keep their state here too: the row a
 * Skip armed (`rowArmedId`, apart from the quick action's arm), the list
 * opened to choose what to skip with no station guessed (`chooser`), no
 * guess while the guide shows no distance (`noGuess`, the no-guess rule, with the
 * guide's hold), and the visitor's chosen target (`chosenId`, the chosen-target rule). The
 * station the walk is about is one selector over them (`walkFocus`, the focus rule).
 *
 * The windows of the last skip and the note (6 s, `SKIP_UNDO_MS`) are read
 * over the page's time by their readers, through `selectUndoableSkip` and
 * `selectNote`; no timer lives here.
 *
 * Not recorded: no `visitorWalk/*` action is among the page's persisted
 * prefixes (`tour-viewer-session.ts`), so a dispatch from the store's
 * subscriber does not reorder a recording.
 *
 * @see visitor-walk-slice.ts.md
 */

import { createAction, type UnknownAction } from "@reduxjs/toolkit";
import type { TourOrder } from "gps-plus-slam-app-framework/ar/tour-stations";
import { DEFAULT_TOAST_LINGER_MS } from "gps-plus-slam-app-framework/utils/toast-core";

import {
  applyWalkStep,
  startWalk,
  walkFinished,
  walkOffered,
  walkStatus,
  type WalkProgress,
  type WalkRoute,
  type WalkStep,
} from "./station-run.js";
import { guideTourChanged } from "./visitor-guide-slice.js";

/**
 * How long a skip can be undone: the framework's toast
 * linger (6 s), so it reads like every other transient message. Argued,
 * not measured: 3 s is about the time to read "Skipped X. Next: Y, 80 m"
 * (8 words at 4 words a second) and react; 10 s would hold the next
 * station's skip back that long. Reversed by a field test showing stray
 * skips noticed later than 6 s, or visitors waiting on the undo. The
 * note's window too. Here, not in the guide, which imports this slice.
 */
export const SKIP_UNDO_MS = DEFAULT_TOAST_LINGER_MS;

/** The last skip: undoable until it settles. */
interface LastSkip {
  readonly id: string;
  /** When it was skipped, on the page's clock. */
  readonly atMs: number;
  /** The undo's moment passed, or the tour moved on (`skipSettled`). */
  readonly settled: boolean;
}

/** What just happened, for the station line ("Skipped the well."). */
interface WalkNote {
  readonly kind: "skipped" | "brought-back";
  readonly id: string;
  readonly atMs: number;
}

export interface VisitorWalkState {
  /** The open tour's walk; null: no tour, or none placed yet. */
  readonly progress: WalkProgress | null;
  readonly lastSkip: LastSkip | null;
  readonly note: WalkNote | null;
  /** The station the visitor asked to skip ("Can't get there?"); the next
   *  tap confirms. Null: not asked, or the focus moved since. */
  readonly quickArmedId: string | null;
  /** The sheet: its peek, or the list pulled up. */
  readonly sheet: WalkSheet;
  /** The tour is finished and its finish opened the list already: the
   *  list opens once per finish, and a walk no longer finished (a skip
   *  undone) may open it again when it finishes again. */
  readonly completionSeen: boolean;
  /** The visitor left AR with progress: the next entry's first sheet says
   *  "Welcome back", once. */
  readonly welcomePending: boolean;
  /** The row whose Skip asked for its confirm: its
   *  own arm, apart from the quick action's; a focus change or a
   *  degradation never clears it, closing the list, a story starting or
   *  the station leaving the offer does. */
  readonly rowArmedId: string | null;
  /** The list was opened by "Can't get there?" with no station guessed:
   *  its hint asks which station, and a row's Skip acts
   *  on one tap while the no-guess rule holds. Cleared with the list and when the
   *  distance is back for its hold. */
  readonly chooser: boolean;
  /** The guide shows no distance, or it has not been back for its hold:
   *  an any-order tour guesses no station meanwhile. Dispatched by
   *  the guide on entering and leaving, never per frame. */
  readonly noGuess: boolean;
  /** The visitor's chosen target: a waiting offered station of an
   *  any-order tour; cleared when it is found or skipped, and with the
   *  walk. Kept across AR entries (it is progress). */
  readonly chosenId: string | null;
}

/** The sheet's two states. */
export type WalkSheet = "peek" | "list";

const initialVisitorWalkState: VisitorWalkState = {
  progress: null,
  lastSkip: null,
  note: null,
  quickArmedId: null,
  sheet: "peek",
  completionSeen: false,
  welcomePending: false,
  rowArmedId: null,
  chooser: false,
  noGuess: false,
  chosenId: null,
};

/** A new walk (another tour, or the first): everything starts anew. */
export const walkStarted = createAction<{
  readonly order: TourOrder;
  readonly route: WalkRoute;
}>("visitorWalk/walkStarted");
/** No tour (or no stations): no walk. */
export const walkCleared = createAction("visitorWalk/walkCleared");
/** One of the run's transitions (`WalkStep`). */
export const walkStepped = createAction<WalkStep>("visitorWalk/walkStepped");
/** The visitor skipped a station: it can be undone for a moment. */
export const skipTaken = createAction<{
  readonly id: string;
  readonly atMs: number;
}>("visitorWalk/skipTaken");
/** The last skip can no longer be undone. */
export const skipSettled = createAction("visitorWalk/skipSettled");
/** A skipped station was brought back (the last skip's undo, or any
 *  skipped station later, bring back at any time): the note says so; the last skip's undo
 *  goes only when it was that station's. */
export const skipUndone = createAction<{
  readonly id: string;
  readonly atMs: number;
}>("visitorWalk/skipUndone");
/** The note goes (a story ended). */
export const noteCleared = createAction("visitorWalk/noteCleared");
/** The quick action asked for this station, or for none. */
export const quickArmed = createAction<string | null>("visitorWalk/quickArmed");
/** The visitor opened or closed the list. */
export const sheetSet = createAction<WalkSheet>("visitorWalk/sheetSet");
/** The welcome back armed (leaving AR with progress) or said. */
export const welcomeSet = createAction<boolean>("visitorWalk/welcomeSet");
/** "Can't get there?" opened the list: the focus's row armed,
 *  or the chooser with no station guessed. */
export const listOpened = createAction<{
  readonly armedId: string | null;
  readonly chooser: boolean;
}>("visitorWalk/listOpened");
/** A row's Skip asked for its confirm, or the confirm was cancelled. */
export const rowArmed = createAction<string | null>("visitorWalk/rowArmed");
/** The no-guess rule entered (true) or left after its hold (false). */
export const noGuessSet = createAction<boolean>("visitorWalk/noGuessSet");
/** "Guide me here": a station chosen as the target, or none. */
export const targetChosen = createAction<string | null>(
  "visitorWalk/targetChosen",
);
/** One guide call's changes, applied in order as one dispatch. */
export const walkBatched = createAction<readonly UnknownAction[]>(
  "visitorWalk/walkBatched",
);

/** The run's step, where its rule allows it; the same state otherwise. */
function stepped(state: VisitorWalkState, step: WalkStep): VisitorWalkState {
  if (state.progress === null) return state;
  const { progress } = applyWalkStep(state.progress, step);
  return progress === state.progress
    ? state
    : withSheetRules(step, { ...state, progress });
}

/** The sheet's two changes that follow the walk: a find whose story
 *  starts closes the list, and the tour's finish opens it once. */
function withSheetRules(
  step: WalkStep,
  state: VisitorWalkState & { readonly progress: WalkProgress },
): VisitorWalkState {
  const finished = walkFinished(state.progress);
  if (finished && !state.completionSeen) {
    return withOfferRules({ ...state, sheet: "list", completionSeen: true });
  }
  const next =
    finished === state.completionSeen
      ? state
      : { ...state, completionSeen: finished };
  const storyStarts =
    step.kind === "found" &&
    walkStatus(state.progress, step.id)?.state === "found";
  const kept = withOfferRules(next);
  return storyStarts ? closed(kept) : kept;
}

/** The list closed: its row arm and its chooser go with it. */
function closed(state: VisitorWalkState): VisitorWalkState {
  return state.sheet === "peek" && state.rowArmedId === null && !state.chooser
    ? state
    : { ...state, sheet: "peek", rowArmedId: null, chooser: false };
}

/** A waiting station still offered: what a row arm and a chosen target
 *  may name. */
function waitingOffered(progress: WalkProgress, id: string | null): boolean {
  return (
    id !== null &&
    walkStatus(progress, id)?.state === "waiting" &&
    walkOffered(progress).includes(id)
  );
}

/** The stations offered and not yet found (a found one's story plays). */
function unfoundOffered(progress: WalkProgress): string[] {
  return walkOffered(progress).filter(
    (id) => walkStatus(progress, id)?.state !== "found",
  );
}

/** Whether a target may be chosen now: an any-order tour with two
 *  or more stations still to find. */
function choiceOffered(progress: WalkProgress): boolean {
  return progress.order === "any" && unfoundOffered(progress).length >= 2;
}

/** A row arm and a chosen target go once their station is found, skipped
 *  or no longer offered. */
function withOfferRules(state: VisitorWalkState): VisitorWalkState {
  const { progress } = state;
  if (progress === null) return state;
  const armOk =
    state.rowArmedId === null || waitingOffered(progress, state.rowArmedId);
  const choiceOk =
    state.chosenId === null || waitingOffered(progress, state.chosenId);
  if (armOk && choiceOk) return state;
  return {
    ...state,
    rowArmedId: armOk ? state.rowArmedId : null,
    chosenId: choiceOk ? state.chosenId : null,
  };
}

/**
 * The walk's reducer, mounted as `visitorWalk` by `createTourViewerStore`.
 * Plain (no Immer draft): the run's transitions build new progress
 * themselves. Every case returns the same state when it changes nothing.
 */
export function visitorWalkReducer(
  state: VisitorWalkState = initialVisitorWalkState,
  action: UnknownAction,
): VisitorWalkState {
  if (walkBatched.match(action)) {
    return action.payload.reduce(visitorWalkReducer, state);
  }
  if (walkStarted.match(action)) {
    return {
      ...initialVisitorWalkState,
      progress: startWalk(action.payload.route, action.payload.order),
    };
  }
  // Another tour (or none) resets the walk with the guide's other state.
  if (walkCleared.match(action) || guideTourChanged.match(action)) {
    return initialVisitorWalkState;
  }
  if (walkStepped.match(action)) return stepped(state, action.payload);
  if (skipTaken.match(action)) {
    const { id, atMs } = action.payload;
    return {
      ...state,
      lastSkip: { id, atMs, settled: false },
      note: { kind: "skipped", id, atMs },
      rowArmedId: null,
      chooser: false,
    };
  }
  if (skipSettled.match(action)) {
    const last = state.lastSkip;
    if (last === null || last.settled) return state;
    return { ...state, lastSkip: { ...last, settled: true } };
  }
  if (skipUndone.match(action)) {
    const { id, atMs } = action.payload;
    return {
      ...state,
      lastSkip: state.lastSkip?.id === id ? null : state.lastSkip,
      note: { kind: "brought-back", id, atMs },
    };
  }
  if (noteCleared.match(action)) {
    return state.note === null ? state : { ...state, note: null };
  }
  if (sheetSet.match(action)) {
    if (action.payload === "peek") return closed(state);
    return state.sheet === "list" ? state : { ...state, sheet: "list" };
  }
  if (listOpened.match(action)) {
    const { armedId, chooser } = action.payload;
    const armed =
      state.progress !== null && waitingOffered(state.progress, armedId)
        ? armedId
        : null;
    return state.sheet === "list" &&
      state.rowArmedId === armed &&
      state.chooser === chooser
      ? state
      : { ...state, sheet: "list", rowArmedId: armed, chooser };
  }
  if (rowArmed.match(action)) {
    const id = action.payload;
    if (
      id !== null &&
      (state.progress === null || !waitingOffered(state.progress, id))
    ) {
      return state;
    }
    return state.rowArmedId === id ? state : { ...state, rowArmedId: id };
  }
  if (noGuessSet.match(action)) {
    const noGuess = action.payload;
    const chooser = noGuess && state.chooser;
    return state.noGuess === noGuess && state.chooser === chooser
      ? state
      : { ...state, noGuess, chooser };
  }
  if (targetChosen.match(action)) {
    const id = action.payload;
    if (id === null) {
      return state.chosenId === null ? state : { ...state, chosenId: null };
    }
    const { progress } = state;
    if (
      progress === null ||
      !choiceOffered(progress) ||
      !waitingOffered(progress, id)
    ) {
      return state;
    }
    return state.chosenId === id ? state : { ...state, chosenId: id };
  }
  if (welcomeSet.match(action)) {
    return state.welcomePending === action.payload
      ? state
      : { ...state, welcomePending: action.payload };
  }
  if (quickArmed.match(action)) {
    return state.quickArmedId === action.payload
      ? state
      : { ...state, quickArmedId: action.payload };
  }
  return state;
}

/** What the guide needs of the page's store. */
export interface VisitorWalkStore {
  getState(): WithWalk;
  dispatch(action: UnknownAction): unknown;
}

type WithWalk = { readonly visitorWalk: VisitorWalkState };

/** The last skip while it can be undone at `nowMs`: not settled, and
 *  inside its window (`SKIP_UNDO_MS`); null otherwise. The settle itself
 *  is an event (`skipSettled`): past the window an unsettled skip is still
 *  in the state until its reader settles it. */
export function selectUndoableSkip(
  state: WithWalk,
  nowMs: number,
): { readonly id: string; readonly atMs: number } | null {
  const skip = state.visitorWalk.lastSkip;
  if (skip === null || skip.settled || nowMs >= skip.atMs + SKIP_UNDO_MS) {
    return null;
  }
  return { id: skip.id, atMs: skip.atMs };
}

/**
 * The station the walk is about: the peek,
 * the radar's orange, the breadcrumbs and the skip clock read it.
 * - fixed and branch order: the one offered station not yet found;
 * - any order with one station to find: that one;
 * - any order with several: the chosen target (the chosen-target rule, whatever the
 *   precision: the visitor's own pick is no guess), else none while no
 *   distance is guessed (`noGuess`, the no-guess rule), else the nearest by
 *   `distances` (one without a distance counts as farthest; ties go to
 *   list order);
 * - nothing to find (a story plays, or the tour is complete): none.
 */
export function walkFocus(
  walk: VisitorWalkState,
  distances: ReadonlyMap<string, number>,
): string | null {
  const { progress } = walk;
  if (progress === null) return null;
  const unfound = unfoundOffered(progress);
  if (unfound.length === 0) return null;
  if (progress.order !== "any" || unfound.length === 1) return unfound[0]!;
  if (walk.chosenId !== null && unfound.includes(walk.chosenId)) {
    return walk.chosenId;
  }
  if (walk.noGuess) return null;
  let best = unfound[0]!;
  let bestD = distanceOr(distances, best);
  for (const id of unfound) {
    const d = distanceOr(distances, id);
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

function distanceOr(
  distances: ReadonlyMap<string, number>,
  id: string,
): number {
  const d = distances.get(id);
  return d === undefined || Number.isNaN(d) ? Infinity : d;
}

const NO_DISTANCES: ReadonlyMap<string, number> = new Map();

/** The no-guess condition: an any-order tour, two or more stations to
 *  find, no chosen target among them, and no distance guessed - the walk
 *  has no focus, the list's hint shows and the figure holds its turn. */
export function walkNoGuess(walk: VisitorWalkState): boolean {
  const { progress } = walk;
  return (
    progress !== null &&
    walk.noGuess &&
    choiceOffered(progress) &&
    walkFocus(walk, NO_DISTANCES) === null
  );
}

/** Whether a target may be chosen now: any order, two or more
 *  stations to find. */
export function walkChoiceOffered(walk: VisitorWalkState): boolean {
  return walk.progress !== null && choiceOffered(walk.progress);
}

/** The open tour's walk; null: no tour, or none placed yet. */
export function selectWalkProgress(state: WithWalk): WalkProgress | null {
  return state.visitorWalk.progress;
}

/** The sheet: its peek, or the list pulled up. */
export function selectWalkSheet(state: WithWalk): WalkSheet {
  return state.visitorWalk.sheet;
}

/** A "Welcome back" waits for the next entry's first sheet. */
export function selectWelcomePending(state: WithWalk): boolean {
  return state.visitorWalk.welcomePending;
}

/** The note of what just happened while its moment lasts at `nowMs`
 *  (`SKIP_UNDO_MS`), else null. */
export function selectNote(state: WithWalk, nowMs: number): WalkNote | null {
  const note = state.visitorWalk.note;
  return note === null || nowMs >= note.atMs + SKIP_UNDO_MS ? null : note;
}
