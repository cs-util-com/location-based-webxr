/**
 * The `?lat=&lng=` override.
 *
 * WHY THESE TESTS MATTER. Every branch below used to live inside `main.ts`,
 * which is DOM wiring and has no unit tests, and the e2e suite only ever passes
 * a valid pair. So the entire guard was unreachable by the gate — it could have
 * been deleted wholesale and everything would have stayed green.
 *
 * That mattered, because one branch was wrong: **`Number('')` is `0`, not
 * `NaN`**, so the literal form the README advertises (`?lat=&lng=`) passed the
 * finiteness check, passed the range check, and opened the demo at 0°N 0°E — a
 * point in the Gulf of Guinea with no OSM data, which presents as "the demo is
 * broken" rather than as "your URL was empty".
 */

import { describe, it, expect } from "vitest";

import { DEFAULT_START, parseStartPosition } from "./start-position.js";

describe("a valid override", () => {
  it("is used", () => {
    expect(parseStartPosition("?lat=50.9231&lng=6.9445")).toEqual({
      lat: 50.9231,
      lng: 6.9445,
    });
  });

  it("accepts negatives and zero when they are written out", () => {
    // `0` is a legitimate coordinate — the fix must reject EMPTY, not falsy.
    expect(parseStartPosition("?lat=0&lng=0")).toEqual({ lat: 0, lng: 0 });
    expect(parseStartPosition("?lat=-33.87&lng=-58.38")).toEqual({
      lat: -33.87,
      lng: -58.38,
    });
  });

  it("ignores unrelated parameters", () => {
    expect(parseStartPosition("?debug=1&lat=51&lng=7&x=y")).toEqual({
      lat: 51,
      lng: 7,
    });
  });
});

describe("Null Island — the bug this module was extracted to expose", () => {
  it("does NOT treat an empty pair as 0,0", () => {
    // `?lat=&lng=` is the literal form the README advertises. `Number('')` is
    // `0` and finite, so before the emptiness check this returned {0,0} and the
    // demo opened in the Gulf of Guinea with no data and no error.
    expect(parseStartPosition("?lat=&lng=")).toEqual(DEFAULT_START);
  });

  it("does NOT treat whitespace as 0,0 either", () => {
    // `Number(' ')` is also 0, so trimming has to happen before the numeric
    // conversion rather than being left to it.
    expect(parseStartPosition("?lat=%20&lng=%20")).toEqual(DEFAULT_START);
  });

  it("rejects an empty half even when the other half is valid", () => {
    expect(parseStartPosition("?lat=51&lng=")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?lat=&lng=7")).toEqual(DEFAULT_START);
  });
});

describe("the other rejection branches, none of which had a test", () => {
  it("falls back when the parameters are absent", () => {
    expect(parseStartPosition("")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?debug=1")).toEqual(DEFAULT_START);
  });

  it("requires BOTH parameters", () => {
    // Half an override would mix a URL latitude with a default longitude and
    // land somewhere nobody asked for.
    expect(parseStartPosition("?lat=51")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?lng=7")).toEqual(DEFAULT_START);
  });

  it("falls back on non-numeric values", () => {
    expect(parseStartPosition("?lat=north&lng=east")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?lat=NaN&lng=7")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?lat=Infinity&lng=7")).toEqual(DEFAULT_START);
  });

  it("falls back on out-of-range coordinates", () => {
    expect(parseStartPosition("?lat=91&lng=7")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?lat=51&lng=181")).toEqual(DEFAULT_START);
  });
});
