/**
 * Why these tests matter (QR-first M1b-2; tour editor plan 2026-10-17-1816
 * D9, review 2 #3): a creator who marks a tour "needs no GPS" takes the
 * location question away from every visitor. Two things then go wrong
 * silently, and the editor is the only place that can say so before a
 * visitor finds out on site:
 *
 * - a station far from every code that can place the tour: without GPS the
 *   visitor's position is the camera's odometry from the last code, and its
 *   drift grows with every metre walked, so such a station is reached by a
 *   drifted position, or not at all. Stations are reached by their radius
 *   alone (D16) and have no code of their own any more (D9), so this one
 *   line replaces the per-station lines about code-less and unlockable
 *   stations ("I'm here" is gone);
 * - a tour none of whose codes can place it (no level with a printed size
 *   and a stored position) does not get the flag at all: the viewer asks
 *   for the location anyway (`visitor-screen.ts` `tourCodesUsable`, r857
 *   review #4). The rule is the viewer's own, never a copy (DEC-H3).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { tourCodesUsable } from "../visitor-screen.js";
import { CODE_EVENT_REACH_M } from "../visit-settle.js";
import {
  checkNoGps,
  NO_GPS_CODE_REACH_M,
  noGpsWarnings,
} from "./no-gps-check.js";

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const AT = { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 };

/** A spot `north` / `east` metres from AT. */
function spot(north: number, east: number) {
  const g = calcGpsCoords(AT, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 340, headingDeg: 0 };
}

function station(
  id: string,
  geo: TourStation["geo"],
  title?: string,
): TourStation {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    geo,
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    steps: [],
    blocks: [],
  };
}

function level(qr: QrLevel["qr"]): QrLevel {
  return { version: 1, qr };
}

const USABLE = level({ physicalSizeM: 0.2, geo: AT });

describe("checkNoGps", () => {
  it("reaches as far as a code event does: 40 m walked", () => {
    // Why: the same drift argument ties notes to a code event within 40 m
    // walked (`visit-settle.ts`); one number for one argument (DEC-H3).
    expect(NO_GPS_CODE_REACH_M).toBe(CODE_EVENT_REACH_M);
    expect(NO_GPS_CODE_REACH_M).toBe(40);
  });

  it("names every station farther than the reach from every placing code, in the rail's words", () => {
    const check = checkNoGps({
      stations: [
        station("a", spot(10, 0), "The column"),
        station("b", spot(0, 41), "At the gate"),
        station("c", spot(-60, 0)),
        station("d", spot(0, 39)),
      ],
      levels: new Map([["c1", USABLE]]),
    });
    // An untitled station is "Station N" by its place in the list, as the
    // rail names it (`station-run.ts` `stationTitle`).
    expect(check).toEqual({
      farFromCodes: ["At the gate", "Station 3"],
      codesPlace: true,
    });
  });

  it("counts only codes that can place the tour: a code without a size or a position is no anchor", () => {
    const check = checkNoGps({
      stations: [station("a", spot(0, 100), "Far")],
      levels: new Map([
        ["near-no-size", level({ geo: spot(0, 100) })],
        ["placing", USABLE],
      ]),
    });
    expect(check.farFromCodes).toEqual(["Far"]);
    const placed = checkNoGps({
      stations: [station("a", spot(0, 100), "Far")],
      levels: new Map([
        ["near", level({ physicalSizeM: 0.2, geo: spot(0, 90) })],
        ["placing", USABLE],
      ]),
    });
    expect(placed.farFromCodes).toEqual([]);
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
    // above say what the rule IS (M1b-2 milestone review #7).
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

  it("a station is far exactly when its distance to the one placing code exceeds the reach (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (distanceM, bearing) => {
          // Skip the centimetres around the reach the geodesy cannot pin.
          fc.pre(Math.abs(distanceM - NO_GPS_CODE_REACH_M) > 0.01);
          const check = checkNoGps({
            stations: [
              station(
                "s",
                spot(
                  distanceM * Math.cos(bearing),
                  distanceM * Math.sin(bearing),
                ),
                "S",
              ),
            ],
            levels: new Map([["c", USABLE]]),
          });
          expect(check.farFromCodes).toEqual(
            distanceM > NO_GPS_CODE_REACH_M ? ["S"] : [],
          );
        },
      ),
    );
  });
});

describe("noGpsWarnings", () => {
  it("says nothing for a tour whose codes place it and whose stations are all near one", () => {
    expect(noGpsWarnings({ farFromCodes: [], codesPlace: true })).toEqual([]);
  });

  it("names one far station and why it matters", () => {
    expect(
      noGpsWarnings({ farFromCodes: ["The column"], codesPlace: true }),
    ).toEqual([
      '1 station is farther than 40 m from every printed code: "The column". Without location, the position drifts with every metre walked from the last code, so visitors may not reach it. A code near it, or asking for location, fixes this.',
    ]);
  });

  it("counts and lists several, and never speaks of I'm here or of a station's own code", () => {
    const lines = noGpsWarnings({
      farFromCodes: ["A", "B", "C"],
      codesPlace: true,
    });
    expect(lines).toEqual([
      '3 stations are farther than 40 m from every printed code: "A", "B" and "C". Without location, the position drifts with every metre walked from the last code, so visitors may not reach them. A code near them, or asking for location, fixes this.',
    ]);
    expect(lines.join(" ")).not.toContain("I'm here");
  });

  it("says the setting does not hold when no code can place the tour, and only that", () => {
    // Why: without a usable code the viewer asks for the location anyway,
    // so visitors reach every station by GPS - a line about far stations
    // would describe a tour that never runs.
    expect(noGpsWarnings({ farFromCodes: ["A"], codesPlace: false })).toEqual([
      "None of this tour's printed codes can place it (a code needs its printed size and a measured position), so visitors will be asked for their location anyway.",
    ]);
  });
});
