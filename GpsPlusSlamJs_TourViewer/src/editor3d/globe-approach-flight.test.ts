/**
 * Why these tests matter: the approach is the first thing a creator sees
 * of a tour, and the owner's rules for it are hard ones - it must never
 * look stuck, it must end exactly at the street view, and the bar on top
 * must follow the camera and never run back. These pin each rule on the
 * pure flight, where a frame loop cannot hide a jump.
 */
import { describe, expect, it } from "vitest";

import { aimView, streetView } from "./globe-editor-look.js";
import {
  approachFlight,
  barValue,
  flightDone,
  flightPoseAt,
  GLOBE_APPROACH,
  retargetFlight,
} from "./globe-approach-flight.js";

const GROUND_M = 515.5;
const GOAL = streetView({ lat: 46.948, lng: 7.4474 }, GROUND_M);

describe("approachFlight", () => {
  it("starts high above the tour's ground, looking straight down, north up", () => {
    // Why: the owner chose a flight from the globe; a start below the
    // whole-Earth view would skip the part that says where the tour is.
    const f = approachFlight(GOAL, GROUND_M);
    const p = flightPoseAt(f, 0);
    expect(p.altitudeKm * 1000 - GROUND_M).toBeCloseTo(
      GLOBE_APPROACH.startHeightKm * 1000,
      3,
    );
    expect(p.pitchDeg).toBe(-90);
    expect(p.headingDeg).toBe(0);
    expect(p.lng).toBeCloseTo(GOAL.lng - GLOBE_APPROACH.startOffsetLngDeg, 9);
  });

  it("lasts within the owner's 10 to 20 s, and is short under reduced motion", () => {
    // Why: the owner's expected flight is 10-20 s; reduced motion must
    // shorten it, not merely skip easing.
    const f = approachFlight(GOAL, GROUND_M);
    expect(f.durationMs).toBeGreaterThanOrEqual(10_000);
    expect(f.durationMs).toBeLessThanOrEqual(20_000);
    const r = approachFlight(GOAL, GROUND_M, { reducedMotion: true });
    expect(r.durationMs).toBeLessThanOrEqual(3_000);
  });

  it("ends exactly at the goal and holds it", () => {
    // Why: the street view is where editing starts; a flight that ends a
    // few metres off would leave the controls fighting the last frame.
    const f = approachFlight(GOAL, GROUND_M);
    expect(flightPoseAt(f, f.durationMs)).toEqual(GOAL);
    expect(flightPoseAt(f, f.durationMs * 2)).toEqual(GOAL);
    expect(flightPoseAt(f, Number.NaN)).toEqual(GOAL);
    expect(flightDone(f, f.durationMs - 1)).toBe(false);
    expect(flightDone(f, f.durationMs)).toBe(true);
  });

  it("finishes the turn by turnShare and tips the pitch only after pitchShare", () => {
    // Why: the turn is done while the camera is high (nothing to see
    // sliding sideways near the ground), and the camera keeps looking
    // straight down until the last stretch.
    const f = approachFlight(GOAL, GROUND_M);
    const atTurn = flightPoseAt(f, f.durationMs * GLOBE_APPROACH.turnShare);
    expect(atTurn.lat).toBeCloseTo(GOAL.lat, 9);
    expect(atTurn.lng).toBeCloseTo(GOAL.lng, 9);
    const beforeTip = flightPoseAt(f, f.durationMs * GLOBE_APPROACH.pitchShare);
    expect(beforeTip.pitchDeg).toBe(-90);
  });

  it("goes the short way round across the antimeridian", () => {
    // Why: a tour at 179 E with a start offset west of it must not turn
    // the long way round the Earth.
    const goal = streetView({ lat: -17, lng: -178 }, 0);
    const f = approachFlight(goal, 0);
    expect(f.from.lng).toBeGreaterThan(140);
    const mid = flightPoseAt(f, f.durationMs * 0.1);
    expect(Math.abs(mid.lng)).toBeGreaterThan(140);
  });

  it("works on ground below sea level", () => {
    // Why: the fall is logarithmic in the height over the GROUND; a log of
    // the altitude over the ellipsoid would fail at the Dead Sea.
    const goal = streetView({ lat: 31.5, lng: 35.5 }, -430);
    const f = approachFlight(goal, -430);
    for (let k = 0; k <= 20; k++) {
      const p = flightPoseAt(f, (f.durationMs * k) / 20);
      expect(Number.isFinite(p.altitudeKm)).toBe(true);
      expect(p.altitudeKm * 1000).toBeGreaterThan(-430);
    }
  });

  it("refuses a goal or a ground that is not finite", () => {
    // Why: a NaN pose handed to the view would put the camera nowhere.
    expect(() => approachFlight({ ...GOAL, lat: Number.NaN }, 0)).toThrow(
      RangeError,
    );
    expect(() => approachFlight(GOAL, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe("barValue", () => {
  it("reads 0 at the start, 1 at the goal and follows the height", () => {
    // Why: the owner's bar moves continuously with the camera, driven by
    // its elevation, and finishes when the camera lands.
    const f = approachFlight(GOAL, GROUND_M);
    expect(barValue(f, flightPoseAt(f, 0).altitudeKm)).toBeCloseTo(0, 9);
    expect(barValue(f, GOAL.altitudeKm)).toBeCloseTo(1, 9);
    expect(
      barValue(f, flightPoseAt(f, f.durationMs / 2).altitudeKm),
    ).toBeCloseTo(0.5, 6);
    expect(barValue(f, Number.NaN)).toBe(0);
    expect(barValue(f, 1e6)).toBe(0);
    expect(barValue(f, -1)).toBe(1);
  });

  it("never runs back across a retarget", () => {
    // Why: a station picked mid-flight sends the camera elsewhere, but the
    // bar must keep its scale; a bar that jumps back reads as a restart.
    const f = approachFlight(GOAL, GROUND_M);
    const at = f.durationMs * 0.6;
    const now = flightPoseAt(f, at);
    const before = barValue(f, now.altitudeKm);
    const station = aimView({ lat: 46.9485, lng: 7.448 }, GROUND_M, 20);
    const g = retargetFlight(f, now, at, station, GROUND_M);
    expect(barValue(g, flightPoseAt(g, 0).altitudeKm)).toBeGreaterThanOrEqual(
      before - 0.05,
    );
    expect(barValue(g, station.altitudeKm)).toBeCloseTo(1, 9);
  });
});

describe("retargetFlight", () => {
  it("starts where the camera is and takes what is left, a minimum at least", () => {
    // Why: a list click mid-flight must not teleport the camera, and a
    // click in the last moment must still fly, not jump.
    const f = approachFlight(GOAL, GROUND_M);
    const now = flightPoseAt(f, 3_000);
    const station = aimView({ lat: 46.9485, lng: 7.448 }, GROUND_M, 20);
    const g = retargetFlight(f, now, 3_000, station, GROUND_M);
    expect(flightPoseAt(g, 0)).toEqual(now);
    expect(g.durationMs).toBe(f.durationMs - 3_000);
    expect(flightPoseAt(g, g.durationMs)).toEqual(station);
    const late = retargetFlight(f, GOAL, f.durationMs - 10, station, GROUND_M);
    expect(late.durationMs).toBe(GLOBE_APPROACH.retargetMinMs);
  });

  it("turns the pitch evenly from where it is, never back to straight down", () => {
    // Why: a retarget near the ground starts with the camera tipped up; the
    // approach's held straight-down pitch must not snap it down again.
    const f = approachFlight(GOAL, GROUND_M);
    const station = aimView({ lat: 46.9485, lng: 7.448 }, GROUND_M, 20);
    const g = retargetFlight(f, GOAL, f.durationMs, station, GROUND_M);
    for (let k = 0; k <= 10; k++) {
      const p = flightPoseAt(g, (g.durationMs * k) / 10).pitchDeg;
      expect(p).toBeGreaterThanOrEqual(
        Math.min(GOAL.pitchDeg, station.pitchDeg) - 1e-9,
      );
      expect(p).toBeLessThanOrEqual(
        Math.max(GOAL.pitchDeg, station.pitchDeg) + 1e-9,
      );
    }
  });
});
