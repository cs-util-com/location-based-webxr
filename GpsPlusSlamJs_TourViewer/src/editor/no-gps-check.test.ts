/**
 * Why these tests matter (QR-first M1b-2, owner decision 2026-10-14 "code-
 * less stations without location"): a creator who marks a tour "needs no
 * GPS" takes the location question away from every visitor. Three things
 * then go wrong silently, and the editor is the only place that can say so
 * before a visitor finds out on site:
 *
 * - a station without a printed code is reached only by the visitor's own
 *   "I'm here - play the story" tap, so the creator must know WHICH;
 * - a station on a code the viewer can never lock (no printed size, or not
 *   among the tour's codes) is unreachable without location: the tracker
 *   never solves a code without a size, a station with a code is found
 *   only by that code's lock, and "I'm here" is not offered for it (M1b-2
 *   milestone review #2) - visitors can only skip it;
 * - a tour none of whose codes can place it (no level with a printed size
 *   and a stored position) does not get the flag at all: the viewer asks
 *   for the location anyway (`visitor-screen.ts` `tourCodesUsable`, r857
 *   review #4). The rule is the viewer's own, never a copy (DEC-H3).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { tourCodesUsable } from "../visitor-screen.js";
import { checkNoGps, noGpsWarnings } from "./no-gps-check.js";

const AT = { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 };

function station(
  id: string,
  anchor: TourStation["anchor"],
  title?: string,
): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    anchor,
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [],
  };
}

function level(qr: QrLevel["qr"]): QrLevel {
  return { version: 1, qr };
}

const USABLE = level({ physicalSizeM: 0.2, geo: AT });

describe("checkNoGps", () => {
  it("names every station without a printed code, in the rail's words", () => {
    const check = checkNoGps({
      stations: [
        station("a", { geo: AT }, "The column"),
        station("b", { code: "c1" }, "At the gate"),
        station("c", { geo: AT }),
      ],
      levels: new Map([["c1", USABLE]]),
    });
    // An untitled station is "Station N" by its place in the list, as the
    // rail names it (`station-run.ts` `stationTitle`, which the editor
    // model and this check share).
    expect(check).toEqual({
      codeless: ["The column", "Station 3"],
      unlockable: [],
      codesPlace: true,
    });
  });

  it("says the codes cannot place the tour without a level that has a size and a position", () => {
    // Why: each half alone is not enough - the viewer's lock needs both.
    for (const qr of [{ physicalSizeM: 0.2 }, { geo: AT }, {}]) {
      expect(
        checkNoGps({ stations: [], levels: new Map([["c", level(qr)]]) })
          .codesPlace,
      ).toBe(false);
    }
    expect(checkNoGps({ stations: [], levels: new Map() }).codesPlace).toBe(
      false,
    );
    expect(
      checkNoGps({
        stations: [],
        levels: new Map([
          ["x", level({ geo: AT })],
          ["c", USABLE],
        ]),
      }).codesPlace,
    ).toBe(true);
  });

  it("tripwire: stays wired to the viewer's own rule for any set of levels", () => {
    // Why (DEC-H3): the editor's warning and the viewer's decision must
    // never disagree. This compares `checkNoGps` with the very function it
    // calls, so it cannot catch a wrong rule - only a rewiring that stops
    // calling it, or a changed "unreadable" argument. The fixed cases
    // below say what the rule IS (M1b-2 milestone review #7).
    const qr = fc.record(
      {
        physicalSizeM: fc.double({ min: 0.05, max: 2, noNaN: true }),
        geo: fc.constant(AT),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.array(qr, { maxLength: 4 }), (qrs) => {
        const levels = new Map(qrs.map((q, i) => [`c${String(i)}`, level(q)]));
        expect(checkNoGps({ stations: [], levels }).codesPlace).toBe(
          tourCodesUsable(levels, false),
        );
      }),
    );
  });

  // Why (M1b-2 milestone review #2, #7): fixed cases of what the viewer
  // does with a station's code, read from its own code: the tracker
  // blocks the solve without a printed size (`qr-tracking-controller.ts`;
  // the Tour Viewer passes no `resolveSizeM`), a station with a code is
  // found only on that code's lock (`station-run.ts` `codeLocked`), and
  // "I'm here" is refused for it (`station-guide.ts` `hereOffered`). A
  // code with a size but no position still locks and finds its station.
  it.each([
    {
      name: "a usable code (size and position)",
      levels: [["c", USABLE]] as [string, QrLevel][],
      codesPlace: true,
      unlockable: [] as string[],
    },
    {
      name: "a code with a position and no size",
      levels: [["c", level({ geo: AT })]] as [string, QrLevel][],
      codesPlace: false,
      unlockable: ["On c"],
    },
    {
      name: "a code with a size and no position",
      levels: [["c", level({ physicalSizeM: 0.2 })]] as [string, QrLevel][],
      codesPlace: false,
      unlockable: [] as string[],
    },
    {
      name: "a code the tour does not carry (another one usable)",
      levels: [["u", USABLE]] as [string, QrLevel][],
      codesPlace: true,
      unlockable: ["On c"],
    },
  ])("a station on $name", ({ levels, codesPlace, unlockable }) => {
    const check = checkNoGps({
      stations: [station("s", { code: "c" }, "On c")],
      levels: new Map(levels),
    });
    expect(check).toEqual({ codeless: [], unlockable, codesPlace });
  });

  it("a tour without codes: its station is code-less, and nothing places it", () => {
    expect(
      checkNoGps({
        stations: [station("s", { geo: AT }, "Bench")],
        levels: new Map(),
      }),
    ).toEqual({ codeless: ["Bench"], unlockable: [], codesPlace: false });
  });

  it("counts exactly the stations whose anchor has no code", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 8 }), (coded) => {
        const stations = coded.map((c, i) =>
          station(`s${String(i)}`, c ? { code: "c" } : { geo: AT }),
        );
        const check = checkNoGps({ stations, levels: new Map() });
        expect(check.codeless).toHaveLength(coded.filter((c) => !c).length);
      }),
    );
  });
});

describe("noGpsWarnings", () => {
  it("says nothing for a tour whose codes place it and whose stations all have one", () => {
    expect(
      noGpsWarnings({ codeless: [], unlockable: [], codesPlace: true }),
    ).toEqual([]);
  });

  it("names one code-less station and how visitors still reach it", () => {
    expect(
      noGpsWarnings({
        codeless: ["The column"],
        unlockable: [],
        codesPlace: true,
      }),
    ).toEqual([
      '1 station has no printed code: "The column". Without location, visitors reach it only by tapping "I\'m here - play the story" once they stand there.',
    ]);
  });

  it("counts and lists several", () => {
    expect(
      noGpsWarnings({
        codeless: ["A", "B", "C"],
        unlockable: [],
        codesPlace: true,
      }),
    ).toEqual([
      '3 stations have no printed code: "A", "B" and "C". Without location, visitors reach them only by tapping "I\'m here - play the story" once they stand there.',
    ]);
  });

  it('names the stations on a code the viewer cannot use apart, and never with "I\'m here"', () => {
    // Why (M1b-2 milestone review #2): "I'm here" is refused for a station
    // with a code, so the only way past it without location is the skip.
    expect(
      noGpsWarnings({ codeless: [], unlockable: ["Gate"], codesPlace: true }),
    ).toEqual([
      '1 station is on a printed code the viewer cannot use (it has no printed size, or is not in this tour): "Gate". Without location, visitors can only skip it.',
    ]);
    const both = noGpsWarnings({
      codeless: ["Well"],
      unlockable: ["Gate", "Tower"],
      codesPlace: true,
    });
    expect(both).toEqual([
      '1 station has no printed code: "Well". Without location, visitors reach it only by tapping "I\'m here - play the story" once they stand there.',
      '2 stations are on a printed code the viewer cannot use (it has no printed size, or is not in this tour): "Gate" and "Tower". Without location, visitors can only skip them.',
    ]);
    expect(both[1]).not.toContain("I'm here");
  });

  it("says the setting does not hold when no code can place the tour, and only that", () => {
    // Why: without a usable code the viewer asks for the location anyway,
    // so visitors reach every station by GPS - a line about the code-less
    // or the unlockable ones would describe a tour that never runs.
    expect(
      noGpsWarnings({ codeless: ["A"], unlockable: ["B"], codesPlace: false }),
    ).toEqual([
      "None of this tour's printed codes can place it (a code needs its printed size and a measured position), so visitors will be asked for their location anyway.",
    ]);
  });
});
