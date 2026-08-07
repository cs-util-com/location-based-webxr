/**
 * WHY THESE TESTS MATTER (F56).
 *
 * The label is the ONLY feedback a user gets when the found event is outside
 * the viewport, which is the common case: an event tile is ~900 m across and
 * the demo opens at zoom 18. If the distance or the direction is wrong, the
 * user walks the wrong way and the feature is worse than silence.
 *
 * The arithmetic has more edge cases than it looks: a bearing computed by
 * subtracting longitudes breaks at the antimeridian, and a compass bucket
 * computed by a bare floor mislabels due north for half its arc. Both are
 * pinned below because both are easy to write wrong and impossible to see.
 */

import { describe, expect, it } from "vitest";

import {
  GEO_EVENT_BUSY_LABEL,
  GEO_EVENT_IDLE_LABEL,
  bearingDegrees,
  compassPoint,
  describeGeoEvent,
  distanceMetres,
  formatDistance,
  geoEventButtonLabel,
} from "./event-label.js";

const COLOGNE = { lat: 50.9375, lng: 6.9603 };

/** A pick with only the fields the label reads. */
const pickAt = (lat: number, lng: number) => ({
  candidate: { lat: 0, lng: 0 },
  cell: "cell",
  position: { lat, lng },
  heat: 12,
  evaluated: [],
});

describe("distanceMetres", () => {
  it("matches a known great-circle distance", () => {
    // Cologne to Dusseldorf, ~34.6 km by great circle. A degrees-based
    // approximation would be out by kilometres here.
    const dusseldorf = { lat: 51.2277, lng: 6.7735 };
    expect(distanceMetres(COLOGNE, dusseldorf)).toBeGreaterThan(33_000);
    expect(distanceMetres(COLOGNE, dusseldorf)).toBeLessThan(36_000);
  });

  it("is zero for the same point, and symmetric", () => {
    expect(distanceMetres(COLOGNE, COLOGNE)).toBeCloseTo(0, 6);
    const other = { lat: 51, lng: 7 };
    expect(distanceMetres(COLOGNE, other)).toBeCloseTo(
      distanceMetres(other, COLOGNE),
      6,
    );
  });

  it("shrinks longitude with latitude", () => {
    // One degree of longitude at Cologne is ~0.63 of one at the equator. A
    // formula missing the cos(lat) term reports them equal.
    const atEquator = distanceMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atCologne = distanceMetres({ lat: 51, lng: 0 }, { lat: 51, lng: 1 });
    expect(atCologne).toBeLessThan(atEquator * 0.7);
  });
});

describe("bearingDegrees", () => {
  it("reads the four cardinal directions", () => {
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      0,
      3,
    );
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      90,
      3,
    );
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(
      180,
      3,
    );
    expect(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(
      270,
      3,
    );
  });

  it("crosses the antimeridian without pointing backwards", () => {
    // THE DEFECT THIS PINS. Subtracting longitudes gives -359.8 for this pair
    // and reports "west"; the target is 0.2 degrees EAST. Nobody in Cologne
    // will hit this, which is exactly why it would never be noticed.
    const bearing = bearingDegrees(
      { lat: 0, lng: 179.9 },
      { lat: 0, lng: -179.9 },
    );
    expect(bearing).toBeCloseTo(90, 1);
  });

  it("is always in [0, 360)", () => {
    for (let lng = -180; lng <= 180; lng += 17) {
      const bearing = bearingDegrees({ lat: 10, lng: 0 }, { lat: -10, lng });
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });
});

describe("compassPoint", () => {
  it("centres each point on its bearing rather than starting at it", () => {
    // A bare `floor(bearing / 45)` labels 0-44 degrees "N", so a target 40
    // degrees east of north reads as due north while one 46 degrees reads NE.
    // Centring means N owns 337.5-22.5, which is what a compass rose means.
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(20)).toBe("N");
    expect(compassPoint(30)).toBe("NE");
    expect(compassPoint(350)).toBe("N");
  });

  it("wraps at 360 back to north", () => {
    expect(compassPoint(360)).toBe("N");
    expect(compassPoint(359.9)).toBe("N");
  });

  it("covers all eight points", () => {
    const seen = new Set<string>();
    for (let bearing = 0; bearing < 360; bearing += 5) {
      seen.add(compassPoint(bearing));
    }
    expect(seen.size).toBe(8);
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre, rounded to ten", () => {
    // Rounded because the underlying cell is ~4 m across -- "643 m" would
    // imply a precision the H3 quantisation does not have.
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(643)).toBe("640 m");
    expect(formatDistance(999)).toBe("1000 m");
  });

  it("switches to kilometres at a kilometre", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1204)).toBe("1.2 km");
  });
});

describe("describeGeoEvent", () => {
  const at = (): string => "14:15";

  it("names the time, the distance and the direction", () => {
    // The whole point of F56: the map often shows nothing, so this string is
    // the only thing telling the user the event exists and where to look.
    const label = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [pickAt(0.005, 0.005)], tilesSearched: 3 },
      at,
    );
    expect(label).toContain("14:15");
    expect(label).toContain("NE");
    expect(label).toMatch(/\d+ m/);
  });

  it("measures to the SETTLED position, not the seed", () => {
    // The pick's `candidate` is at the user's feet and its `position` is far
    // away. Reading the wrong field would report "0 m" for an event half a
    // kilometre off -- the same seed-versus-settled confusion that put the map
    // marker in the wrong place.
    const label = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [pickAt(0.005, 0)], tilesSearched: 3 },
      at,
    );
    // "560 m" alone is the proof: reading `candidate` would give "0 m", since
    // the seed is exactly at the user. (Written first as a `not.toContain("0 m
    // ")` guard, which is useless -- "560 m N" contains that substring.)
    expect(label).toContain("560 m");
  });

  it("uses the NEAREST pick, which is the first one", () => {
    const label = describeGeoEvent(
      { lat: 0, lng: 0 },
      {
        eventTime: 0,
        picks: [pickAt(0.001, 0), pickAt(0.05, 0)],
        tilesSearched: 3,
      },
      at,
    );
    expect(label).toContain("110 m");
  });

  it("says so plainly when no tile yielded an event", () => {
    // Not an error: a tile that is all water genuinely has no event, and the
    // button must reach a terminal state either way.
    const label = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [], tilesSearched: 1 },
      at,
    );
    // AND HOW MUCH GROUND WAS LOOKED AT (F57). "No event nearby" alone cannot
    // distinguish "there is none" from "you have not loaded enough to know" --
    // and under DEC-R9-15 the second is a real, common state.
    expect(label).toBe("No event nearby · searched 1 tile");
  });
});

describe("describeGeoEvent — the searched area (F57)", () => {
  const at = (): string => "14:15";

  it("singularises one tile and pluralises the rest", () => {
    // "searched 1 tiles" is the kind of detail that makes a diagnostic surface
    // look unfinished, and it is one branch.
    expect(
      describeGeoEvent(
        { lat: 0, lng: 0 },
        { eventTime: 0, picks: [], tilesSearched: 1 },
        at,
      ),
    ).toContain("searched 1 tile");
    expect(
      describeGeoEvent(
        { lat: 0, lng: 0 },
        { eventTime: 0, picks: [], tilesSearched: 4 },
        at,
      ),
    ).toContain("searched 4 tiles");
  });

  it("reports it on the SUCCESS path too, not only when nothing was found", () => {
    // THE HALF THAT IS EASY TO SKIP. Two people standing together can find
    // different NUMBERS of events under DEC-R9-15 while agreeing about each one
    // — so the coverage matters when something IS found, not just when nothing
    // is. Reporting it only on the empty branch would answer the question only
    // for the person who sees nothing.
    const label = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [pickAt(0.005, 0.005)], tilesSearched: 7 },
      at,
    );
    expect(label).toContain("Event at");
    expect(label).toContain("searched 7 tiles");
  });
});

describe("geoEventButtonLabel", () => {
  const at = (): string => "14:15";

  it("rests when nothing has been found", () => {
    expect(
      geoEventButtonLabel(
        { position: COLOGNE, geoEvent: undefined },
        false,
        at,
      ),
    ).toBe(GEO_EVENT_IDLE_LABEL);
  });

  it("says it is working, whatever is currently held", () => {
    // The busy state wins over the held event: while a search is running, the
    // previous result's description would claim the button is idle.
    expect(
      geoEventButtonLabel(
        {
          position: COLOGNE,
          geoEvent: {
            eventTime: 0,
            picks: [pickAt(50.94, 6.97)],
            tilesSearched: 7,
          },
        },
        true,
        at,
      ),
    ).toBe(GEO_EVENT_BUSY_LABEL);
  });

  it("RE-READS as the user walks, because it is derived rather than frozen", () => {
    // WHY THIS TEST MATTERS. The label used to be written once, at the moment
    // the search returned, so "640 m NE" stayed on the button however far the
    // user then walked — a number that was wrong the instant they moved, on a
    // control whose whole purpose (F56) is to say where to go. Deriving it from
    // (position, event) is what fixes that, and this is the assertion that
    // would fail if anyone froze the string again.
    const geoEvent = {
      eventTime: 0,
      picks: [pickAt(50.9435, 6.9603)],
      tilesSearched: 7,
    };
    const far = geoEventButtonLabel({ position: COLOGNE, geoEvent }, false, at);
    const near = geoEventButtonLabel(
      { position: { lat: 50.9425, lng: 6.9603 }, geoEvent },
      false,
      at,
    );

    expect(far).toContain("670 m N");
    expect(near).toContain("110 m N");
  });

  it("describes an empty result rather than resting, so the search is visible", () => {
    // "No event nearby · searched 7 tiles" and "Next geo-event" are different
    // claims: the first says a search ran and found nothing, the second says
    // none has run. Collapsing them makes a real answer look like inaction.
    expect(
      geoEventButtonLabel(
        {
          position: COLOGNE,
          geoEvent: { eventTime: 0, picks: [], tilesSearched: 7 },
        },
        false,
        at,
      ),
    ).toBe("No event nearby · searched 7 tiles");
  });
});
