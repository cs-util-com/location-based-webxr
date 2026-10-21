/**
 * The visitor's walk in the page's store (visitor walk W4 build plan
 * 2026-10-21-1105, M1, §2.2; root CLAUDE.md, the Redux rule): the run's
 * progress (every station's state, its skip clock, the branch path), the
 * last skip while it can still be undone (`lastSkip`, settled by
 * `skipSettled`), the one-line note of what just happened (`note`), and
 * the quick action's arm (`quickArmedId`, "Can't get there?" asked for one
 * station). The reducer applies the run's pure transitions
 * (`station-run.ts` `applyWalkStep`): one rule, in the store. The station
 * guide (`station-guide.ts`) dispatches only on events, never per frame,
 * and one call's changes as ONE batch (`walkBatched`) at its end, so a
 * store subscriber that re-enters the guide sees a consistent walk.
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
  type WalkProgress,
  type WalkRoute,
  type WalkStep,
} from "./station-run.js";
import { guideTourChanged } from "./visitor-guide-slice.js";

/**
 * How long a skip can be undone (K4 review R14): the framework's toast
 * linger (6 s), so it reads like every other transient message. Argued,
 * not measured: 3 s is about the time to read "Skipped X. Next: Y, 80 m"
 * (8 words at 4 words a second) and react; 10 s would hold the next
 * station's skip back that long. Reversed by a field test showing stray
 * skips noticed later than 6 s, or visitors waiting on the undo. The
 * note's window too. Here, not in the guide, which imports this slice.
 */
export const SKIP_UNDO_MS = DEFAULT_TOAST_LINGER_MS;

/** The last skip (K4 review R14): undoable until it settles. */
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
}

const initialVisitorWalkState: VisitorWalkState = {
  progress: null,
  lastSkip: null,
  note: null,
  quickArmedId: null,
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
/** The last skip was undone: the station is brought back. */
export const skipUndone = createAction<{
  readonly id: string;
  readonly atMs: number;
}>("visitorWalk/skipUndone");
/** The note goes (a story ended). */
export const noteCleared = createAction("visitorWalk/noteCleared");
/** The quick action asked for this station, or for none. */
export const quickArmed = createAction<string | null>("visitorWalk/quickArmed");
/** One guide call's changes, applied in order as one dispatch. */
export const walkBatched = createAction<readonly UnknownAction[]>(
  "visitorWalk/walkBatched",
);

/** The run's step, where its rule allows it; the same state otherwise. */
function stepped(state: VisitorWalkState, step: WalkStep): VisitorWalkState {
  if (state.progress === null) return state;
  const { progress } = applyWalkStep(state.progress, step);
  return progress === state.progress ? state : { ...state, progress };
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
      lastSkip: null,
      note: { kind: "brought-back", id, atMs },
    };
  }
  if (noteCleared.match(action)) {
    return state.note === null ? state : { ...state, note: null };
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

/** The note of what just happened while its moment lasts at `nowMs`
 *  (`SKIP_UNDO_MS`), else null. */
export function selectNote(state: WithWalk, nowMs: number): WalkNote | null {
  const note = state.visitorWalk.note;
  return note === null || nowMs >= note.atMs + SKIP_UNDO_MS ? null : note;
}
