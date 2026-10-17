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
 * A station on a code the viewer can never lock is a second case (M1b-2
 * milestone review #2): the tracker never solves a code without a printed
 * size (`qr-tracking-controller.ts`; the Tour Viewer passes no
 * `resolveSizeM`), a station with a code is found only on that code's lock
 * (`station-run.ts` `codeLocked`), and "I'm here" is refused for it
 * (`station-guide.ts` `hereOffered`). Without location such a station can
 * only be skipped. A code with a size and no position still locks, and
 * finds its station, so the test is "no size, or not in the tour" - not
 * the whole-tour `isLockableLevel`.
 *
 * @see no-gps-check.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { tourCodesUsable } from "../visitor-screen.js";
import { stationTitle } from "../station-run.js";

export interface NoGpsCheck {
  /** The stations without a printed code (`anchor.code` absent), by
   *  their names in the rail, in the story's order. */
  readonly codeless: readonly string[];
  /** The stations on a code the viewer can never lock: the tour does not
   *  carry it, or it has no printed size. Same naming and order. */
  readonly unlockable: readonly string[];
  /** One of the tour's codes can place it - else the flag does not hold
   *  and visitors are asked for their location anyway. */
  readonly codesPlace: boolean;
}

export function checkNoGps(input: {
  readonly stations: readonly TourStation[];
  readonly levels: ReadonlyMap<string, QrLevel>;
}): NoGpsCheck {
  const named = (keep: (station: TourStation) => boolean): string[] =>
    input.stations.flatMap((station, index) =>
      keep(station) ? [stationTitle(station, index + 1)] : [],
    );
  return {
    codeless: named((station) => station.anchor.code === undefined),
    // The level parser refuses a size that is not a positive number
    // (`qr-level.ts`), so a present size is a usable one.
    unlockable: named((station) => {
      const code = station.anchor.code;
      if (code === undefined) return false;
      return input.levels.get(code)?.qr.physicalSizeM === undefined;
    }),
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

/** "1 station has" / "3 stations have", and "it" / "them". */
function counted(n: number, one: string, many: string): [string, string] {
  return n === 1
    ? [`1 station ${one}`, "it"]
    : [`${String(n)} stations ${many}`, "them"];
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
  const lines: string[] = [];
  if (check.codeless.length > 0) {
    const [has, them] = counted(check.codeless.length, "has", "have");
    lines.push(
      `${has} no printed code: ${quotedList(check.codeless)}. Without location, visitors reach ${them} only by tapping "I'm here - play the story" once they stand there.`,
    );
  }
  if (check.unlockable.length > 0) {
    // Never the "I'm here" words: that tap is not offered for a station
    // with a code (`station-guide.ts` `hereOffered`).
    const [is, them] = counted(check.unlockable.length, "is", "are");
    lines.push(
      `${is} on a printed code the viewer cannot use (it has no printed size, or is not in this tour): ${quotedList(check.unlockable)}. Without location, visitors can only skip ${them}.`,
    );
  }
  return lines;
}
