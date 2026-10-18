/**
 * What the desktop editor warns about while a tour is marked "needs no
 * GPS" (QR-first M1b-2; tour editor plan 2026-10-17-1816 D9, review 2 #3).
 * Pure and page-free: the page shows the lines under the setting,
 * non-blocking.
 *
 * Whether the codes can place the tour is the VIEWER's rule
 * (`visitor-screen.ts` `tourCodesUsable`), reused rather than restated
 * (root CLAUDE.md DEC-H3): the flag holds only when it says yes.
 *
 * Stations are reached by their radius alone (D16) and carry no code of
 * their own (D9), so without location what can fail is the position: it is
 * the camera's odometry from the last code, and its drift grows with every
 * metre walked. A station farther than {@link NO_GPS_CODE_REACH_M} from
 * every code that can place the tour is named; this one line replaced the
 * per-station lines about code-less and unlockable stations.
 *
 * @see no-gps-check.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { tourCodesUsable } from "../visitor-screen.js";
import { stationTitle } from "../station-run.js";
import { isLockableLevel } from "../scan-gate.js";
import { horizontalM } from "../move-with-code.js";
import { CODE_EVENT_REACH_M } from "../visit-settle.js";

/**
 * How far a station may be from the nearest placing code before the
 * editor warns: the reach a code event has for the notes walked from it
 * (`visit-settle.ts`, 40 m walked), the same drift argument (DEC-H3).
 */
export const NO_GPS_CODE_REACH_M = CODE_EVENT_REACH_M;

export interface NoGpsCheck {
  /** The stations farther than {@link NO_GPS_CODE_REACH_M} from every code
   *  that can place the tour - or with no spot of their own (never reached,
   *  D9) - by their names in the rail, in the story's order. */
  readonly farFromCodes: readonly string[];
  /** One of the tour's codes can place it - else the flag does not hold
   *  and visitors are asked for their location anyway. */
  readonly codesPlace: boolean;
}

export function checkNoGps(input: {
  readonly stations: readonly TourStation[];
  readonly levels: ReadonlyMap<string, QrLevel>;
}): NoGpsCheck {
  // A code places the tour only with a printed size and a position: the
  // viewer's own lockability rule (`scan-gate.ts`).
  const anchors = [...input.levels.values()].flatMap((level) =>
    isLockableLevel(level) && level.qr.geo !== undefined ? [level.qr.geo] : [],
  );
  const far = (station: TourStation): boolean => {
    const at = station.anchor.geo;
    if (at === undefined) return true;
    return anchors.every((code) => horizontalM(code, at) > NO_GPS_CODE_REACH_M);
  };
  return {
    farFromCodes: input.stations.flatMap((station, index) =>
      far(station) ? [stationTitle(station, index + 1)] : [],
    ),
    // The editor's levels were read whole at the open (a failed read
    // refuses the open, `editor-open.ts`), so never "unreadable" here.
    codesPlace: tourCodesUsable(input.levels, false) === true,
  };
}

/** "a", "a and b", "a, b and c" - each name in quotes. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
}

/**
 * The warnings' lines, plain words, none for a tour with nothing to say.
 * When no code can place the tour that is the only line: visitors are then
 * asked for their location, so GPS reaches every station and a line about
 * the others would describe a tour that never runs.
 */
export function noGpsWarnings(check: NoGpsCheck): string[] {
  if (!check.codesPlace) {
    return [
      "None of this tour's printed codes can place it (a code needs its printed size and a measured position), so visitors will be asked for their location anyway.",
    ];
  }
  const n = check.farFromCodes.length;
  if (n === 0) return [];
  const [is, them] =
    n === 1 ? ["1 station is", "it"] : [`${String(n)} stations are`, "them"];
  return [
    `${is} farther than ${String(NO_GPS_CODE_REACH_M)} m from every printed code: ${quotedList(check.farFromCodes)}. Without location, the position drifts with every metre walked from the last code, so visitors may not reach ${them}. A code near ${them}, or asking for location, fixes this.`,
  ];
}
