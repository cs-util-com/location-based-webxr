/**
 * The two conversions AR mode needs, and the gate on entering at all.
 *
 * Why these tests matter: both conversions are one-liners of the kind that stay
 * wrong for months, because both fail SILENTLY and both fail as something else.
 * A `lon`/`lng` slip reads as a city in the Gulf of Guinea; a sign slip on the
 * geoid puts everything ~94 m out at Cologne, in the direction `geoid.ts` warns
 * "does not look like a bug in this file — it looks like a bug in the GPS+SLAM
 * fusion, which is a much more expensive place to go looking".
 *
 * @see ar-origin.ts.md
 */

import { describe, it, expect } from "vitest";

import {
  absoluteDatumFor,
  canEnterAr,
  toDemoLatLng,
  type FrameworkLatLong,
} from "./ar-origin.js";

/** Cologne, and the framework's spelling of it. */
const ORIGIN: FrameworkLatLong = { lat: 50.9413, lon: 6.9583 };

describe("the framework/demo coordinate adapter", () => {
  it("moves the longitude across the lon/lng spelling difference", () => {
    // The framework says `lon`, this demo says `lng`. Asserted on the VALUE
    // rather than on the shape, because the failure that matters is a longitude
    // that silently became `undefined` and then `NaN` two frames later.
    expect(toDemoLatLng(ORIGIN)).toEqual({ lat: 50.9413, lng: 6.9583 });
  });

  it("does not confuse the two axes", () => {
    // A transposition survives every same-value fixture, so the fixture here
    // deliberately has lat and lng far apart and of different signs.
    expect(toDemoLatLng({ lat: 10, lon: -70 })).toEqual({
      lat: 10,
      lng: -70,
    });
  });
});

describe("the absolute elevation datum", () => {
  it("negates the undulation, because heightAt SUBTRACTS the datum", () => {
    // `heightAt` returns `surfaceHeight - datum`. To turn an orthometric DEM
    // height into the ellipsoidal one the GPS-world frame is measured in, the
    // wanted result is `surface + N` — so the datum must be `-N`.
    expect(absoluteDatumFor(46.9)).toBeCloseTo(-46.9, 6);
  });

  it("composes to DEM + N, which is the property that actually matters", () => {
    // Stated as the end-to-end arithmetic rather than as a sign, because the
    // sign alone is exactly what a reader cannot check. A 53 m orthometric post
    // at Cologne must read as 99.9 m ellipsoidal — what a GNSS altitude reports
    // standing on it.
    const surfaceHeight = 53;
    const undulation = 46.9;

    const read = surfaceHeight - absoluteDatumFor(undulation);

    expect(read).toBeCloseTo(99.9, 6);
  });

  it("is symmetric about a zero geoid, so ZERO_GEOID changes nothing", () => {
    // `ZERO_GEOID` is the library default and means "apply no correction". It
    // must pass through as a no-op rather than as a small wrong number.
    expect(absoluteDatumFor(0)).toBe(-0);
    expect(53 - absoluteDatumFor(0)).toBe(53);
  });
});

describe("the gate on entering AR", () => {
  it("refuses while the origin is null", () => {
    // `zero` is null until the first GPS fix. Entering then anchors the city to
    // nothing, and DEC-R11-6 rejected re-anchoring on the first non-null
    // `zero` — so there is no correction available later. Waiting is the only
    // correct behaviour.
    expect(canEnterAr(null)).toBe(false);
  });

  it("allows it once a fix has landed", () => {
    expect(canEnterAr(ORIGIN)).toBe(true);
  });

  it("allows an origin at exactly 0,0 rather than treating it as absent", () => {
    // Null Island is a real coordinate and a falsy-looking one. A truthiness
    // check here would refuse to start AR at the equator on the prime
    // meridian — the classic version of this bug.
    expect(canEnterAr({ lat: 0, lon: 0 })).toBe(true);
  });
});
