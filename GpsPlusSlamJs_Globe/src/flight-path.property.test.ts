/**
 * Why this test matters: the flight is judged by eye over every place a
 * press can start from and every target (continuous-flight plan
 * 2026-10-07-0941, CF1), so the examples in flight-path.test.ts are backed
 * by properties over random starts, targets, landings and durations (half
 * a second up, CF1 review finding 11), all on the camera:
 * - the ends are exact (no snap at the press, no landing elsewhere);
 * - the camera never goes below the lower of its start and its landing;
 * - on the way down the camera's remaining ground distance stays within
 *   K_ARC x the height above the landing, plus one landing altitude (no
 *   continental slide low over the ground, the cold review's finding 2);
 * - the camera never moves away from its own landing point (behind the
 *   target: a start already nearer than that, a climb over the target,
 *   rightly moves away from the target itself);
 * - over the cruise the camera's speed never stalls or dips between two
 *   faster stretches (criteria (a) and (b)) at 60 Hz.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type * as THREE from "three";
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
  noStall,
  noStopAndGo,
  speedSamples,
  windowBetween,
} from "./test-utils/flight-speed.js";

const R = FLIGHT_PATH.radiusM;
/**
 * The angle between two directions by the chord, 2 asin(|a - b| / 2):
 * `angleTo` goes through acos, which cannot tell angles under about
 * 1.5e-8 rad (9.5 cm on the Earth) from 0, and read as a backwards step.
 */
const between = (a: THREE.Vector3, b: THREE.Vector3) =>
  2 *
  Math.asin(
    Math.min(1, a.clone().normalize().distanceTo(b.clone().normalize()) / 2),
  );
/** The tests' bound on the remaining ground distance (see flight-path.test.ts). */
const K_ARC = 2;

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
  startM: logUniform(100, 60_000_000),
  landingM: logUniform(1_000, 100_000),
  durationMs: fc.integer({ min: 500, max: 60_000 }),
});

interface Flight {
  readonly from: { lat: number; lng: number };
  readonly to: { lat: number; lng: number };
  readonly startM: number;
  readonly landingM: number;
  readonly durationMs: number;
}

function plan(f: Flight) {
  const pose = orbitPose(WGS84_ELLIPSOID, f.from);
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, f.startM, 90);
  return {
    start: { position: cam.position, quaternion: cam.quaternion },
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
        let lowest = Infinity;
        for (let t = 0; t <= f.durationMs; t += f.durationMs / 400) {
          lowest = Math.min(lowest, flightAt(path, t).altitudeM);
        }
        expect(lowest).toBeGreaterThanOrEqual(floor);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps the camera's remaining ground distance within K_ARC x the height above the landing on the way down", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const step = f.durationMs / 400;
        const over: string[] = [];
        let prev = flightAt(path, 0).altitudeM;
        for (let t = step; t < f.durationMs; t += step) {
          const now = flightAt(path, t);
          // Only below the arch (descending).
          const descending = now.altitudeM < prev;
          const left = now.camera.angleTo(path.cameraEnd) * R;
          const bound =
            K_ARC * Math.max(0, now.altitudeM - f.landingM) + f.landingM;
          if (descending && left > bound) {
            over.push(
              `${t.toFixed(0)} ms: ${left.toFixed(0)} > ${bound.toFixed(0)} m`,
            );
          }
          prev = now.altitudeM;
        }
        expect(over).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("never moves the camera away from its landing point", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        let prev = Infinity;
        let worst = 0;
        for (let t = 0; t <= f.durationMs; t += f.durationMs / 400) {
          const cam = flightCamera(path, t).position.clone().normalize();
          const d = between(cam, path.cameraEnd) * R;
          worst = Math.max(worst, d - prev);
          prev = d;
        }
        // A centimetre: rounding on the sphere, not a backwards slide.
        expect(worst).toBeLessThan(0.01);
      }),
      { numRuns: 200 },
    );
  });

  it("never stalls or dips between faster stretches over the cruise at 60 Hz", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const cruise = path.cruise;
        const camera = (t: number) => {
          const c = flightCamera(path, t);
          return {
            altitudeM: c.altitudeM,
            direction: c.position.clone().normalize(),
          };
        };
        const vs = cruise
          ? windowBetween(
              speedSamples(camera, f.durationMs, 60, R),
              cruise.fromMs,
              cruise.toMs,
            ).map((s) => s.v)
          : [];
        // A short path (no cruise) or a cruise of a few frames is not judged.
        const judged = vs.length >= 10;
        expect(!judged || noStall(vs, 0.5)).toBe(true);
        expect(!judged || noStopAndGo(vs, 0.2)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
