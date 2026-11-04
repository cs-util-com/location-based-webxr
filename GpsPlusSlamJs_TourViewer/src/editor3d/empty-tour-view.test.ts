/**
 * Why these tests matter: a new tour, or one whose stations have no
 * position yet, has no centre to open the globe at. It used to refuse the
 * 3D view outright; it now opens on the whole Earth, over the creator's own
 * part of the world (read from the browser's time zone, the one hint a page
 * has without asking for the location: its name gives the latitude, its
 * offset the longitude), so the first station can be placed by flying down
 * and right-clicking the ground. A bad offset or zone must never give a
 * place off the globe, and the pose must look straight down from the given
 * height.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_TOUR_VIEW,
  browserZoneHint,
  emptyTourCentre,
  emptyTourView,
  zoneLatitude,
} from "./empty-tour-view.js";

describe("emptyTourCentre", () => {
  // Why: without a zone name (or with one that names no region, such as
  // "UTC") the latitude sits low enough that a creator in the southern
  // hemisphere (Sydney, Buenos Aires) still finds home on the first view;
  // at 30 N it lay past the horizon.
  it("centres at 10 degrees north without a zone that names a region", () => {
    expect(EMPTY_TOUR_VIEW.lat).toBe(10);
    for (const zone of [undefined, "", "UTC", "Etc/GMT+5", "Nowhere/Land"]) {
      expect(emptyTourCentre(-60, zone).lat).toBe(10);
    }
  });

  it("puts the centre over the time zone's own longitude", () => {
    // Central Europe in winter (UTC+1): getTimezoneOffset() is -60.
    expect(emptyTourCentre(-60)).toEqual({
      lat: EMPTY_TOUR_VIEW.lat,
      lng: 15,
      altM: 0,
    });
    // New York in winter (UTC-5): +300.
    expect(emptyTourCentre(300).lng).toBe(-75);
    expect(emptyTourCentre(0).lng).toBe(0);
  });

  // Why: the zone's name says which part of the world it is in, which
  // the offset cannot: UTC+1 is Oslo and Lagos, UTC-3 is Greenland and
  // Buenos Aires. The latitude follows the name's region.
  it("takes the latitude from the zone's name", () => {
    expect(emptyTourCentre(-60, "Europe/Oslo")).toEqual({
      lat: zoneLatitude("Europe/Oslo"),
      lng: 15,
      altM: 0,
    });
    expect(zoneLatitude("Europe/Oslo")).toBeGreaterThan(40);
    expect(zoneLatitude("Africa/Lagos")).toBeLessThan(20);
    expect(zoneLatitude("America/Argentina/Buenos_Aires")).toBeLessThan(-10);
    // The older alias the browser may still report.
    expect(zoneLatitude("America/Buenos_Aires")).toBeLessThan(-10);
    expect(zoneLatitude("America/Los_Angeles")).toBeGreaterThan(25);
    expect(zoneLatitude("Australia/Sydney")).toBeLessThan(-15);
    expect(zoneLatitude("Pacific/Auckland")).toBeLessThan(-15);
    expect(zoneLatitude("Pacific/Honolulu")).toBeGreaterThan(0);
    expect(zoneLatitude("Africa/Johannesburg")).toBeLessThan(-10);
    expect(zoneLatitude("UTC")).toBeUndefined();
  });

  // Why: UTC+14 (Kiribati) reads as 210 degrees east; the globe takes
  // longitudes within -180..180.
  it("wraps a zone past the date line into -180..180", () => {
    expect(emptyTourCentre(-840).lng).toBe(-150);
    expect(emptyTourCentre(720).lng).toBe(-180);
  });

  it("falls back to Greenwich for an offset that is not a number", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(emptyTourCentre(bad).lng).toBe(0);
    }
  });
});

describe("browserZoneHint", () => {
  // Why: summer time moves the offset 15 degrees east for half the year;
  // the zone's standard offset (the larger of January's and July's, which
  // holds in either hemisphere) is the steadier longitude.
  it("reads the standard offset, not the summer one", () => {
    const offsets = new Map([
      [0, -60],
      [6, -120],
    ]);
    const hint = browserZoneHint({
      offsetInMonth: (month) => offsets.get(month) ?? Number.NaN,
      timeZone: () => "Europe/Oslo",
    });
    expect(hint).toEqual({ offsetMin: -60, timeZone: "Europe/Oslo" });
    // The southern hemisphere's summer is January.
    offsets.set(0, -780).set(6, -720);
    expect(
      browserZoneHint({
        offsetInMonth: (month) => offsets.get(month) ?? Number.NaN,
        timeZone: () => "Pacific/Auckland",
      }).offsetMin,
    ).toBe(-720);
  });

  // Why: an engine without the zone's name (or one whose Intl throws)
  // still opens the view, on the offset alone.
  it("gives no zone where the browser cannot name it", () => {
    const hint = browserZoneHint({
      offsetInMonth: () => -60,
      timeZone: () => {
        throw new Error("no Intl");
      },
    });
    expect(hint).toEqual({ offsetMin: -60, timeZone: undefined });
    expect(
      browserZoneHint({ offsetInMonth: () => 0, timeZone: () => "" }).timeZone,
    ).toBeUndefined();
  });

  it("reads this engine's own zone by default", () => {
    const hint = browserZoneHint();
    expect(Number.isFinite(hint.offsetMin)).toBe(true);
    expect(hint.timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});

describe("emptyTourView", () => {
  it("looks straight down at the centre from the given height", () => {
    expect(emptyTourView({ lat: 30, lng: 15 }, 8_000)).toEqual({
      lat: 30,
      lng: 15,
      altitudeKm: 8_000,
      headingDeg: 0,
      pitchDeg: EMPTY_TOUR_VIEW.pitchDeg,
    });
    // Straight down has no heading to keep: one degree off it.
    expect(EMPTY_TOUR_VIEW.pitchDeg).toBe(-89);
  });

  it("refuses a place or a height that is not a finite number", () => {
    expect(() => emptyTourView({ lat: Number.NaN, lng: 0 }, 8_000)).toThrow(
      RangeError,
    );
    expect(() => emptyTourView({ lat: 0, lng: 0 }, Infinity)).toThrow(
      RangeError,
    );
    expect(() => emptyTourView({ lat: 0, lng: 0 }, 0)).toThrow(RangeError);
  });
});
