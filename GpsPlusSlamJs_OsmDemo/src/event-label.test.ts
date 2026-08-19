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
  geoEventReadout,
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
    expect(label).toBe("No quest nearby · searched 1 tile");
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

  it("DROPS it from the success path, and keeps it when nothing was found", () => {
    // INVERTED 2026-08-19 (F4e). This used to assert the count on BOTH paths,
    // on the reasoning that two people standing together can find different
    // NUMBERS of quests under DEC-R9-15 while agreeing about each one.
    //
    // The owner called it noise on success, and on success it is: there is a
    // marker on the map, which answers the question the count was helping with.
    // The empty case is different and unchanged - it is the only thing
    // distinguishing "there is none here" from "you have not loaded enough to
    // know" (F57), and the second reads as a bug. So this keeps BOTH halves
    // rather than simply dropping one.
    const found = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [pickAt(0.005, 0.005)], tilesSearched: 7 },
      at,
    );
    expect(found).toContain("Quest at");
    expect(found).not.toContain("searched");

    const empty = describeGeoEvent(
      { lat: 0, lng: 0 },
      { eventTime: 0, picks: [], tilesSearched: 7 },
      at,
    );
    expect(empty).toContain("searched 7 tiles");
  });
});

describe("geoEventButtonLabel", () => {
  // NO INJECTED CLOCK HERE ANY MORE. The label stopped being a description
  // (F4a), so it no longer formats a time and no longer takes a formatter --
  // the fixed-clock helper the other blocks use would be unused surface.

  it("rests when no search is running", () => {
    expect(geoEventButtonLabel(false)).toBe(GEO_EVENT_IDLE_LABEL);
  });

  it("says it is working while one is", () => {
    // NARROWED 2026-08-19. This used to read "whatever is currently held",
    // because the label was a function of the held quest too and the busy state
    // had to WIN over it. The label no longer sees the quest at all (F4a), so
    // there is nothing left for busy to win over — asserting that framing now
    // would describe a conflict the code cannot have.
    expect(geoEventButtonLabel(true)).toBe(GEO_EVENT_BUSY_LABEL);
  });

  it("is ONE OF TWO CONSTANTS, so the button stops resizing (F4a)", () => {
    // INVERTED 2026-08-19. This label used to be the whole description, which
    // is exactly why the button grew from "Next geo-event" to "Event at 14:15 ·
    // 640 m NE · searched 7 tiles" and back on every press — the resizing the
    // owner reported.
    //
    // TWO constants and not one: `Finding…` is the in-progress state root
    // `CLAUDE.md`'s async-feedback rule requires, so collapsing to a single
    // string would delete the feedback rather than the resizing.
    // NO QUEST FIXTURE HERE ANY MORE, and its absence is the assertion. The
    // label used to take the view and describe whatever was held; it now takes
    // only `busy`, so there is no state a quest could vary. A test that still
    // built one would be implying the function can see it.
    expect(geoEventButtonLabel(false)).toBe(GEO_EVENT_IDLE_LABEL);
    expect(geoEventButtonLabel(true)).toBe(GEO_EVENT_BUSY_LABEL);
  });
});

describe("geoEventReadout — what survives of F56", () => {
  it("RE-READS as the user walks, because it is derived rather than frozen", () => {
    // MOVED HERE FROM `geoEventButtonLabel` (F4a, 2026-08-19), and moving it
    // rather than deleting it is the point. F56's recorded win was that the
    // distance updates as the user walks — a number frozen when the search
    // returned is wrong the instant they move, on a readout whose whole purpose
    // is saying where to go.
    //
    // Making the button constant deletes that, and NEITHER of its replacements
    // brings it back: a toast fades, and a map pan does not restate. The
    // milestone review of the plan caught the loss; this readout is what
    // preserves it, so this is the assertion that would fail if anyone froze
    // the string again — or removed the readout as redundant.
    const geoEvent = {
      eventTime: 0,
      picks: [pickAt(50.9435, 6.9603)],
      tilesSearched: 7,
    };

    expect(geoEventReadout({ position: COLOGNE, geoEvent })).toContain(
      "670 m N",
    );
    expect(
      geoEventReadout({ position: { lat: 50.9425, lng: 6.9603 }, geoEvent }),
    ).toContain("110 m N");
  });

  it("is EMPTY with no quest, so the caller can hide it rather than reserve space", () => {
    expect(geoEventReadout({ position: COLOGNE, geoEvent: undefined })).toBe(
      "",
    );
  });

  it("is empty for a search that found nothing", () => {
    // A quest with no picks is a real answer — "a search ran and found nothing"
    // — but there is no distance to report, and printing "0 m N" would point
    // the user at their own feet. The toast carries that outcome instead.
    expect(
      geoEventReadout({
        position: COLOGNE,
        geoEvent: { eventTime: 0, picks: [], tilesSearched: 7 },
      }),
    ).toBe("");
  });

  it("carries DISTANCE AND BEARING ONLY, not the time or the tile count", () => {
    // Those do not change as the user moves, so they belong in the transient
    // message that announced the result rather than in a readout whose whole
    // purpose is that it keeps changing. Without this, the readout drifts back
    // into being the old label under a new name.
    const readout = geoEventReadout({
      position: COLOGNE,
      geoEvent: {
        eventTime: 0,
        picks: [pickAt(50.9435, 6.9603)],
        tilesSearched: 7,
      },
    });

    expect(readout).not.toContain("searched");
    expect(readout).not.toContain("Quest at");
    expect(readout).toBe("670 m N");
  });
});
