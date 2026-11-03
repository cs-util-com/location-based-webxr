/**
 * Why these tests matter: a new tour, or one whose stations have no
 * position yet, has no centre to open the globe at. It used to refuse the
 * 3D view outright; it now opens on the whole Earth, over the creator's own
 * part of the world (read from the browser's time zone, the one hint a page
 * has without asking for the location), so the first station can be placed
 * by flying down and right-clicking the ground. A bad offset must never
 * give a place off the globe, and the pose must look straight down from
 * the given height.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_TOUR_VIEW,
  emptyTourCentre,
  emptyTourView,
} from "./empty-tour-view.js";

describe("emptyTourCentre", () => {
  // Why: the latitude sits low enough that a creator in the southern
  // hemisphere (Sydney, Buenos Aires) still finds home on the first view;
  // at 30 N it lay past the horizon.
  it("centres at 10 degrees north", () => {
    expect(EMPTY_TOUR_VIEW.lat).toBe(10);
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
