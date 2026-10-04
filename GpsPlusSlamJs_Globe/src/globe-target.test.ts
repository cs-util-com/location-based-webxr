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
  parseLatLngText,
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
