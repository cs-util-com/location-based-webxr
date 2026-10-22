/**
 * Why these tests matter: every move, nudge, turn and lift of the 3D view
 * writes a geo pose through these, and the tour's file keeps them for
 * good. The height rule (an item keeps its height ABOVE the ground when
 * it moves, unless the creator lifts it) is what keeps a pin standing on
 * a hillside instead of floating off or sinking in; a turn that changed
 * the shape of a pose (a heading-only station gaining a rotation) would
 * churn every save; a turn the wrong way round would turn the knob
 * against the pointer. The ground here is the test's own function, never
 * the code's arithmetic restated.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import {
  headingOfGeo,
  liftedGeo,
  nudgedGeo,
  placedGeo,
  turnedGeo,
} from "./pose-edits.js";
import { createTourViewerStore } from "../tour-viewer-session.js";

// The core's geodesy runs only once a store activated it.
beforeAll(() => {
  createTourViewerStore();
});

const AT = { lat: 48.137, lon: 11.575, alt: 560 };

/** Metres from `a` to `b` on the ground (east, north), by the stack's
 *  own geodesy (the one every tour file is placed by). */
function metres(a: QrGeoPose, b: QrGeoPose): { east: number; north: number } {
  const [north = Number.NaN, , east = Number.NaN] = calcRelativeCoordsInMeters(
    { lat: a.lat, lon: a.lon },
    { lat: b.lat, lon: b.lon },
    0,
    0,
  );
  return { north, east };
}

/** A tilted ground: 1 m higher every 10 m north. */
const slope = (p: { lat: number; lon: number }) =>
  500 + (p.lat - AT.lat) * 11_132;

describe("a pose's heading", () => {
  it("reads a heading-only pose's heading, and a rotation's bearing of its x axis", () => {
    expect(headingOfGeo({ ...AT, headingDeg: 30 })).toBeCloseTo(30, 9);
    // The rotation of -90 degrees about up: facing east.
    const s = Math.sin(-Math.PI / 4);
    const c = Math.cos(-Math.PI / 4);
    expect(headingOfGeo({ ...AT, rotation: [0, s, 0, c] })).toBeCloseTo(90, 9);
    expect(headingOfGeo({ ...AT, rotation: [0, 0, 0, 1] })).toBeCloseTo(0, 9);
  });
});

describe("a turn", () => {
  it("keeps a heading-only pose heading-only", () => {
    const turned = turnedGeo({ ...AT, headingDeg: 350 }, 15);
    expect(turned).toEqual({ ...AT, headingDeg: 5 });
  });

  it("turns a rotation about up, clockwise seen from above, and keeps its heading in step", () => {
    const turned = turnedGeo(
      { ...AT, rotation: [0, 0, 0, 1], headingDeg: 0 },
      90,
    );
    expect(headingOfGeo(turned)).toBeCloseTo(90, 9);
    expect(turned.headingDeg).toBeCloseTo(90, 9);
    expect(turned.lat).toBe(AT.lat);
    expect(turned.alt).toBe(AT.alt);
  });

  it("leaves out a heading a tilted pose never had", () => {
    // Tilted 30 degrees about north: no honest vertical heading.
    const t = Math.sin(Math.PI / 12);
    const turned = turnedGeo(
      { ...AT, rotation: [t, 0, 0, Math.cos(Math.PI / 12)] },
      40,
    );
    expect(turned.headingDeg).toBeUndefined();
    expect(turned.rotation).toBeDefined();
  });

  it("refuses an angle that is not finite", () => {
    expect(() => turnedGeo({ ...AT, headingDeg: 0 }, Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("a move over the ground", () => {
  it("keeps the height above the ground where both grounds are known", () => {
    const placed = placedGeo(
      { ...AT, alt: 501.7, headingDeg: 10 },
      { lat: AT.lat + 0.001, lon: AT.lon },
      500,
      511.132,
    );
    expect(placed.alt).toBeCloseTo(512.832, 9);
    expect(placed.lat).toBe(AT.lat + 0.001);
    expect(placed.headingDeg).toBe(10);
  });

  it("nudges east and north by metres, keeping the height above a sloped ground", () => {
    const start = { ...AT, alt: 500 + 1.7, headingDeg: 0 };
    const north = nudgedGeo(start, 0, 10, slope);
    expect(metres(start, north).north).toBeCloseTo(10, 2);
    expect(metres(start, north).east).toBeCloseTo(0, 6);
    expect(north.alt - slope(north)).toBeCloseTo(1.7, 6);
    const east = nudgedGeo(start, 1, 0, slope);
    expect(metres(start, east).east).toBeCloseTo(1, 3);
  });

  it("keeps the altitude where the ground has not loaded", () => {
    const start = { ...AT, headingDeg: 0 };
    expect(nudgedGeo(start, 0.1, 0, () => null).alt).toBe(AT.alt);
  });

  it("lifts by metres, and refuses a lift that is not finite", () => {
    expect(liftedGeo({ ...AT, headingDeg: 0 }, -0.1).alt).toBeCloseTo(559.9, 9);
    expect(() => liftedGeo({ ...AT, headingDeg: 0 }, Infinity)).toThrow(
      RangeError,
    );
  });
});
