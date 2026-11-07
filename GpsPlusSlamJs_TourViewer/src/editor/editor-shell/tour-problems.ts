/**
 * The tour's problems, as the editor's bottom panel lists them (its
 * Problems tab and the badge on its toggle): grouped by station, in the
 * tour's order, the worst first within a station. An item outside its
 * station's circle is a warning (a visitor at the station never finds
 * it); a station with nothing in it is a note. A problem one click can
 * mend carries its fix: an outside item is moved inside, along its line.
 *
 * @see tour-problems.ts.md
 */
import { isTourStory } from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { objectTitle } from "../../object-describe.js";
import { isPlayableInK4 } from "../../scene-player.js";
import { stationTitle } from "../../station-run.js";
import { worldBlocks, type WorldBlock } from "../../tour-document.js";
import type { GestureEdit } from "../../editor3d/gesture.js";
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
  /** The one-click mend, where there is one. */
  readonly fix?: ProblemFix;
}

/** The ground's height at a place as the view has it loaded, or null. */
type GroundAt = (place: {
  readonly lat: number;
  readonly lon: number;
}) => number | null;

/** A one-click mend: the row's link, the edit the page writes (one undo
 *  step; made on the click, not on each draw, with the ground as loaded
 *  then) and what it says once written. */
export interface ProblemFix {
  readonly label: string;
  readonly edit: (
    groundAt?: GroundAt,
  ) => Extract<GestureEdit, { kind: "item-pose" }>;
  readonly done: string;
}

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

/** How far (m, along the ground) an item stands from its station's
 *  centre: the station frame's north and east. */
function groundDistanceM(item: WorldBlock): number {
  return Math.hypot(item.pose.position[0], item.pose.position[2]);
}

/** The station's items standing outside its circle (farther from its
 *  centre along the ground than `foundRadiusM`; on the circle is
 *  inside). The inspector's "outside" count is this rule too. */
export function outsideItems(
  station: Pick<TourStation, "children" | "foundRadiusM">,
): WorldBlock[] {
  return worldBlocks(station).filter(
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
  item: WorldBlock,
  groundAt: GroundAt | undefined,
): Extract<GestureEdit, { kind: "item-pose" }> {
  const r = station.foundRadiusM;
  const to = r > 2 * INSIDE_BY_M ? r - INSIDE_BY_M : r / 2;
  const scale = to / groundDistanceM(item);
  const [north, up, east] = item.pose.position;
  const position: [number, number, number] = [north * scale, up, east * scale];
  const geo = itemGeoPose({ ...item.pose, position }, station.geo);
  const was = itemGeoPose(item.pose, station.geo);
  const groundWas = groundOf(groundAt, was);
  const groundNow = groundOf(groundAt, geo);
  return {
    kind: "item-pose",
    id: item.id,
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
      who: objectTitle(item),
      select: item.id,
      fix: {
        label: "Move inside",
        edit: (groundAt) => moveInside(station, item, groundAt),
        done: `Moved "${objectTitle(item)}" inside its station's circle`,
      },
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
  return station.children.some(
    (child) => !isTourStory(child) || child.children.some(isPlayableInK4),
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
