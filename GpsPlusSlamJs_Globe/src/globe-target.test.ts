/**
 * Why this test matters: the globe turns to whatever these two functions
 * return, and a wrong answer is silent - a camera that flies to (0, 0)
 * because `Number("")` is 0 looks like a working page aimed at the Gulf of
 * Guinea. So every malformed input must read as ABSENT, and the precedence
 * (url, then the GPS fix, then the fallback only once the wait for a fix has
 * run out) must hold for every combination, not only the three examples a
 * reader would think of.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_FALLBACK_TARGET,
  chooseGlobeTarget,
  formatViewText,
  parseLatLngText,
  parseViewText,
} from "./globe-target.js";

describe("parseLatLngText", () => {
  it("reads one lat,lng token, spaces allowed around each number", () => {
    expect(parseLatLngText("50.94,6.96")).toEqual({ lat: 50.94, lng: 6.96 });
    expect(parseLatLngText(" -33.9 , 151.2 ")).toEqual({
      lat: -33.9,
      lng: 151.2,
    });
    expect(parseLatLngText("90,-180")).toEqual({ lat: 90, lng: -180 });
  });

  it("treats null, empty, whitespace and half-empty tokens as absent (Number('') is 0)", () => {
    for (const text of [null, "", " ", ",", "50,", ",7", " ,7", "50, "]) {
      expect(parseLatLngText(text)).toBeUndefined();
    }
  });

  it("treats non-finite, malformed and out-of-range values as absent", () => {
    for (const text of [
      "NaN,1",
      "1,Infinity",
      "abc,1",
      "1,2,3",
      "1;2",
      "90.0001,0",
      "-91,0",
      "0,180.5",
      "0,-181",
      "0x10,1",
    ]) {
      expect(parseLatLngText(text)).toBeUndefined();
    }
  });

  it("round-trips any in-range pair, and never returns an out-of-range one", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          // `+ 0` folds -0 into 0: the text "0" cannot carry the sign.
          expect(parseLatLngText(`${lat},${lng}`)).toEqual({
            lat: lat + 0,
            lng: lng + 0,
          });
        },
      ),
    );
    fc.assert(
      fc.property(fc.string(), (text) => {
        const got = parseLatLngText(text);
        if (got === undefined) return;
        expect(Math.abs(got.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(got.lng)).toBeLessThanOrEqual(180);
      }),
    );
  });
});

describe("chooseGlobeTarget", () => {
  const url = { lat: 50.94, lng: 6.96 };
  const fix = { lat: 35.68, lng: 139.77 };
  const fallback = GLOBE_FALLBACK_TARGET;

  it("prefers the url, then the fix, then the fallback once the wait expired", () => {
    const table = [
      [url, fix, true, url, "url"],
      [url, null, false, url, "url"],
      [undefined, fix, false, fix, "fix"],
      [undefined, fix, true, fix, "fix"],
      [undefined, null, false, null, "waiting"],
      [undefined, null, true, fallback, "fallback"],
    ] as const;
    for (const [u, f, expired, target, source] of table) {
      expect(
        chooseGlobeTarget({
          url: u,
          fix: f,
          fallback,
          fixWaitExpired: expired,
        }),
      ).toEqual({ target, source });
    }
  });

  it("is OsmDemo's opening frame by default (owner decision, plan §9)", () => {
    expect(GLOBE_FALLBACK_TARGET).toEqual({ lat: 40.7677, lng: -73.9807 });
  });

  it("for any inputs: a target exactly when the source is not waiting", () => {
    const latLng = fc.record({
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.option(latLng, { nil: undefined }),
        fc.option(latLng, { nil: null }),
        fc.boolean(),
        (u, f, expired) => {
          const got = chooseGlobeTarget({
            url: u,
            fix: f,
            fallback,
            fixWaitExpired: expired,
          });
          expect(got.target === null).toBe(got.source === "waiting");
          // A URL target always wins.
          expect(u === undefined || got.target === u).toBe(true);
        },
      ),
    );
  });
});

// Why (owner, 2026-10-06): the Debug export gives the exact pose the owner
// saw, but a link could only name a place (`at=`), so the links sent back
// never put the owner where he was. A `view=` token carries the pose
// (latitude, longitude, altitude km, heading and pitch degrees); a
// malformed one must read as absent, never as a camera at (0, 0).
describe("parseViewText and formatViewText", () => {
  it("reads a pose and writes it back", () => {
    expect(parseViewText("45.70106,7.54552,17.471,352.0,-25.4")).toEqual({
      lat: 45.70106,
      lng: 7.54552,
      altitudeKm: 17.471,
      headingDeg: 352,
      pitchDeg: -25.4,
    });
    expect(
      formatViewText({
        lat: 45.701058527,
        lng: 7.545524398,
        altitudeKm: 17.47098793,
        headingDeg: 351.98198,
        pitchDeg: -25.398294,
      }),
    ).toBe("45.70106,7.54552,17.471,352.0,-25.4");
  });

  it("reads anything malformed or out of range as absent", () => {
    for (const bad of [
      null,
      "",
      "45,7,17,0",
      "45,7,17,0,0,1",
      "45,7,,0,0",
      "91,7,17,0,0",
      "45,181,17,0,0",
      "45,7,0,0,0",
      "45,7,60000,0,0",
      "45,7,17,0,91",
      "45,7,17,Infinity,0",
      "45,7,17,0x10,0",
    ]) {
      expect(parseViewText(bad)).toBeUndefined();
    }
  });

  it("wraps the heading into [0, 360)", () => {
    expect(parseViewText("45,7,17,-10,0")?.headingDeg).toBe(350);
    expect(parseViewText("45,7,17,370,0")?.headingDeg).toBe(10);
  });

  // The round trip: a written pose reads back within the written precision
  // (about a metre in place and height, 0.05 degrees in angle).
  it("reads back what it writes, within the written precision", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89.9, max: 89.9, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        fc.double({ min: 0.01, max: 40_000, noNaN: true }),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: -89.9, max: 89.9, noNaN: true }),
        (lat, lng, altitudeKm, headingDeg, pitchDeg) => {
          const back = parseViewText(
            formatViewText({ lat, lng, altitudeKm, headingDeg, pitchDeg }),
          );
          expect(back).toBeDefined();
          expect(Math.abs(back!.lat - lat)).toBeLessThanOrEqual(5e-6);
          expect(Math.abs(back!.lng - lng)).toBeLessThanOrEqual(5e-6);
          expect(Math.abs(back!.altitudeKm - altitudeKm)).toBeLessThanOrEqual(
            5e-4,
          );
          const dh = Math.abs(back!.headingDeg - headingDeg);
          expect(Math.min(dh, 360 - dh)).toBeLessThanOrEqual(0.05 + 1e-9);
          expect(Math.abs(back!.pitchDeg - pitchDeg)).toBeLessThanOrEqual(
            0.05 + 1e-9,
          );
        },
      ),
    );
  });
});
