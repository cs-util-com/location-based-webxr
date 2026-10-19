/**
 * The visitor's guide state in the page's store (visitor plan
 * 2026-10-18-2349 §3 "State in Redux", cold review MEDIUM-4; root CLAUDE.md,
 * the Redux rule): the ONE station whose content shows
 * (`presentStationId`) and the "show all stations' content" override
 * (`showAllContent`). Its reducer applies the pure presence rule
 * (`station-presence.ts`), so every view reads one answer; the station
 * guide (`station-guide.ts`) dispatches a judged position only when the
 * answer changes. three.js handles (per-station groups, textures) never
 * live here: the page keeps them in a side table keyed by station id.
 *
 * Not recorded: no `visitorGuide/*` action is among the page's persisted
 * prefixes (`tour-viewer-session.ts`), so a dispatch from the store's
 * subscriber does not reorder a recording.
 *
 * @see visitor-guide-slice.ts.md
 */

import {
  createSlice,
  type PayloadAction,
  type UnknownAction,
} from "@reduxjs/toolkit";

import {
  nextPresentStation,
  takeoverMarginM,
  type PresenceCandidate,
} from "./station-presence.js";

export interface VisitorGuideState {
  /** The station whose content shows; null: none (no station's found
   *  radius holds the visitor, or no AR session). */
  readonly presentStationId: string | null;
  /** Every station's content shows, whatever the presence (§3: a switch on
   *  the visitor page, a URL flag for tests). Off by default; a new tour
   *  starts with it off. */
  readonly showAllContent: boolean;
}

/** One judged position, as presence reads it: every station's candidate
 *  (null: nothing may be judged, presence holds) and the judged accuracy
 *  (null for a position a code lined up), which sets the margin. */
export interface PresenceJudgement {
  readonly candidates: readonly PresenceCandidate[] | null;
  readonly accuracyM: number | null;
}

const initialVisitorGuideState: VisitorGuideState = {
  presentStationId: null,
  showAllContent: false,
};

/** The present station after a judgement: the reducer's rule, for the
 *  guide's dispatch-on-change check. */
export function presenceAfter(
  state: VisitorGuideState,
  judgement: PresenceJudgement,
): string | null {
  return nextPresentStation(
    state.presentStationId,
    judgement.candidates,
    takeoverMarginM(judgement.accuracyM),
  );
}

const visitorGuideSlice = createSlice({
  name: "visitorGuide",
  initialState: initialVisitorGuideState,
  reducers: {
    /** A judged position (`station-guide.ts`'s one gate). */
    presenceJudged(state, action: PayloadAction<PresenceJudgement>) {
      state.presentStationId = presenceAfter(state, action.payload);
    },
    /** The AR session ended: nothing is present until the next. */
    presenceCleared(state) {
      state.presentStationId = null;
    },
    /** Another tour (or none): its presence and its override start anew. */
    guideTourChanged() {
      return initialVisitorGuideState;
    },
    showAllContentSet(state, action: PayloadAction<boolean>) {
      state.showAllContent = action.payload;
    },
  },
});

export const visitorGuideReducer = visitorGuideSlice.reducer;
export const {
  presenceJudged,
  presenceCleared,
  guideTourChanged,
  showAllContentSet,
} = visitorGuideSlice.actions;

/** What the guide needs of the page's store. */
export interface VisitorGuideStore {
  getState(): { readonly visitorGuide: VisitorGuideState };
  dispatch(action: UnknownAction): unknown;
}

type WithGuide = { readonly visitorGuide: VisitorGuideState };

export function selectPresentStationId(state: WithGuide): string | null {
  return state.visitorGuide.presentStationId;
}

export function selectShowAllContent(state: WithGuide): boolean {
  return state.visitorGuide.showAllContent;
}

/** Whether a station's content shows: it is present, or all are. */
export function selectStationContentShown(
  state: WithGuide,
  stationId: string,
): boolean {
  return (
    state.visitorGuide.showAllContent ||
    state.visitorGuide.presentStationId === stationId
  );
}
