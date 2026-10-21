/**
 * The visitor's sheet in AR, as data (visitor walk W4 build plan
 * 2026-10-21-1105, M2, §1.5, §1.6, §1.8): the peek (today's station line
 * split into eyebrow, title, distance and tail), the segments, the story
 * card's place, the list (header, progress line, completion card, a row
 * per station) and the away block on the start page. Pure: it reads the
 * walk (`visitorWalk`'s progress), the guide's view (`station-guide.ts`
 * `GuideView`: the station in focus, the position's kind, the distances)
 * and the sheet's state; `walk-sheet.ts` writes it to the page.
 *
 * Every text is today's (kept) or W4's, as the plan names them; M2 keeps
 * today's rules, so nothing here decides what the walk offers.
 *
 * @see walk-sheet-model.ts.md
 */

import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { formatDistance } from "gps-plus-slam-app-framework/utils/format-distance";

import { completionLine, type GuideView } from "./station-guide.js";
import {
  stationTitle,
  walkOffered,
  walkStatus,
  type WalkProgress,
} from "./station-run.js";
import type { WalkSheet } from "./visitor-walk-slice.js";

/**
 * Above this many stations the segments give way to one continuous bar
 * with the counts (W4 build plan §5): each segment stays at least 3 px
 * wide with 4 px gaps inside the narrowest sheet, a 360 px phone with
 * 16 px side padding (328 px: 47 x 3 + 46 x 4 = 325). The landscape card
 * (370 px less 32) holds 48. Reversed by a measurement on a narrower
 * phone, or by a phone test finding 3 px too thin to read.
 */
export const WALK_SEGMENT_LIMIT = 47;

/** A station's look in the segments, the rows and (M3) the radar. */
type WalkRowState = "next" | "left" | "found" | "here" | "skipped" | "later";

export interface WalkSheetInput {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
  /** The tour's title (its manifest), for the list's header. */
  readonly tourTitle: string;
  readonly progress: WalkProgress;
  readonly view: GuideView;
  /** The story playing, or null. */
  readonly story: { readonly stationId: string } | null;
  readonly sheet: WalkSheet;
}

interface WalkPeek {
  /** `walk`: a station to find; `none`: several offered and nothing
   *  vouches for the position; `story`: nothing unfound offered while a
   *  story plays; `complete`. */
  readonly kind: "walk" | "none" | "story" | "complete";
  readonly eyebrow: string;
  readonly title: string;
  /** "N m", only while the line shows a distance. */
  readonly distance: string | null;
  readonly tail: string;
}

export type WalkSegments =
  | { readonly kind: "each"; readonly states: readonly WalkRowState[] }
  | {
      readonly kind: "bar";
      readonly found: number;
      readonly skipped: number;
      readonly toFind: number;
    };

export interface WalkRow {
  readonly id: string;
  /** Its 1-based place in the tour. */
  readonly number: number;
  readonly title: string;
  readonly state: WalkRowState;
  readonly sub: string;
}

export interface WalkSheetModel {
  readonly peek: WalkPeek;
  /** The story card in the peek's place (a story plays, the list closed). */
  readonly storyCard: { readonly title: string } | null;
  readonly segments: WalkSegments;
  readonly grabLabel: string;
  readonly list: {
    readonly title: string;
    readonly chip: string;
    /** "N of M found" (bold), then the other parts, zero ones left out. */
    readonly progress: { readonly lead: string; readonly rest: string[] };
    readonly completion: {
      readonly title: string;
      readonly text: string;
    } | null;
    readonly rows: readonly WalkRow[];
  };
}

const WAITING = "Waiting for your position…";
const NO_PRECISION_TAIL =
  "Scan one of the tour's codes so the guide knows where you are.";

/** Whole metres, as the line writes them. */
function distanceText(m: number): string {
  return formatDistance(m, { metreDecimals: 0 });
}

/** Whether the visitor has progress to keep (§1.8): a station found, done
 *  or skipped. */
export function walkHasProgress(progress: WalkProgress | null): boolean {
  return (
    progress !== null &&
    progress.stations.some((s) => s.state !== "waiting" || s.skipped)
  );
}

/** The stations the list shows, in tour order: all of them, except under
 *  branch order, where the path decides (the stations offered so far and
 *  the current one; a station the path may never reach is not promised). */
function listed(
  stations: readonly TourStation[],
  progress: WalkProgress,
): { station: TourStation; number: number }[] {
  const offered = new Set(walkOffered(progress));
  return stations
    .map((station, i) => ({ station, number: i + 1 }))
    .filter(({ station }) => {
      if (progress.order !== "branch") return true;
      const status = walkStatus(progress, station.id);
      return (
        offered.has(station.id) ||
        (status !== undefined && (status.state !== "waiting" || status.skipped))
      );
    });
}

/** A station's look: the walk's state, and the focus among the offered. */
function rowState(
  progress: WalkProgress,
  id: string,
  focusId: string | null,
  offered: ReadonlySet<string>,
): WalkRowState {
  const status = walkStatus(progress, id);
  if (status?.skipped === true) return "skipped";
  if (status?.state === "found") return "here";
  if (status?.state === "done") return "found";
  if (!offered.has(id)) return "later";
  return id === focusId ? "next" : "left";
}

function counts(progress: WalkProgress): {
  found: number;
  skipped: number;
  total: number;
} {
  const skipped = progress.stations.filter((s) => s.skipped).length;
  const found = progress.stations.filter(
    (s) => s.state !== "waiting" && !s.skipped,
  ).length;
  return { found, skipped, total: progress.stations.length };
}

function segmentsOf(states: readonly WalkRowState[]): WalkSegments {
  if (states.length <= WALK_SEGMENT_LIMIT) return { kind: "each", states };
  const found = states.filter((s) => s === "found" || s === "here").length;
  const skipped = states.filter((s) => s === "skipped").length;
  return {
    kind: "bar",
    found,
    skipped,
    toFind: states.length - found - skipped,
  };
}

function rowSub(state: WalkRowState, view: GuideView, id: string): string {
  switch (state) {
    case "found":
      return "Found";
    case "here":
      return "You are here - its story is playing";
    case "skipped":
      return "Skipped";
    case "later":
      return "Later";
    case "next":
    case "left": {
      // No "~N m" anywhere (§1.9 R-0): too weak shows no distance either.
      if (view.position === "none" || view.position === "weak") {
        return "Distance unknown";
      }
      const d = view.distances.get(id);
      return view.position === "pending" || d === undefined
        ? WAITING
        : distanceText(d);
    }
  }
}

function peekOf(
  input: WalkSheetInput,
  offered: readonly string[],
  byId: ReadonlyMap<string, TourStation>,
): WalkPeek {
  const { progress, view } = input;
  if (offered.length === 0) {
    const { skipped } = counts(progress);
    return {
      kind: "complete",
      eyebrow: input.tourTitle,
      title: "Tour complete",
      distance: null,
      tail:
        skipped > 0
          ? `${String(skipped)} skipped.`
          : input.order === "branch"
            ? "You reached the end of your path."
            : "Every station visited.",
    };
  }
  const focus = view.focusId === null ? undefined : byId.get(view.focusId);
  if (focus === undefined) {
    const playing =
      input.story === null ? undefined : byId.get(input.story.stationId);
    const found =
      playing ??
      byId.get(
        offered.find((id) => walkStatus(progress, id)?.state === "found") ?? "",
      );
    return {
      kind: "story",
      eyebrow: "Station found",
      title: found === undefined ? "" : stationTitle(found),
      distance: null,
      tail: "Its story is playing.",
    };
  }
  const several = offered.length > 1;
  if (view.position === "none" && several && input.order === "any") {
    return {
      kind: "none",
      eyebrow: "Position unknown",
      title: `${String(offered.length)} stations to find`,
      distance: null,
      tail: NO_PRECISION_TAIL,
    };
  }
  const number = input.stations.findIndex((s) => s.id === focus.id) + 1;
  const eyebrow =
    input.order === "fixed"
      ? `Next - station ${String(number)} of ${String(input.stations.length)}`
      : several
        ? `${String(offered.length)} stations to find - nearest`
        : "Next";
  const d = view.distances.get(focus.id);
  const tail =
    view.position === "pending"
      ? WAITING
      : view.position === "weak"
        ? `GPS too weak to guide you (±${distanceText(view.accuracyM ?? 0)}); step into the open.`
        : view.position === "none"
          ? NO_PRECISION_TAIL
          : "";
  return {
    kind: "walk",
    eyebrow,
    title: stationTitle(focus),
    distance:
      view.position === "distance" && d !== undefined ? distanceText(d) : null,
    tail,
  };
}

function progressLine(
  order: TourOrder,
  progress: WalkProgress,
): { lead: string; rest: string[] } {
  const { found, skipped, total } = counts(progress);
  const left = total - found - skipped;
  const skippedPart = skipped > 0 ? [`${String(skipped)} skipped`] : [];
  // Under branch order the path decides how many there are.
  if (order === "branch") {
    return { lead: `${String(found)} found`, rest: skippedPart };
  }
  return {
    lead: `${String(found)} of ${String(total)} found`,
    rest: [...skippedPart, ...(left > 0 ? [`${String(left)} to find`] : [])],
  };
}

function completionOf(
  order: TourOrder,
  progress: WalkProgress,
): { title: string; text: string } {
  const { found, skipped, total } = counts(progress);
  // "A skipped station can still be brought back." (W4) waits for M4's
  // bring back at any time; until then it would be false after 6 s.
  return {
    title: completionLine(order, skipped),
    text:
      skipped > 0 && order !== "branch"
        ? `${String(found)} of ${String(total)} found.`
        : "Thank you for walking with us.",
  };
}

const CHIPS: Record<TourOrder, string> = {
  any: "Any order",
  fixed: "In order",
  branch: "Your path",
};

/** The sheet, from the walk, the guide's view and the sheet's state. */
export function walkSheetModel(input: WalkSheetInput): WalkSheetModel {
  const { progress, view } = input;
  const offeredList = walkOffered(progress);
  const offered = new Set(offeredList);
  const byId = new Map(input.stations.map((s) => [s.id, s]));
  const shown = listed(input.stations, progress);
  const rows = shown.map(({ station, number }): WalkRow => {
    const state = rowState(progress, station.id, view.focusId, offered);
    return {
      id: station.id,
      number,
      title: stationTitle(station, number),
      state,
      sub: rowSub(state, view, station.id),
    };
  });
  const playing =
    input.story === null ? undefined : byId.get(input.story.stationId);
  return {
    peek: peekOf(input, offeredList, byId),
    storyCard:
      playing !== undefined && input.sheet === "peek"
        ? { title: stationTitle(playing) }
        : null,
    segments: segmentsOf(rows.map((r) => r.state)),
    grabLabel: input.sheet === "list" ? "Hide the list" : "Show all stations",
    list: {
      title: input.tourTitle,
      chip: CHIPS[input.order],
      progress: progressLine(input.order, progress),
      completion:
        offeredList.length === 0 ? completionOf(input.order, progress) : null,
      rows,
    },
  };
}

export interface AwayModel {
  readonly text: string;
  readonly segments: WalkSegments;
  readonly rows: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "Found" | "Skipped" | "To find";
  }[];
}

/** The away block on the start page (§1.8): read-only, no focus. */
export function awayModel(input: {
  readonly stations: readonly TourStation[];
  readonly order: TourOrder;
  readonly progress: WalkProgress;
}): AwayModel {
  const offered = new Set(walkOffered(input.progress));
  const shown = listed(input.stations, input.progress);
  const states = shown.map(({ station }) =>
    rowState(input.progress, station.id, null, offered),
  );
  return {
    // By decision (§1.8): W4's "stays on this phone" is false today -
    // progress lives with the open tour and goes with a reload (K3).
    text: "You left AR. Your progress is kept while this page is open.",
    segments: segmentsOf(states),
    rows: shown.map(({ station, number }, i) => {
      const state = states[i]!;
      return {
        id: station.id,
        title: stationTitle(station, number),
        status:
          state === "found" || state === "here"
            ? "Found"
            : state === "skipped"
              ? "Skipped"
              : "To find",
      };
    }),
  };
}
