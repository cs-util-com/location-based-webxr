/**
 * Why these tests matter: the 3D view's inspector shows the selection's
 * fields read-only, and what it says must be what the file holds - a
 * radius, a size, a print size - in the units the creator thinks in, so
 * a creator who checks a station before going out reads the truth. An
 * item's heading comes from its rotation, so a rotation turned by a
 * known angle must read back as that angle; and a selection the tour no
 * longer has shows no inspector rather than a stale one. Where a station
 * or a code stands is said as the 3D view frames it: metres east and
 * north of the tour's centre, its height and its heading.
 */
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  buildInspector,
  headingOfRotation,
  inspectorHint,
} from "./inspector-model.js";

const AT = "2026-10-22T10:00:00Z";

/** A unit quaternion turning by `deg` about the up axis (NUE: y up). */
function turn(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

const STATIONS: TourStation[] = [
  {
    id: "a",
    title: "Market Square",
    description: " Where the market meets ",
    geo: { lat: 48.1371234, lon: 11.5754321, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items: [
      {
        id: "pin-1",
        kind: "pin",
        label: "Fountain, 1612",
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
      {
        id: "model-1",
        kind: "model",
        asset: "horse",
        sizeM: 2.4,
        createdAtIso: AT,
        pose: { position: [0, 0, 0], rotation: turn(-90) },
      },
    ],
  } as unknown as TourStation,
  {
    id: "b",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    steps: [],
    items: [],
  } as unknown as TourStation,
];

const CODES = [
  {
    id: "level-1",
    title: "Code 1",
    meta: "Printed code, measured on site",
    geo: { lat: 48.1, lon: 11.5, alt: 561.5, headingDeg: 180 },
    printSizeM: 0.5,
  },
  {
    id: "level-2",
    title: "Code 2",
    meta: "Printed code, no position stored yet",
    geo: null,
    printSizeM: null,
  },
];

function inspect(selected: string | null, unlockedStations: string[] = []) {
  return buildInspector({
    selected,
    stations: STATIONS,
    assets: [],
    codes: CODES,
    unlockedStations,
  });
}

/** The position the inspector shows for `selected`. */
function positionOf(selected: string) {
  const model = inspect(selected);
  if (model === null || model.kind === "item" || model.position === null) {
    throw new Error(`no position for ${selected}`);
  }
  return model.position;
}

describe("buildInspector", () => {
  it("shows nothing without a selection, or for one the tour does not have", () => {
    expect(inspect(null)).toBeNull();
    expect(inspect("station:gone")).toBeNull();
    expect(inspect("gone")).toBeNull();
  });

  it("shows a station's fields as the file holds them", () => {
    expect(inspect("station:a")).toEqual({
      kind: "station",
      title: "Market Square",
      sub: "Station 1 of 2",
      place: { number: 1, count: 2 },
      description: "Where the market meets",
      imagePath: null,
      foundRadiusM: 25,
      activateRadiusM: 50,
      locked: true,
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 562.25,
        headingDeg: 30,
      },
    });
    expect(inspect("station:b")).toMatchObject({
      title: "Station 2",
      sub: "Station 2 of 2",
      description: null,
    });
  });

  // Why: the prototype says a station's place as
  // metres east and north of the tour's origin - the 3D view's centre, the
  // middle of the stations - not as degrees. Two stations stand either
  // side of their middle, about 42 m east-west and 97 m north-south apart (a degree is about
  // 74.46 km of longitude and 111.19 km of latitude there).
  it("says where a station stands in metres east and north of the tour's centre", () => {
    const a = positionOf("station:a");
    const b = positionOf("station:b");
    expect(a.eastM).toBeCloseTo(-b.eastM, 2);
    expect(a.northM).toBeCloseTo(-b.northM, 2);
    expect(b.eastM - a.eastM).toBeCloseTo((11.576 - 11.5754321) * 74_460, 0);
    expect(b.northM - a.northM).toBeCloseTo((48.138 - 48.1371234) * 111_190, 0);
  });

  it("shows an item's kind, its station, its offset and its size", () => {
    expect(inspect("pin-1")).toEqual({
      kind: "item",
      itemKind: "pin",
      title: "Fountain, 1612",
      sub: "Pin in Market Square",
      sizeM: null,
      offset: { northM: 4, upM: 1.5, eastM: -2 },
      headingDeg: 0,
    });
    expect(inspect("model-1")).toMatchObject({
      itemKind: "model",
      title: "3D model",
      sub: "3D model in Market Square",
      sizeM: 2.4,
      headingDeg: 90,
    });
  });

  it("shows a code's print size and position, or that it has none", () => {
    expect(inspect("level-1")).toEqual({
      kind: "code",
      title: "Code 1",
      sub: "Printed code, measured on site",
      printSizeM: 0.5,
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 561.5,
        headingDeg: 180,
      },
    });
    // The code stands about 4 km south-west of the stations' centre.
    const code = positionOf("level-1");
    expect(code.northM).toBeCloseTo((48.1 - 48.1375617) * 111_190, -1);
    expect(code.eastM).toBeCloseTo((11.5 - 11.57571605) * 74_460, -1);
    expect(inspect("level-2")).toMatchObject({
      printSizeM: null,
      position: null,
    });
  });
});

// Why this test matters: the bottom bar's hint is the only words that
// tell a creator how the selection's handles work (which one moves, which
// turns, which sizes), so each kind must name exactly the handles it has:
// a pin offering a "dot to resize" it does not have, or a code offering a
// drag it refuses, sends the creator looking for what is not there.
describe("inspectorHint", () => {
  // Why: the inspector's lock is the only place a station is unlocked, so
  // it must read the page's lock - locked by default - and the hint must
  // not invite a drag the lock refuses.
  it("shows a station locked until it is unlocked, and hints at its radius alone", () => {
    expect(inspect("station:a")).toMatchObject({ locked: true });
    const open = buildInspector({
      selected: "station:a",
      stations: STATIONS,
      assets: [],
      codes: CODES,
      unlockedStations: ["a"],
    });
    expect(open).toMatchObject({ locked: false });
    expect(inspectorHint(inspect("station:a"))).toBe(
      "Market Square - a white dot for the radius; its position is locked (unlock it under Position to move or turn it)",
    );
    expect(inspectorHint(open)).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
  });

  it("names the handles each selection has, and how to select with none", () => {
    expect(inspectorHint(null)).toBe(
      "Click a station, an item or a code; drag to orbit, right-drag to pan, wheel to zoom; right-click the ground for a new station",
    );
    expect(inspectorHint(inspect("station:a", ["a"]))).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
    expect(inspectorHint(inspect("pin-1"))).toBe(
      "Fountain, 1612 - drag the middle to move along the ground, the round arrow to turn",
    );
    expect(inspectorHint(inspect("model-1"))).toBe(
      "3D model - drag the middle to move along the ground, the round arrow to turn, a white dot to resize",
    );
    expect(inspectorHint(inspect("level-1"))).toBe(
      "Code 1 - read-only here; F frames it, Esc deselects",
    );
  });
});

describe("headingOfRotation", () => {
  // Why: a rotation turned by a known angle about up reads back as that
  // bearing (clockwise from north), within a hair, for every quarter and
  // in between; a rotation that is not a number reads as none.
  it("reads the bearing a turn about up gives", () => {
    for (const deg of [0, 45, 90, 135, 180, 270, 359]) {
      // A turn of -deg about up (counter-clockwise seen from above in
      // north-up-east) points north at a bearing of +deg.
      expect(headingOfRotation(turn(-deg))).toBeCloseTo(deg % 360, 6);
    }
    expect(headingOfRotation([Number.NaN, 0, 0, 1])).toBeNull();
  });

  // Why: an item tipped so that its forward points straight up or down
  // has no bearing at all; a number there would be the noise of a
  // near-zero atan2.
  it("gives no bearing for a forward turned straight up or down", () => {
    const s = Math.SQRT1_2;
    // A quarter turn about east turns north to up, and back to down.
    expect(headingOfRotation([0, 0, s, s])).toBeNull();
    expect(headingOfRotation([0, 0, -s, s])).toBeNull();
    // A hair short of straight up still has one.
    const a = (Math.PI / 2 - 1e-3) / 2;
    expect(headingOfRotation([0, 0, Math.sin(a), Math.cos(a)])).toBe(0);
  });
});
