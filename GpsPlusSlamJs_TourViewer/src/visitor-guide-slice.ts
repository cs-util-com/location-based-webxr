/**
 * The visitor's guide state in the page's store (visitor plan
 * 2026-10-18-2349 §3 "State in Redux", cold review MEDIUM-4; root CLAUDE.md,
 * the Redux rule): the ONE station whose content shows
 * (`presentStationId`), the "show all stations' content" override
 * (`showAllContent`), and whether the guide waits for a heading
 * (`headingPending`, D34 of the tour editor plan 2026-10-17-1816: the
 * visitor's status line then asks for a few steps), and what the walk's
 * precision chip and radar show (`precisionKind` from the guide,
 * `trackingLost` from the readiness phase; visitor walk W4 build plan
 * 2026-10-21-1105, M3, §1.3). Its reducer applies the pure presence rule
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

import type { PositionPrecision } from "gps-plus-slam-app-framework/state/position-precision";

import {
  nextPresentStation,
  presentAfterWeakFix,
  takeoverMarginM,
  type PresenceCandidate,
} from "./station-presence.js";

/** The position's precision as the guide judges it (W4 build plan §1.3):
 *  no position this tick (`pending`), a code's, GPS within the ceiling,
 *  GPS above it (`weak`), or nothing vouching for it (`none`). */
export type WalkPrecisionKind = "pending" | "code" | "gps" | "weak" | "none";

/** What the precision chip and the radar show: the precision, or
 *  tracking lost over any precision. */
export type WalkChipKind = WalkPrecisionKind | "lost";

export interface VisitorGuideState {
  /** The station whose content shows; null: none (no station's found
   *  radius holds the visitor, or no AR session). */
  readonly presentStationId: string | null;
  /** Every station's content shows, whatever the presence (§3: a switch on
   *  the visitor page, a URL flag for tests). Off by default; a new tour
   *  starts with it off. */
  readonly showAllContent: boolean;
  /** The guide has stations to point at and no heading yet this AR entry
   *  (`station-guide.ts` `headingReady`): the arrows, the breadcrumbs
   *  and a story's figure wait, and the visitor's line says to walk a few
   *  steps (D34). False outside a running guide. */
  readonly headingPending: boolean;
  /** The position's precision kind (`station-guide.ts`, published only
   *  on a change); `pending` outside a running guide. */
  readonly precisionKind: WalkPrecisionKind;
  /** The AR tracking is lost (`ar-entry.ts` `renderArStatus`, from the
   *  readiness phase `ar-lost`, published only on a change). */
  readonly trackingLost: boolean;
}

/** One judged position, as presence reads it: every station's candidate
 *  (null: nothing may be judged, presence holds) and the position's
 *  precision (`gps-plus-slam-app-framework/state/position-precision`),
 *  which sets the margin (`takeoverMarginM`). A GPS position too weak to
 *  guide by only ends presence (`presentAfterWeakFix`); nothing to judge
 *  by (`'none'`) holds it. */
export interface PresenceJudgement {
  readonly candidates: readonly PresenceCandidate[] | null;
  readonly precision: PositionPrecision;
}

const initialVisitorGuideState: VisitorGuideState = {
  presentStationId: null,
  showAllContent: false,
  headingPending: false,
  precisionKind: "pending",
  trackingLost: false,
};

/** The present station after a judgement: the reducer's rule, for the
 *  guide's dispatch-on-change check. */
export function presenceAfter(
  state: VisitorGuideState,
  judgement: PresenceJudgement,
): string | null {
  const { precision } = judgement;
  // `tooWeak` on 'none' is a fail-safe, not a GPS verdict: nothing to
  // judge by holds, as no position does.
  if (precision.source === "none") return state.presentStationId;
  if (precision.tooWeak) {
    return precision.accuracyM === null
      ? state.presentStationId
      : presentAfterWeakFix(
          state.presentStationId,
          judgement.candidates,
          precision.accuracyM,
        );
  }
  return nextPresentStation(
    state.presentStationId,
    judgement.candidates,
    takeoverMarginM(precision),
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
    /** The guide started or stopped waiting for a heading (D34). */
    headingPendingSet(state, action: PayloadAction<boolean>) {
      state.headingPending = action.payload;
    },
    /** The guide's judged precision changed (W4 build plan M3). */
    precisionKindSet(state, action: PayloadAction<WalkPrecisionKind>) {
      state.precisionKind = action.payload;
    },
    /** The AR tracking was lost or came back (W4 build plan M3). */
    trackingLostSet(state, action: PayloadAction<boolean>) {
      state.trackingLost = action.payload;
    },
  },
});

export const visitorGuideReducer = visitorGuideSlice.reducer;
export const {
  presenceJudged,
  presenceCleared,
  guideTourChanged,
  showAllContentSet,
  headingPendingSet,
  precisionKindSet,
  trackingLostSet,
} = visitorGuideSlice.actions;

/** The test switch `?allstations=1`: the page starts with every station's
 *  content shown (`showAllContent`). Only the exact value `1` counts. */
export function showAllStationsFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("allstations") === "1";
}

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

/** Whether the guide waits for a heading (D34). */
export function selectHeadingPending(state: WithGuide): boolean {
  return state.visitorGuide.headingPending;
}

/** The guide's judged precision kind (W4 build plan M3). */
export function selectPrecisionKind(state: WithGuide): WalkPrecisionKind {
  return state.visitorGuide.precisionKind;
}

/** What the chip and the radar show: tracking lost over any precision. */
export function selectWalkChipKind(state: WithGuide): WalkChipKind {
  return state.visitorGuide.trackingLost
    ? "lost"
    : state.visitorGuide.precisionKind;
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
