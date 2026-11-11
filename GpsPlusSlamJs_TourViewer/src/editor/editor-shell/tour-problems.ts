/**
 * The tour's problems, as the editor's bottom panel lists them (its
 * Problems tab and the badge on its toggle): grouped by station, in the
 * tour's order, the worst first within a station. An item outside its
 * station's circle is a warning (a visitor at the station never finds
 * it), judged where it stands (`placement/placeables.ts`: through its
 * folders); a station with nothing in it is a note. A problem one click can
 * mend carries its fixes: an outside item is moved inside, along its
 * line, or given a station of its own where it stands.
 *
 * @see tour-problems.ts.md
 */
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { isStory } from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { objectTitle } from "../../object-describe.js";
import { isPlayableInK4 } from "../../scene-player.js";
import { stationTitle } from "../../station-run.js";
import type { PlaceEdit } from "../../placement/place-edits.js";
import { posedEntries, type PosedBlock } from "../../placement/placeables.js";
import { STATION_PREFIX } from "../editor-model.js";

export type ProblemSeverity = "error" | "warning" | "note";

/** One problem: what it is, whose it is, and what a click selects. */
interface TourProblem {
  readonly severity: ProblemSeverity;
  readonly what: string;
  /** The item's or the station's title. */
  readonly who: string;
  /** The selection a click on the row makes (`station:<id>` or an
   *  item's id). */
  readonly select: string;
  /** The one-click mends, where there are any. */
  readonly fixes?: readonly ProblemFix[];
}

/** The ground's height at a place as the view has it loaded, or null. */
type GroundAt = (place: {
  readonly lat: number;
  readonly lon: number;
}) => number | null;

/** A one-click mend: the row's link and what it does - an edit the page
 *  writes (one undo step; made on the click, not on each draw, with the
 *  ground as loaded then), saying `done` once written, or the page's own
 *  "Move to a new station", which says its own outcome. */
export type ProblemFix =
  | {
      readonly label: string;
      readonly edit: (
        groundAt?: GroundAt,
      ) => Extract<PlaceEdit, { kind: "pose" }>;
      readonly done: string;
    }
  | { readonly label: string; readonly split: true };

/** A station's problems, with its place in the tour (1-based). */
export interface ProblemGroup {
  readonly stationId: string;
  readonly number: number;
  readonly title: string;
  readonly problems: readonly TourProblem[];
}

const SEVERITY_ORDER: Readonly<Record<ProblemSeverity, number>> = {
  error: 0,
  warning: 1,
  note: 2,
};

/** Where a posed block stands in its station's frame (its folders
 *  composed). */
function inStationOf(item: PosedBlock) {
  return item.place.inStation ?? item.block.pose;
}

/** How far (m, along the ground) an item stands from its station's
 *  centre: the station frame's north and east. */
function groundDistanceM(item: PosedBlock): number {
  const [north, , east] = inStationOf(item).position;
  return Math.hypot(north, east);
}

/** The station's items standing in the world outside its circle
 *  (farther from its centre along the ground than `foundRadiusM`; on the
 *  circle is inside). The inspector's "outside" count is this rule too. */
export function outsideItems(station: TourStation): PosedBlock[] {
  return posedEntries(station).filter(
    (item) => groundDistanceM(item) > station.foundRadiusM,
  );
}

/** How far in (m) "Move inside" leaves an item from the circle's edge;
 *  a circle of twice this or less takes it halfway to the centre. */
const INSIDE_BY_M = 4;

/** A ground height `groundAt` gives at `place`, or null for none or one
 *  that is not a number. */
function groundOf(
  groundAt: GroundAt | undefined,
  place: { readonly lat: number; readonly lon: number },
): number | null {
  const m = groundAt?.({ lat: place.lat, lon: place.lon }) ?? null;
  return m !== null && Number.isFinite(m) ? m : null;
}

/** The pose edit that moves `item` (outside) inside `station`'s circle
 *  along the line it stands on, its heading kept. Its height over the
 *  ground is kept where `groundAt` has the ground at both spots (a long
 *  move on a slope would otherwise float or bury it); else its height in
 *  the station's frame. */
function moveInside(
  station: TourStation,
  item: PosedBlock,
  groundAt: GroundAt | undefined,
): Extract<PlaceEdit, { kind: "pose" }> {
  const r = station.foundRadiusM;
  const to = r > 2 * INSIDE_BY_M ? r - INSIDE_BY_M : r / 2;
  const scale = to / groundDistanceM(item);
  const pose = inStationOf(item);
  const [north, up, east] = pose.position;
  const position: [number, number, number] = [north * scale, up, east * scale];
  const geo = itemGeoPose({ ...pose, position }, station.geo);
  const was = item.place.geo;
  const groundWas = groundOf(groundAt, was);
  const groundNow = groundOf(groundAt, geo);
  return {
    kind: "pose",
    ref: item.place.ref,
    geo:
      groundWas === null || groundNow === null
        ? geo
        : { ...geo, alt: was.alt - groundWas + groundNow },
  };
}

/** The tour's problems, one group per station that has any. */
export function tourProblems(stations: readonly TourStation[]): ProblemGroup[] {
  const groups: ProblemGroup[] = [];
  for (const [index, station] of stations.entries()) {
    const title = stationTitle(station, index + 1);
    const problems: TourProblem[] = outsideItems(station).map((item) => ({
      severity: "warning",
      what: `Outside its station's circle (${String(
        Math.round(groundDistanceM(item)),
      )} m from the centre, circle ${String(
        Math.round(station.foundRadiusM),
      )} m)`,
      who: objectTitle(item.block),
      select: item.place.selection,
      fixes: [
        {
          label: "Move inside",
          edit: (groundAt) => moveInside(station, item, groundAt),
          done: `Moved "${objectTitle(item.block)}" inside its station's circle`,
        },
        { label: "Move to a new station", split: true },
      ],
    }));
    if (!hasContent(station)) {
      problems.push({
        severity: "note",
        what: "Has no content yet",
        who: title,
        select: `${STATION_PREFIX}${station.id}`,
      });
    }
    if (problems.length === 0) continue;
    problems.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    groups.push({ stationId: station.id, number: index + 1, title, problems });
  }
  return groups;
}

/** Whether a visitor meets anything at the station: a free block, or a
 *  story with a child that plays (a choice is content too, and holds no
 *  block; a quiz does not play yet). */
function hasContent(station: TourStation): boolean {
  return (
    tourFreeBlocks(station).length > 0 ||
    station.children.some(
      (child) => isStory(child) && child.children.some(isPlayableInK4),
    )
  );
}

/** The problems of `groups` counted by severity. */
export function problemCounts(
  groups: readonly ProblemGroup[],
): Record<ProblemSeverity, number> {
  const counts: Record<ProblemSeverity, number> = {
    error: 0,
    warning: 0,
    note: 0,
  };
  for (const group of groups) {
    for (const problem of group.problems) counts[problem.severity] += 1;
  }
  return counts;
}
