/**
 * Why this test matters: the flight is judged by eye over every place a
 * press can start from and every target (continuous-flight plan
 * 2026-10-07-0941, CF1), so the examples in flight-path.test.ts are backed
 * by properties over random starts, targets, landings and durations:
 * - the ends are exact (no snap at the press, no landing elsewhere);
 * - the camera never goes below the lower of its start and its landing;
 * - on the way down the remaining ground distance stays within
 *   `arcPerAltitude` x the height above the landing, plus one landing
 *   altitude (no continental slide
 *   low over the ground, the cold review's finding 2);
 * - the speed never stalls or dips between two faster stretches (criteria
 *   (a) and (b)) at 60 Hz.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import {
  FLIGHT_PATH,
  flightAt,
  flightCamera,
  planFlight,
} from "./flight-path.js";
import {
  criterionWindow,
  noStall,
  noStopAndGo,
  speedSamples,
} from "./test-utils/flight-speed.js";

const R = FLIGHT_PATH.radiusM;

const place = fc.record({
  lat: fc.double({ min: -85, max: 85, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});
const logUniform = (min: number, max: number) =>
  fc
    .double({ min: Math.log(min), max: Math.log(max), noNaN: true })
    .map(Math.exp);

const flight = fc.record({
  from: place,
  to: place,
  startM: logUniform(1_000, 60_000_000),
  landingM: logUniform(1_000, 100_000),
  durationMs: fc.integer({ min: 4_000, max: 60_000 }),
});

function plan(f: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  startM: number;
  landingM: number;
  durationMs: number;
}) {
  const pose = orbitPose(WGS84_ELLIPSOID, f.from);
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, f.startM, 90);
  return {
    start: { pose, position: cam.position, quaternion: cam.quaternion },
    path: planFlight(
      WGS84_ELLIPSOID,
      { pose, distanceM: cam.position.length(), quaternion: cam.quaternion },
      orbitPose(WGS84_ELLIPSOID, f.to),
      { landingM: f.landingM, durationMs: f.durationMs },
    ),
  };
}

describe("flight path properties", () => {
  it("starts where the camera is and ends at the landing", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { start, path } = plan(f);
        const c0 = flightCamera(path, 0);
        expect(c0.position.distanceTo(start.position)).toBeLessThan(
          1e-6 * start.position.length(),
        );
        expect(c0.quaternion.angleTo(start.quaternion)).toBeLessThan(1e-6);
        const end = flightAt(path, f.durationMs);
        expect(end.done).toBe(true);
        expect(end.altitudeM).toBe(f.landingM);
        expect(end.arcRad).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("never goes below the lower of the start and the landing", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const floor = Math.min(f.startM, f.landingM) * (1 - 1e-9);
        for (let t = 0; t <= f.durationMs; t += f.durationMs / 400) {
          expect(flightAt(path, t).altitudeM).toBeGreaterThanOrEqual(floor);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keeps the remaining ground distance within k x the height above the landing on the way down", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const step = f.durationMs / 400;
        const over: string[] = [];
        let prev = flightAt(path, 0).altitudeM;
        for (let t = step; t < f.durationMs; t += step) {
          const now = flightAt(path, t);
          // Only below the arch (descending) and above the landing.
          const descending = now.altitudeM < prev && now.altitudeM > f.landingM;
          const bound =
            FLIGHT_PATH.arcPerAltitude * (now.altitudeM - f.landingM) +
            f.landingM;
          if (descending && now.arcRad * R > bound) {
            over.push(
              `${t.toFixed(0)} ms: ${(now.arcRad * R).toFixed(0)} > ${bound.toFixed(0)} m`,
            );
          }
          prev = now.altitudeM;
        }
        expect(over).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("never stalls or dips between faster stretches at 60 Hz", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const w = criterionWindow(
          speedSamples((t) => flightAt(path, t), f.durationMs, 60, R),
          f.landingM,
        ).map((s) => s.v);
        // Too short a flight to judge counts as a pass.
        const judged = w.length >= 10;
        expect(!judged || noStall(w, 0.5)).toBe(true);
        expect(!judged || noStopAndGo(w, 0.2)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
