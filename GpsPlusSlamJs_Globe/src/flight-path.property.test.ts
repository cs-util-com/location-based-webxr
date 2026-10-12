/**
 * Why this test matters: the flight is judged by eye over every place a
 * press can start from and every target (continuous-flight plan
 * 2026-10-07-0941, CF1), so the examples in flight-path.test.ts are backed
 * by properties over random starts, targets, landings and durations (half
 * a second up, CF1 review finding 11), all on the camera:
 * - the ends are exact (no snap at the press, no landing elsewhere);
 * - the camera never goes below the lower of its start and its landing;
 * - on the way down from above the bend the camera's remaining ground
 *   distance stays within K_ARC x the height above the landing, plus one
 *   landing altitude (no continental slide low over the ground, the cold
 *   review's finding 2). A start below the bend pans at its own altitude
 *   (round-2 R1 gave up van Wijk's climb: one path family; the documented
 *   limit), never climbing above its start;
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
import { FLIGHT_TRAVEL, bendAltitudeM } from "./flight-travel.js";
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

  // From a start clearly above the bend the turn is over by the bend: below
  // it only the dive's own track is left, within K_ARC x the height above
  // the landing plus one landing (no slide low over the ground).
  it("leaves only the dive's track below the bend, from a start above it", () => {
    fc.assert(
      fc.property(flight, (f) => {
        // Beyond the largest margin a turn may need, the turn ends at the
        // bend (a big turn from just above it spills below, by design).
        fc.pre(
          f.startM >
            bendAltitudeM(f.landingM) * Math.exp(FLIGHT_TRAVEL.maxMarginEFolds),
        );
        const { path } = plan(f);
        const over: string[] = [];
        for (let i = 1; i < 400; i++) {
          const t = (f.durationMs * i) / 400;
          const now = flightAt(path, t);
          if (now.altitudeM > bendAltitudeM(f.landingM)) continue;
          const left = between(now.camera, path.cameraEnd) * R;
          const bound =
            K_ARC * Math.max(0, now.altitudeM - f.landingM) + f.landingM;
          if (left > bound) {
            over.push(
              `${t.toFixed(0)} ms: ${left.toFixed(0)} > ${bound.toFixed(0)} m`,
            );
          }
        }
        expect(over).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("never climbs above a start below the bend, and lands exactly", () => {
    fc.assert(
      fc.property(flight, (f) => {
        fc.pre(f.startM <= bendAltitudeM(f.landingM) && f.startM >= f.landingM);
        const { path } = plan(f);
        let top = 0;
        for (let i = 0; i <= 400; i++) {
          top = Math.max(
            top,
            flightAt(path, (f.durationMs * i) / 400).altitudeM,
          );
        }
        expect(top).toBeLessThanOrEqual(path.geodesicAt(0).h * (1 + 1e-9));
        expect(flightAt(path, f.durationMs).altitudeM).toBe(f.landingM);
      }),
      { numRuns: 100 },
    );
  });

  // A start at least the dive's own track from its landing point only ever
  // approaches it; a nearer one backs off first (it must curve in at 45
  // degrees), never further than that track.
  it("never moves the camera away from its landing point, but to make room for the dive", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const roomy = path.cameraArcRad >= path.diveArcRad;
        let prev = Infinity;
        let worst = 0;
        let farthest = 0;
        for (let t = 0; t <= f.durationMs; t += f.durationMs / 400) {
          const cam = flightCamera(path, t).position.clone().normalize();
          const d = between(cam, path.cameraEnd) * R;
          worst = Math.max(worst, d - prev);
          farthest = Math.max(farthest, d);
          prev = d;
        }
        // A centimetre: rounding on the sphere, not a backwards slide.
        expect(roomy ? worst : 0).toBeLessThan(0.01);
        expect(farthest).toBeLessThanOrEqual(
          // 5 cm: the camera is rebuilt from its view (centimetres of
          // rounding at a 100 m climb), not a slide.
          Math.max(between(path.cameraStart, path.cameraEnd), path.diveArcRad) *
            R +
            0.05,
        );
      }),
      { numRuns: 200 },
    );
  });

  // WHY (R1 milestone review, finding 1): below the bend the camera
  // travels the way it looks (a start over its own target flew the whole
  // dive backwards). Its ground travel and its view's heading never point
  // more than 90 degrees apart there, from any start.
  it("never travels against where it looks below the bend", () => {
    fc.assert(
      fc.property(flight, (f) => {
        const { path } = plan(f);
        const bend = bendAltitudeM(f.landingM);
        let worst = 0;
        const step = f.durationMs / 400;
        for (let i = 1; i < 400; i++) {
          const t = i * step;
          const c = flightCamera(path, t);
          const fr = flightAt(path, t);
          // Judged where the view clearly looks ahead, on the motion around
          // the frame: the view follows the travel there, so at a pitch near
          // 90 the camera moves nearly straight down and the direction of
          // its centimetres of horizontal motion is noise (it straddled the
          // instant a back-off reverses into the dive).
          if (c.altitudeM >= bend || c.altitudeM <= f.landingM * 1.05) continue;
          if (fr.pitchDeg >= 80) continue;
          // And after the start's own view has blended out: a start just
          // over one landing from its target, the target behind its screen's
          // up, rolls its heading 180 degrees over the first fifth (CF1's
          // start blend, the documented limit), while it already travels.
          if (fr.startWeight > 0) continue;
          const up = c.position.clone().normalize();
          const travel = flightCamera(path, t + step / 4)
            .position.clone()
            .sub(flightCamera(path, t - step / 4).position)
            .projectOnPlane(up);
          if (travel.length() > 1e-3) {
            worst = Math.max(worst, travel.angleTo(fr.heading));
          }
        }
        // At most perpendicular: the instant a back-off reverses into the
        // dive reads exactly 90 degrees.
        expect(worst).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      }),
      { numRuns: 100 },
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
