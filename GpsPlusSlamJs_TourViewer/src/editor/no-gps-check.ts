/**
 * What the desktop editor warns about while a tour is marked "needs no
 * GPS" (QR-first M1b-2; owner decisions Q-QF-1 and "code-less stations
 * without location", plan 2026-10-14-0445 §8). Pure and page-free: the
 * page shows the lines under the setting, non-blocking.
 *
 * Whether the codes can place the tour is the VIEWER's rule
 * (`visitor-screen.ts` `tourCodesUsable`), reused rather than restated
 * (root CLAUDE.md DEC-H3): the flag holds only when it says yes.
 *
 * @see no-gps-check.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { tourCodesUsable } from "../visitor-screen.js";
import { stationTitle } from "./editor-model.js";

export interface NoGpsCheck {
  /** The stations without a printed code (`anchor.code` absent), by
   *  their names in the rail, in the story's order. */
  readonly codeless: readonly string[];
  /** One of the tour's codes can place it - else the flag does not hold
   *  and visitors are asked for their location anyway. */
  readonly codesPlace: boolean;
}

export function checkNoGps(input: {
  readonly stations: readonly TourStation[];
  readonly levels: ReadonlyMap<string, QrLevel>;
}): NoGpsCheck {
  return {
    codeless: input.stations.flatMap((station, index) =>
      station.anchor.code === undefined
        ? [stationTitle(station, index + 1)]
        : [],
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
 * asked for their location, so GPS reaches the code-less stations and a
 * line about them would describe a tour that never runs.
 */
export function noGpsWarnings(check: NoGpsCheck): string[] {
  if (!check.codesPlace) {
    return [
      "None of this tour's printed codes can place it (a code needs its printed size and a measured position), so visitors will be asked for their location anyway.",
    ];
  }
  const n = check.codeless.length;
  if (n === 0) return [];
  const [has, them] =
    n === 1 ? ["1 station has", "it"] : [`${String(n)} stations have`, "them"];
  return [
    `${has} no printed code: ${quotedList(check.codeless)}. Without location, visitors reach ${them} only by tapping "I'm here - play the story" once they stand there.`,
  ];
}
