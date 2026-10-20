import { describe, expect, it } from "vitest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  assignToStations,
  nearestStationWithin,
  STATION_RADIUS_M,
  stationHolding,
} from "./station-assign";
import { horizontalM } from "./move-with-code";

/**
 * Why these tests matter: the automatic-station rule (tour editor plan
 * D20, D21) decides which station every pin, photo and recorded photo
 * belongs to, and a station's items keep their pose RELATIVE to its
 * anchor - so an anchor that moved when an element joined would move
 * every earlier item with it. These examples pin the rule's edges (the
 * radius itself, a tie, the order); the property tests sweep it.
 */

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const base = { lat: 47.5, lon: 8.7 };

/** A point `north`/`east` metres from the base, at 400 m. */
function at(north: number, east: number) {
  const g = calcGpsCoords(base, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400 };
}

function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `s${String(n)}`;
  };
}

describe("nearestStationWithin", () => {
  it("names the nearest anchor within the radius, and nothing beyond it", () => {
    const seats = [
      { id: "a", anchor: at(0, 0) },
      { id: "b", anchor: at(0, 20) },
    ];
    expect(nearestStationWithin(seats, at(0, 12))).toBe("b");
    expect(nearestStationWithin(seats, at(0, -24))).toBe("a");
    expect(nearestStationWithin(seats, at(0, -30))).toBeNull();
    expect(nearestStationWithin([], at(0, 0))).toBeNull();
  });

  it("counts the radius itself as inside, and gives a tie to the earlier station", () => {
    const seats = [
      { id: "a", anchor: at(0, -10) },
      { id: "b", anchor: at(0, 10) },
    ];
    expect(nearestStationWithin(seats, at(0, 0))).toBe("a");
    // A 1 cm margin either side of R: the geodesy's round trip is far
    // finer than that.
    expect(
      nearestStationWithin([seats[0]!], at(0, -10 + STATION_RADIUS_M - 0.01)),
    ).toBe("a");
    expect(
      nearestStationWithin([seats[0]!], at(0, -10 + STATION_RADIUS_M + 0.01)),
    ).toBeNull();
  });

  it("measures horizontally: a height difference does not push an element out", () => {
    const seats = [{ id: "a", anchor: at(0, 0) }];
    // 100 m higher, 20 m away (an element on a tower's top).
    const high = { ...at(0, 20), alt: 400 + 100 };
    expect(nearestStationWithin(seats, high)).toBe("a");
  });
});

// Why: since every object belongs to a station from the moment it is
// placed, the rule reads each station's OWN found radius (a creator may
// change it in the editor) instead of one R for all. These pin its edges:
// the radius itself is inside, a tie goes to the earlier station, the
// nearest of two that hold wins, and a small radius does not hold what a
// larger R would have.
describe("stationHolding", () => {
  const station = (
    id: string,
    north: number,
    east: number,
    foundRadiusM = 25,
  ) => ({ id, geo: at(north, east), foundRadiusM });

  it("counts its own found radius itself as inside, and a hair beyond it as outside", () => {
    const s = station("a", 0, -10);
    // A 1 cm margin either side of the radius (25 m, then 7 m): the
    // geodesy's round trip is far finer than that.
    expect(stationHolding([s], at(0, -10 + 25 - 0.01))).toBe("a");
    expect(stationHolding([s], at(0, -10 + 25 + 0.01))).toBeNull();
    const small = station("b", 0, 0, 7);
    expect(stationHolding([small], at(0, 6.99))).toBe("b");
    expect(stationHolding([small], at(0, 7.01))).toBeNull();
    // Exactly on the radius: the distance the rule measures, as the
    // radius.
    const spot = at(3, 17);
    const exact = horizontalM(s.geo, spot);
    expect(stationHolding([{ ...s, foundRadiusM: exact }], spot)).toBe("a");
  });

  it("reads each station's own radius: 10 m from a 5 m station is outside, from a 40 m one inside", () => {
    expect(stationHolding([station("a", 0, 0, 5)], at(0, 10))).toBeNull();
    expect(stationHolding([station("a", 0, 0, 40)], at(0, 39))).toBe("a");
  });

  it("gives a tie to the earlier station, and two that hold to the nearer", () => {
    const tie = [station("a", 0, -10), station("b", 0, 10)];
    expect(stationHolding(tie, at(0, 0))).toBe("a");
    expect(stationHolding([...tie].reverse(), at(0, 0))).toBe("b");
    expect(stationHolding(tie, at(0, 1))).toBe("b");
    // The nearer one wins even when the farther one's radius is larger.
    expect(
      stationHolding(
        [station("big", 0, -20, 40), station("small", 0, 5, 6)],
        at(0, 0),
      ),
    ).toBe("small");
  });

  it("measures horizontally, and holds nothing with no stations", () => {
    // 100 m higher, 20 m away (an object on a tower's top).
    const high = { ...at(0, 20), alt: 500 };
    expect(stationHolding([station("a", 0, 0)], high)).toBe("a");
    expect(stationHolding([], at(0, 0))).toBeNull();
  });

  it("holds nothing for a radius that is not a positive finite number", () => {
    // A hand-edited file's broken radius must not swallow every object.
    for (const r of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stationHolding([station("a", 0, 0, r)], at(0, 0))).toBeNull();
    }
  });
});

describe("assignToStations", () => {
  it("a chain along a path becomes a chain of stations, each anchored at its first element", () => {
    const elements = [at(0, 0), at(0, 10), at(0, 30), at(0, 50), at(0, 60)];
    const result = assignToStations({
      stations: [],
      elements,
      positionOf: (e) => e,
      newStationId: ids(),
    });
    expect(result.stationOf).toEqual(["s1", "s1", "s2", "s2", "s3"]);
    expect(result.stations.map((s) => s.anchor)).toEqual([
      elements[0],
      elements[2],
      elements[4],
    ]);
  });

  it("joins existing stations first, and keeps them as they are, in order", () => {
    const existing = [{ id: "old", anchor: at(100, 0) }];
    const result = assignToStations({
      stations: existing,
      elements: [at(110, 0), at(0, 0)],
      positionOf: (e) => e,
      newStationId: ids(),
    });
    expect(result.stationOf).toEqual(["old", "s1"]);
    expect(result.stations[0]).toBe(existing[0]);
    expect(result.stations.map((s) => s.id)).toEqual(["old", "s1"]);
  });

  it("follows the elements' order: the same elements in another order may group differently", () => {
    // Why: the rule is deliberately order-dependent (a fixed anchor at the
    // FIRST element, D20), so the callers' order is part of the contract.
    const a = at(0, 0);
    const b = at(0, 20);
    const c = at(0, 40);
    const forward = assignToStations({
      stations: [],
      elements: [a, b, c],
      positionOf: (e) => e,
      newStationId: ids(),
    });
    const middleFirst = assignToStations({
      stations: [],
      elements: [b, a, c],
      positionOf: (e) => e,
      newStationId: ids(),
    });
    expect(forward.stations).toHaveLength(2);
    expect(middleFirst.stations).toHaveLength(1);
  });

  it("takes a radius, for the measurement over 15-40 m the plan names", () => {
    const elements = [at(0, 0), at(0, 18)];
    const narrow = assignToStations({
      stations: [],
      elements,
      positionOf: (e) => e,
      newStationId: ids(),
      radiusM: 15,
    });
    const wide = assignToStations({
      stations: [],
      elements,
      positionOf: (e) => e,
      newStationId: ids(),
      radiusM: 40,
    });
    expect(narrow.stations).toHaveLength(2);
    expect(wide.stations).toHaveLength(1);
  });

  it("refuses a radius that is not a positive finite number", () => {
    for (const radiusM of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        assignToStations({
          stations: [],
          elements: [at(0, 0)],
          positionOf: (e) => e,
          newStationId: ids(),
          radiusM,
        }),
      ).toThrow(RangeError);
    }
  });

  it("refuses a new station id that is already taken", () => {
    expect(() =>
      assignToStations({
        stations: [{ id: "s1", anchor: at(0, 0) }],
        elements: [at(0, 100)],
        positionOf: (e) => e,
        newStationId: ids(),
      }),
    ).toThrow(/s1/);
  });
});

// Why (owner decision D8 of the editor round-2 plan, 2026-10-18): places
// closer than about 40 m cannot be separated by any automatic radius, so
// the phone's "New station here" makes the next element start its own
// station even within R of another. The rule carries it as an element's
// own station id, taken IN ORDER like every other element: an earlier
// element must never be absorbed into a station a later one starts.
describe("assignToStations: an element with its own station (D8)", () => {
  it("starts its station under that id, anchored where it stands, even within R of another", () => {
    const own = new Map([[1, "mine"]]);
    const result = assignToStations({
      stations: [{ id: "gate", anchor: at(0, 0) }],
      elements: [at(0, 2), at(0, 5), at(0, 6)],
      positionOf: (e) => e,
      newStationId: ids(),
      ownStationOf: (_e, i) => own.get(i),
    });
    // The first joins the gate as usual; the second starts "mine" 5 m
    // from the gate's anchor; the third joins the nearer of the two.
    expect(result.stationOf).toEqual(["gate", "mine", "mine"]);
    expect(result.stations.map((s) => s.id)).toEqual(["gate", "mine"]);
    expect(result.stations[1]!.anchor).toEqual(at(0, 5));
  });

  it("never takes an earlier element into a station a later one starts", () => {
    // 60 m out, the first element starts a station of the rule's; the
    // second, 3 m from it, starts its own. The first stays where it is.
    const result = assignToStations({
      stations: [{ id: "gate", anchor: at(0, 0) }],
      elements: [at(0, 60), at(0, 63)],
      positionOf: (e) => e,
      newStationId: ids(),
      ownStationOf: (_e, i) => (i === 1 ? "mine" : undefined),
    });
    expect(result.stationOf).toEqual(["s1", "mine"]);
    expect(result.stations.map((s) => s.id)).toEqual(["gate", "s1", "mine"]);
  });

  it("joins a station of that id that already stands, wherever the element is", () => {
    // Two elements naming one station: the first starts it, the second
    // joins it, though 100 m away; and an existing station is joined too.
    const result = assignToStations({
      stations: [{ id: "gate", anchor: at(0, 0) }],
      elements: [at(0, 50), at(0, 150), at(0, 300)],
      positionOf: (e) => e,
      newStationId: ids(),
      ownStationOf: (_e, i) => (i === 2 ? "gate" : "mine"),
    });
    expect(result.stationOf).toEqual(["mine", "mine", "gate"]);
    expect(result.stations.map((s) => s.id)).toEqual(["gate", "mine"]);
    expect(result.stations[1]!.anchor).toEqual(at(0, 50));
  });

  it("never mints an id that an element's own station takes later", () => {
    // The rule's next id would be "s1"; an element later names "s1" as
    // its own. Two stations under one id would merge their items.
    expect(() =>
      assignToStations({
        stations: [],
        elements: [at(0, 0), at(0, 100)],
        positionOf: (e) => e,
        newStationId: ids(),
        ownStationOf: (_e, i) => (i === 1 ? "s1" : undefined),
      }),
    ).toThrow(/s1/);
  });
});
