/**
 * The tour's problems, as the editor's bottom panel lists them (its
 * Problems tab and the badge on its toggle): grouped by station, in the
 * tour's order, the worst first within a station. An item outside its
 * station's circle is a warning (a visitor at the station never finds
 * it); a station with nothing in it is a note.
 *
 * @see tour-problems.ts.md
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { objectTitle } from "../../object-describe.js";
import { stationTitle } from "../../station-run.js";
import { worldBlocks, type WorldBlock } from "../../tour-document.js";
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
  station: Pick<TourStation, "blocks" | "steps" | "foundRadiusM">,
): WorldBlock[] {
  return worldBlocks(station).filter(
    (item) => groundDistanceM(item) > station.foundRadiusM,
  );
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
    }));
    if (station.blocks.length === 0) {
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
