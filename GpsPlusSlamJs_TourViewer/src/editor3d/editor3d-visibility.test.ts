/**
 * Why these tests matter: the 3D editor draws a station's items only for
 * the selected station and the few nearest to the camera's centre, and
 * lays pins and photos flat as the camera looks down. Both run every frame
 * over every station; a rule that drops the selection, grows past its
 * count, flickers between equally near stations, or makes the morph jump
 * or run backwards is seen at once by a creator. These pin the rules on
 * their own at chosen points (the properties are in
 * editor3d-visibility.property.test.ts).
 */
import { describe, expect, it } from "vitest";

import {
  MORPH_BAND,
  NEAR_STATIONS,
  morphStanding,
  nearStations,
  selectedStationOf,
} from "./editor3d-visibility.js";

describe("morphStanding", () => {
  // Why: the morph band (8-42 degrees of tilt from straight
  // down): flat at the band's start and below, upright at its end and
  // above, a smooth step between.
  it("is flat at 8 degrees and below, upright at 42 and above", () => {
    expect(MORPH_BAND).toEqual({ fromDeg: 8, toDeg: 42 });
    expect(morphStanding(0)).toBe(0);
    expect(morphStanding(8)).toBe(0);
    expect(morphStanding(25)).toBeCloseTo(0.5, 9);
    expect(morphStanding(42)).toBe(1);
    expect(morphStanding(85)).toBe(1);
    // The smooth step: half-way in the band's first quarter is 0.15625.
    expect(morphStanding(8 + 34 / 4)).toBeCloseTo(0.15625, 9);
  });

  // Why: the band is a parameter that may move (3-22 and
  // 15-60 are the ends of the range it was tried over); each
  // must give the same shape at its own edges.
  it("takes another band with the same edges rule", () => {
    for (const band of [
      { fromDeg: 3, toDeg: 22 },
      { fromDeg: 15, toDeg: 60 },
    ]) {
      expect(morphStanding(band.fromDeg, band)).toBe(0);
      expect(morphStanding(band.toDeg, band)).toBe(1);
      expect(morphStanding((band.fromDeg + band.toDeg) / 2, band)).toBeCloseTo(
        0.5,
        9,
      );
    }
  });

  // Why: a camera angle that is not a number is a bug upstream; the morph
  // must not hand NaN to every item's transform.
  it("refuses a tilt that is not finite, and a band that is not a band", () => {
    expect(() => morphStanding(Number.NaN)).toThrow(RangeError);
    expect(() => morphStanding(10, { fromDeg: 20, toDeg: 20 })).toThrow(
      RangeError,
    );
    expect(() => morphStanding(10, { fromDeg: 30, toDeg: 20 })).toThrow(
      RangeError,
    );
    expect(() => morphStanding(10, { fromDeg: Number.NaN, toDeg: 20 })).toThrow(
      RangeError,
    );
  });
});

describe("nearStations", () => {
  const at = (id: string, east: number, north: number) => ({
    id,
    east,
    north,
  });

  // Why: the five stations nearest to the camera's centre show their
  // items, plus the selected one wherever it is.
  it("takes the K nearest and the selected one", () => {
    expect(NEAR_STATIONS).toBe(5);
    const stations = [
      at("a", 0, 0),
      at("b", 10, 0),
      at("c", 20, 0),
      at("far", 500, 0),
    ];
    expect([...nearStations(stations, { east: 0, north: 0 }, 2)]).toEqual([
      "a",
      "b",
    ]);
    expect(
      [...nearStations(stations, { east: 0, north: 0 }, 2, "far")].sort(),
    ).toEqual(["a", "b", "far"]);
    // A selection that is not a station of the tour adds nothing.
    expect(
      [...nearStations(stations, { east: 0, north: 0 }, 2, "gone")].sort(),
    ).toEqual(["a", "b"]);
    expect(nearStations([], { east: 0, north: 0 }, 5).size).toBe(0);
    expect(nearStations(stations, { east: 0, north: 0 }, 0).size).toBe(0);
  });

  // Why: two stations equally far must not swap in and out as the list is
  // rebuilt in another order: the nearer id wins a tie.
  it("breaks a tie by id", () => {
    const stations = [at("z", 10, 0), at("y", -10, 0), at("x", 0, 10)];
    expect([...nearStations(stations, { east: 0, north: 0 }, 2)]).toEqual([
      "x",
      "y",
    ]);
  });

  it("refuses a count that is not a whole number >= 0, or a centre that is not finite", () => {
    const stations = [at("a", 0, 0)];
    expect(() => nearStations(stations, { east: 0, north: 0 }, -1)).toThrow(
      RangeError,
    );
    expect(() => nearStations(stations, { east: 0, north: 0 }, 1.5)).toThrow(
      RangeError,
    );
    expect(() =>
      nearStations(stations, { east: Number.NaN, north: 0 }, 1),
    ).toThrow(RangeError);
  });
});

describe("selectedStationOf", () => {
  const manifest = {
    stations: [
      { id: "a", blocks: [{ id: "pin1" }] },
      { id: "b", blocks: [{ id: "photo2" }] },
    ],
  };

  // Why: the near-K rule always draws the selected station; the 2D page
  // selects a station as `station:<id>`, and an item by its own id, whose
  // station is the one to draw. A code, an unknown id or nothing selects
  // no station.
  it("names the selected station, or the station holding the selected item", () => {
    expect(selectedStationOf("station:b", manifest)).toBe("b");
    expect(selectedStationOf("pin1", manifest)).toBe("a");
    expect(selectedStationOf("photo2", manifest)).toBe("b");
    expect(selectedStationOf("station:gone", manifest)).toBeNull();
    expect(selectedStationOf("code-7", manifest)).toBeNull();
    expect(selectedStationOf(null, manifest)).toBeNull();
    expect(selectedStationOf("station:a", null)).toBeNull();
  });
});
