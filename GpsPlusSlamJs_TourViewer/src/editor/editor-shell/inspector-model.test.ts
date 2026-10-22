/**
 * Why these tests matter: the 3D view's inspector shows the selection's
 * fields read-only, and what it says must be what the file holds - a
 * radius, a size, a print size - in the units the creator thinks in, so
 * a creator who checks a station before going out reads the truth. An
 * item's heading comes from its rotation, so a rotation turned by a
 * known angle must read back as that angle; and a selection the tour no
 * longer has shows no inspector rather than a stale one.
 */
import { describe, expect, it } from "vitest";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { buildInspector, headingOfRotation } from "./inspector-model.js";

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

function inspect(selected: string | null) {
  return buildInspector({
    selected,
    stations: STATIONS,
    assets: [],
    codes: CODES,
  });
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
      description: "Where the market meets",
      imagePath: null,
      foundRadiusM: 25,
      activateRadiusM: 50,
      position: {
        lat: 48.1371234,
        lon: 11.5754321,
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
      position: { lat: 48.1, lon: 11.5, altM: 561.5, headingDeg: 180 },
    });
    expect(inspect("level-2")).toMatchObject({
      printSizeM: null,
      position: null,
    });
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
});
