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
import { CORPUS_SITES } from "gps-plus-slam-osm";

import { PICKER_PLACES, placeById } from "./picker-places.js";
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

describe("?site= — the rule that replaces the shared table (DEC-R6b-1)", () => {
  /**
   * WHY THIS BLOCK IS THE MOST IMPORTANT ONE IN THE FILE.
   *
   * Round 7 split the picker list from `CORPUS_SITES`, and DEC-R4-11's warning
   * about two lists drifting has not expired: the cost of drift is that the
   * places a human can reach stop being the places the suite covers. The
   * replacement guarantee is REACHABILITY — every corpus site must stay
   * visitable — and it is enforced here and nowhere else.
   *
   * Reachability rather than dropdown membership, because the note was emphatic
   * that Sylt must not be offered. See the round-7 plan §1.
   */

  it("reaches EVERY corpus site — the anti-drift guarantee", () => {
    for (const site of CORPUS_SITES) {
      expect(
        parseStartPosition(`?site=${site.id}`),
        `corpus site ${site.id} is not reachable`,
      ).toEqual(site.position);
    }
  });

  it("reaches every place the picker offers", () => {
    for (const place of PICKER_PLACES) {
      expect(parseStartPosition(`?site=${place.id}`)).toEqual(place.position);
    }
  });

  it("reaches the three places the dropdown deliberately drops", () => {
    // The whole point of separating REACHABLE from LISTED: these are gone from
    // the picker but must not become unvisitable, or their fixtures describe a
    // place nobody can look at.
    expect(parseStartPosition("?site=sylt-westerland")).toEqual({
      lat: 54.907,
      lng: 8.2985,
    });
    expect(parseStartPosition("?site=heidelberg-altstadt")).toEqual({
      lat: 49.4118,
      lng: 8.7106,
    });
    expect(parseStartPosition("?site=berlin-alexanderplatz")).toEqual({
      lat: 52.5219,
      lng: 13.4132,
    });
  });

  it("falls back on an unknown id rather than throwing", () => {
    // A stale bookmark must not be an error page.
    expect(parseStartPosition("?site=atlantis")).toEqual(DEFAULT_START);
    expect(parseStartPosition("?site=")).toEqual(DEFAULT_START);
  });

  it("lets an explicit ?lat=&lng= win over ?site=", () => {
    // The coordinate pair is the more specific override, and the e2e suite
    // depends on it: `AT_FIXTURE` must land on the fixture whatever else is in
    // the URL.
    expect(
      parseStartPosition("?site=tokyo-shinjuku&lat=50.9231&lng=6.9445"),
    ).toEqual({ lat: 50.9231, lng: 6.9445 });
  });

  it("falls back to ?site= when the coordinate pair is empty", () => {
    // `?lat=&lng=` means "no override given" (the Null Island bug above), so a
    // site alongside it is still the user's intent.
    expect(parseStartPosition("?lat=&lng=&site=porto-ribeira")).toEqual(
      placeById("porto-ribeira")?.position,
    );
  });
});

describe("DEFAULT_START (DEC-R6b-3)", () => {
  it("is Manhattan at the Central Park edge, and it is the picker's first entry", () => {
    // The default moved from Cologne in round 7. Asserting it against
    // `PICKER_PLACES[0]` rather than a literal keeps the two from drifting —
    // "the first entry in the list is not where you are" was the specific
    // defect DEC-R6b-3 rejected.
    expect(DEFAULT_START).toEqual(PICKER_PLACES[0]?.position);
    expect(PICKER_PLACES[0]?.id).toBe("manhattan-central-park");
  });
});
