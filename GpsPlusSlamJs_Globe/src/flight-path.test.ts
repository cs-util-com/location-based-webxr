/**
 * Why this test matters: the owner's report on r790 (2026-10-07): the
 * pin's flight "stops again near the Earth, and only then flies in", and
 * it should be "one continuous, clean flight that dives into the
 * atmosphere at an angle; it must never stop in between or brake oddly"
 * (continuous-flight plan 2026-10-07-0941, CF1). These tests hold the path
 * to that, measured on the CAMERA, the way a viewer flies it (the CF1
 * milestone review found the view's centre a circular measure: it moved at
 * a constant speed by construction while the camera slid backwards):
 * v = sqrt((d ln h/dt)^2 + (ground speed / h)^2) over the flight's cruise
 * (from the ramp's end to the settle's start), at 4-120 Hz (differencing
 * windows of 250 to 8 ms):
 * - (a) no stall: v never below half its median;
 * - (b) no stop-and-go: v_j >= (1 - tol) x min(v_i, v_k), every i < j < k,
 *   for tol 0.1, 0.2 and 0.3;
 * - (c) no late surge: v below 100 km at most 1.25 x the largest above.
 * The camera never moves backwards, the view never turns by more than a
 * few degrees in one frame, and a positive control shows the criterion
 * catches today's paced dive.
 */

import { describe, expect, it } from "vitest";

import type * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { diveAt, obliqueCamera } from "./globe-dive.js";
import { FLIGHT_PACE_DEFAULTS, startPace, stepPace } from "./flight-pace.js";
import {
  FLIGHT_PATH,
  descentPitchDeg,
  flightAt,
  flightCamera,
  planFlight,
  type FlightPath,
} from "./flight-path.js";
import {
  criterionWindow,
  noLateSurge,
  noStall,
  noStopAndGo,
  speedSamples,
  windowBetween,
  type SpeedSample,
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
const KM = 1_000;
const DEG = Math.PI / 180;
const BERN = { lat: 46.948, lng: 7.4474 };
const BERN_DIR = orbitPose(WGS84_ELLIPSOID, BERN).direction;
/** The tests' bound on the remaining ground distance over the height above the landing. */
const K_ARC = 2;

/** The horizon's dip below the local horizontal at an altitude, degrees. */
const dipDeg = (h: number) => Math.acos(R / (R + h)) / DEG;

/** A start `altitudeM` above `place`, north up, looking straight down. */
function startAt(place: { lat: number; lng: number }, altitudeM: number) {
  const pose = orbitPose(WGS84_ELLIPSOID, place);
  const camera = obliqueCamera(WGS84_ELLIPSOID, pose, altitudeM, 90);
  return {
    pose,
    distanceM: camera.position.length(),
    quaternion: camera.quaternion,
  };
}

/**
 * The place `deg` degrees of longitude east of Bern: at 47 N that is about
 * 0.68 x `deg` of great circle (the path's `arcRad` has the real angle).
 */
function awayFromBern(deg: number) {
  return { lat: BERN.lat, lng: BERN.lng + deg };
}

/** Starts from the four sides of Bern, on its meridian and its parallel. */
const SIDES = {
  north: { lat: BERN.lat + 25, lng: BERN.lng },
  south: { lat: BERN.lat - 25, lng: BERN.lng },
  east: awayFromBern(35),
  west: awayFromBern(-35),
};

function fly(
  from: { lat: number; lng: number },
  startM: number,
  options: {
    landingM?: number;
    durationMs?: number;
    settleFactor?: number;
  } = {},
): FlightPath {
  return planFlight(
    WGS84_ELLIPSOID,
    startAt(from, startM),
    orbitPose(WGS84_ELLIPSOID, BERN),
    {
      landingM: options.landingM ?? 2 * KM,
      durationMs: options.durationMs ?? 15_000,
      ...(options.settleFactor === undefined
        ? {}
        : { settleFactor: options.settleFactor }),
    },
  );
}

/** The camera as a sampled point. */
const cameraPoint = (path: FlightPath) => (t: number) => {
  const c = flightCamera(path, t);
  return { altitudeM: c.altitudeM, direction: c.position.clone().normalize() };
};

describe("FLIGHT_PATH", () => {
  // DEC-CF-2: a shallow entry, 20-25 degrees below the horizontal through
  // the atmosphere, 45 at the landing.
  it("enters at 20-25 degrees and lands at 45", () => {
    expect(FLIGHT_PATH.entryPitchDeg).toBeGreaterThanOrEqual(20);
    expect(FLIGHT_PATH.entryPitchDeg).toBeLessThanOrEqual(25);
    expect(FLIGHT_PATH.landingPitchDeg).toBe(45);
  });
});

describe("the criterion's checks", () => {
  // WHY (CF1 review finding 8): (b) had never been shown to fail on
  // anything; each check must catch its own shape.
  it("catches a stall, a stop-and-go and a late surge", () => {
    expect(noStall([1, 1, 0.3, 1, 1], 0.5)).toBe(false);
    expect(noStall([1, 1, 0.9, 1, 1], 0.5)).toBe(true);
    expect(noStopAndGo([1, 1, 0.7, 1, 1], 0.2)).toBe(false);
    expect(noStopAndGo([1, 1, 0.9, 1, 1], 0.2)).toBe(true);
    // A slowing to the end is not a stop-and-go: nothing faster follows.
    expect(noStopAndGo([1, 0.8, 0.5, 0.3], 0.2)).toBe(true);
    const surge = [
      { t: 0, h: 500 * KM, v: 1 },
      { t: 1, h: 50 * KM, v: 2 },
    ];
    expect(noLateSurge(surge, 1.25)).toBe(false);
    const steady = [
      { t: 0, h: 500 * KM, v: 1 },
      { t: 1, h: 50 * KM, v: 1.2 },
    ];
    expect(noLateSurge(steady, 1.25)).toBe(true);
  });
});

describe("descentPitchDeg", () => {
  const landingM = 2 * KM;

  it("looks at the centre far out", () => {
    for (const h of [5_000 * KM, 20_000 * KM, 60_000 * KM]) {
      expect(descentPitchDeg(h, { landingM })).toBeCloseTo(90, 6);
    }
  });

  // WHY: the owner's "dive into the atmosphere at an angle" (DEC-CF-2):
  // between 100 km and 5 x the landing the view is shallow.
  it("is shallow from 100 km down to 5 x the landing", () => {
    for (let h = 100 * KM; h >= 5 * landingM; h /= 1.1) {
      const p = descentPitchDeg(h, { landingM });
      expect(p).toBeGreaterThanOrEqual(20);
      expect(p).toBeLessThanOrEqual(25);
    }
  });

  it("is 45 degrees at the landing, for landings up to 100 km", () => {
    for (const l of [1 * KM, 2 * KM, 12 * KM, 40 * KM, 100 * KM]) {
      expect(descentPitchDeg(l, { landingM: l })).toBeCloseTo(45, 6);
    }
  });

  // WHY (cold review finding 6): the view's centre is the target, so the
  // law never looks past the horizon (dip + 5 degrees, as `pitchAtDeg`).
  it("never looks less than 5 degrees below the horizon", () => {
    for (let h = 1 * KM; h <= 60_000 * KM; h *= 1.05) {
      expect(descentPitchDeg(h, { landingM })).toBeGreaterThanOrEqual(
        dipDeg(h) + 5 - 1e-9,
      );
    }
  });

  // WHY: a step in the pitch is a jump in the view, a kink a jump in its
  // turn rate. First differences catch the one, second differences the
  // other (CF1 review finding 9).
  it("changes without a step or a kink in the altitude's logarithm", () => {
    const step = 0.001;
    const at = (lh: number) => descentPitchDeg(Math.exp(lh), { landingM });
    let worstFirst = 0;
    let worstSecond = 0;
    for (let lh = Math.log(1 * KM); lh <= Math.log(60_000 * KM); lh += step) {
      const a = at(lh - step);
      const b = at(lh);
      const c = at(lh + step);
      worstFirst = Math.max(worstFirst, Math.abs(c - b));
      worstSecond = Math.max(worstSecond, Math.abs(c - 2 * b + a));
    }
    // The steepest band moves about 0.026 degrees per step; a kink of even
    // 10 degrees per unit of ln h reads 0.01 in the second difference, the
    // smooth bands about 1e-4.
    expect(worstFirst).toBeLessThan(0.05);
    expect(worstSecond).toBeLessThan(0.002);
  });

  it("rejects a non-finite altitude, a bad landing or a bad pitch", () => {
    expect(() => descentPitchDeg(NaN, { landingM })).toThrow(RangeError);
    expect(() => descentPitchDeg(1, { landingM: 0 })).toThrow(RangeError);
    expect(() => descentPitchDeg(1, { landingM, entryDeg: 0 })).toThrow(
      RangeError,
    );
    expect(() => descentPitchDeg(1, { landingM, landingDeg: 91 })).toThrow(
      RangeError,
    );
  });
});

describe("planFlight and flightAt", () => {
  const landingM = 2 * KM;

  // WHY: a jump at the press is the camera snapping from where it was.
  it("starts exactly where the camera is", () => {
    const start = startAt(awayFromBern(30), 10_100 * KM);
    const path = planFlight(
      WGS84_ELLIPSOID,
      start,
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM },
    );
    const c = flightCamera(path, 0);
    const startPos = start.pose.direction
      .clone()
      .multiplyScalar(start.distanceM);
    expect(c.position.distanceTo(startPos)).toBeLessThan(1e-3);
    expect(c.quaternion.angleTo(start.quaternion)).toBeLessThan(1e-6);
  });

  // WHY (CF2 replans from a camera mid-flight): an oblique start, its view
  // on a centre ahead of it, must start exactly where it is too.
  it("starts exactly where an oblique camera is", () => {
    const pose = orbitPose(WGS84_ELLIPSOID, awayFromBern(-20));
    const oblique = obliqueCamera(WGS84_ELLIPSOID, pose, 40 * KM, 30);
    const camDir = oblique.position.clone().normalize();
    const up = pose.up.clone().projectOnPlane(camDir).normalize();
    const path = planFlight(
      WGS84_ELLIPSOID,
      {
        pose: { direction: camDir, up },
        distanceM: oblique.position.length(),
        quaternion: oblique.quaternion,
        pitchDeg: 30,
      },
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM },
    );
    const c = flightCamera(path, 0);
    expect(c.position.distanceTo(oblique.position)).toBeLessThan(1);
    expect(c.quaternion.angleTo(oblique.quaternion)).toBeLessThan(1e-4);
  });

  // WHY (found by CF2's replan probe, 2026-10-07): the course was taken
  // from the start's VIEW CENTRE to the target. An oblique camera low and
  // near the target looks past it (at 79 km and 22.5 degrees the centre is
  // 190 km ahead), so that great circle pointed back at the camera and the
  // view rolled 180 degrees to look behind. The course runs from the
  // camera, which is what travels.
  it("keeps heading to the target when its oblique view looks past it", () => {
    const west = orbitPose(WGS84_ELLIPSOID, awayFromBern(-1));
    const cam = obliqueCamera(WGS84_ELLIPSOID, west, 79 * KM, 90);
    const camDir = cam.position.clone().normalize();
    const east = BERN_DIR.clone()
      .sub(camDir)
      .projectOnPlane(camDir)
      .normalize();
    const path = planFlight(
      WGS84_ELLIPSOID,
      {
        pose: { direction: camDir, up: east },
        distanceM: cam.position.length(),
        pitchDeg: 22.5,
      },
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM },
    );
    expect(Math.abs(path.startRollRad) / DEG).toBeLessThan(2);
    for (const t of [0, 1_000, 3_000, 6_000]) {
      const f = flightAt(path, t);
      const ahead = f.centre.clone().sub(f.camera).projectOnPlane(f.camera);
      const toTarget = BERN_DIR.clone().sub(f.camera).projectOnPlane(f.camera);
      expect(ahead.angleTo(toTarget) / DEG, `at ${t} ms`).toBeLessThan(2);
    }
  });

  // WHY (CF3): the pin's hold flies to 2,000 km over where the camera
  // looks and replans to the real landing at the fix. If that stop looked
  // like a landing (45 degrees), the view would steepen and swing back at
  // the replan; it must look as the whole flight would there.
  it("looks as the final flight would when it stops short of its landing", () => {
    const viewLandingM = 2 * KM;
    const path = planFlight(
      WGS84_ELLIPSOID,
      startAt(awayFromBern(30), 10_100 * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM: 100 * KM, viewLandingM },
    );
    const law = descentPitchDeg(100 * KM, { landingM: viewLandingM });
    const end = flightAt(path, path.durationMs);
    expect(end.pitchDeg).toBeCloseTo(law, 6);
    expect(end.altitudeM).toBe(100 * KM);
    expect(end.centre.distanceTo(BERN_DIR)).toBeLessThan(1e-9);
    // The frame before the end is the end within a metre: no snap.
    const before = flightCamera(path, path.durationMs - 1).position;
    const atEnd = flightCamera(path, path.durationMs).position;
    expect(before.distanceTo(atEnd)).toBeLessThan(1);
    for (let t = 0; t < path.durationMs; t += 250) {
      const f = flightAt(path, t);
      if (f.startWeight > 0) continue;
      expect(f.pitchDeg).toBeCloseTo(
        descentPitchDeg(f.altitudeM, { landingM: viewLandingM }),
        6,
      );
    }
  });

  // WHY: a missed end is a landing somewhere else.
  it("ends exactly at the landing over the target, at the landing pitch", () => {
    const path = fly(awayFromBern(30), 10_100 * KM);
    const end = flightAt(path, path.durationMs);
    expect(end.done).toBe(true);
    expect(end.altitudeM).toBeCloseTo(landingM, 6);
    expect(end.arcRad).toBeCloseTo(0, 9);
    expect(end.pitchDeg).toBeCloseTo(45, 6);
    expect(end.centre.distanceTo(BERN_DIR)).toBeLessThan(1e-9);
    expect(flightAt(path, path.durationMs - 1).done).toBe(false);
    // The last frame before the end is the end within a metre: no snap.
    const before = flightCamera(path, path.durationMs - 1).position;
    const atEnd = flightCamera(path, path.durationMs).position;
    expect(before.distanceTo(atEnd)).toBeLessThan(1);
    expect(flightAt(path, path.durationMs + 5_000).altitudeM).toBeCloseTo(
      landingM,
      6,
    );
  });

  // WHY (cold review finding 2): a turn spread in time with an exponential
  // descent is hundreds of km/s near the ground. The remaining ground
  // distance is held to K_ARC x the height above the landing, plus one
  // landing altitude: a target nearer than the altitude is flown near the
  // geodesic's top, where the height barely falls (the property test found
  // a 2 m hop at 1 km), and from 45 degrees down it is a landing ahead
  // anyway. Not a production constant (CF1 review finding 9): the geodesic
  // keeps the ratio above 1 only at its arch. Measured on the camera, which
  // flies the geodesic (its view's centre is up to a landing ahead).
  it("keeps the camera's remaining ground distance within K_ARC x the height above the landing", () => {
    for (const awayDeg of [0, 10, 45, 90, 179]) {
      const path = fly(awayFromBern(awayDeg), 43_600 * KM);
      for (let t = 0; t <= path.durationMs; t += 50) {
        const f = flightAt(path, t);
        expect(f.camera.angleTo(path.cameraEnd) * R).toBeLessThanOrEqual(
          K_ARC * (f.altitudeM - landingM) + landingM,
        );
      }
    }
  });

  // WHY (CF1 review finding 2): the camera slid backwards over the ground
  // (up to 137 km/s) as the view tilted from 90 degrees. The camera flies
  // the path now, its view looking ahead, so it only ever closes in.
  it("never moves the camera away from the target", () => {
    for (const from of [...Object.values(SIDES), awayFromBern(90)]) {
      for (const startM of [10_100 * KM, 2 * KM]) {
        const path = fly(from, startM);
        let prev = Infinity;
        let worst = 0;
        for (let t = 0; t <= path.durationMs; t += 1000 / 60) {
          const cam = flightCamera(path, t).position.clone().normalize();
          const d = between(cam, BERN_DIR) * R;
          worst = Math.max(worst, d - prev);
          prev = d;
        }
        expect(
          worst,
          `from ${JSON.stringify(from)} at ${startM} m`,
        ).toBeLessThan(0.01);
      }
    }
  });

  // WHY (CF1 review finding 1): the roll was recomputed per frame from a
  // cross product that is rounding noise when the start's up points away
  // from the course, so a start due north of the target flipped the view by
  // up to 179 degrees in one frame (465 of 900 meridian approaches).
  it("never turns the view by more than 3 degrees in one 60 Hz frame", () => {
    const starts = [
      ...Object.values(SIDES),
      { lat: 71.948, lng: 7.4474 },
      { lat: -10, lng: 7.4474 },
    ];
    for (const from of starts) {
      const path = fly(from, 10_100 * KM);
      let prev = flightCamera(path, 0).quaternion;
      let worst = 0;
      for (let t = 1000 / 60; t <= path.durationMs; t += 1000 / 60) {
        const q = flightCamera(path, t).quaternion;
        worst = Math.max(worst, q.angleTo(prev) / DEG);
        prev = q;
      }
      expect(worst, `from ${JSON.stringify(from)}`).toBeLessThan(3);
    }
  });

  // WHY (CF1 review finding 5): a start a metre north of the target rolled
  // the view by 180 degrees to face a "course" one metre long. A target
  // nearer than one landing altitude keeps the start's up.
  it("keeps the start's up when the target is nearer than the landing", () => {
    const offsets = [
      [1e-5, 0],
      [0, 1e-5],
      [-1e-5, 0],
      [0.01, 0],
    ] as const;
    const north = orbitPose(WGS84_ELLIPSOID, BERN).up;
    for (const [dLat, dLng] of offsets) {
      const from = { lat: BERN.lat + dLat, lng: BERN.lng + dLng };
      const end = flightAt(fly(from, 10_100 * KM), 15_000);
      expect(
        end.up.angleTo(north) / DEG,
        `offset ${dLat}, ${dLng}`,
      ).toBeLessThan(2);
    }
  });

  // WHY: obliqueCamera puts the camera behind the view's centre along up;
  // up must be the course, or a northern approach flies backwards and an
  // east-west one crabs. Checked by the offset's direction, after the
  // start's blend, from all four sides.
  it("looks ahead along its course", () => {
    for (const from of Object.values(SIDES)) {
      const path = fly(from, 10_100 * KM);
      const blendEnd = FLIGHT_PATH.startBlendShare * path.durationMs;
      for (let t = blendEnd + 500; t < path.durationMs - 500; t += 500) {
        const f = flightAt(path, t);
        const cam = flightCamera(path, t).position.clone().normalize();
        const toTarget = BERN_DIR.clone().sub(cam).projectOnPlane(cam);
        const ahead = f.centre.clone().sub(cam).projectOnPlane(cam);
        expect(ahead.angleTo(toTarget) / DEG).toBeLessThan(2);
      }
    }
  });

  // WHY: a descent that reverses reads as a bounce.
  it("only descends from a start above the arch", () => {
    const path = fly(awayFromBern(30), 10_100 * KM);
    let prev = Infinity;
    for (let t = 0; t <= path.durationMs; t += 10) {
      const h = flightAt(path, t).altitudeM;
      expect(h).toBeLessThanOrEqual(prev * (1 + 1e-12));
      prev = h;
    }
  });

  // WHY (cold review finding 2): a start low and far away (a press after
  // zooming in elsewhere) must climb before it crosses, not slide over the
  // ground at continental speed.
  it("climbs first from a start low and far away", () => {
    const path = fly(awayFromBern(60), 2 * KM);
    let top = 0;
    for (let t = 0; t <= path.durationMs; t += 50) {
      top = Math.max(top, flightAt(path, t).altitudeM);
    }
    // The geodesic's arch is about half the ground distance high.
    expect(top).toBeGreaterThan(((path.arcRad * R) / K_ARC) * 0.9);
  });

  // WHY (found by the property test, 2026-10-07): a start a hair off the
  // target made the arc micrometres long, and van Wijk's
  // ln(sqrt(b^2 + 1) - b) cancelled to ln(0): NaN altitudes.
  it("stays finite when the start is a hair off the target", () => {
    for (const offDeg of [1e-12, 1e-9, 1e-6]) {
      const path = planFlight(
        WGS84_ELLIPSOID,
        startAt({ lat: 1e-11, lng: offDeg }, 1 * KM),
        orbitPose(WGS84_ELLIPSOID, { lat: 0, lng: 0 }),
        { landingM: 1.08 * KM, durationMs: 4_000 },
      );
      for (let t = 0; t <= 4_000; t += 40) {
        const f = flightCamera(path, t);
        expect(Number.isFinite(f.altitudeM)).toBe(true);
        expect(Number.isFinite(f.position.x)).toBe(true);
        expect(f.altitudeM).toBeGreaterThanOrEqual(1 * KM * (1 - 1e-9));
      }
    }
  });

  // WHY (CF1 review finding 3): a replan passes the camera's speed; the
  // short-path fallback dropped it to rest, a jump in speed. Kept for every
  // speed the path can hold (at most 3 x its length over the duration, or
  // the Hermite would pass the end); the next test pins the cap.
  it("starts at the given speed and still ends exactly", () => {
    const base = fly(awayFromBern(30), 10_100 * KM);
    const nominal = base.geodesicLength / base.durationMs;
    const cases = [
      { from: awayFromBern(30), startM: 10_100 * KM },
      { from: BERN, startM: 20 * KM },
    ];
    for (const { from, startM } of cases) {
      const probe = planFlight(
        WGS84_ELLIPSOID,
        startAt(from, startM),
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM },
      );
      const holdable = (3 * probe.geodesicLength) / probe.durationMs;
      const speeds = [0, nominal, 3 * nominal, holdable].filter(
        (v) => v <= holdable,
      );
      expect(speeds.length).toBeGreaterThanOrEqual(2);
      for (const speed of speeds) {
        const path = planFlight(
          WGS84_ELLIPSOID,
          startAt(from, startM),
          orbitPose(WGS84_ELLIPSOID, BERN),
          { landingM, durationMs: 15_000, startSpeed: speed },
        );
        const v0 = path.travelledAt(1) - path.travelledAt(0);
        expect(Math.abs(v0 - speed)).toBeLessThanOrEqual(
          0.01 * Math.max(speed, nominal),
        );
        let prev = -Infinity;
        let worst = 0;
        for (let t = 0; t <= path.durationMs; t += 10) {
          const s = path.travelledAt(t);
          worst = Math.max(worst, prev - s, s - path.geodesicLength);
          prev = s;
        }
        expect(worst).toBeLessThanOrEqual(1e-12);
        expect(path.travelledAt(path.durationMs)).toBe(path.geodesicLength);
      }
    }
  });

  // WHY: the one case the start's speed is not kept, pinned so it stays
  // a known exception: a speed the path cannot hold is capped at 3 x its
  // length over the duration, and the flight still ends exactly. A replan
  // (CF2) chooses its duration from its speed so it never lands here.
  it("caps a start speed the path cannot hold, and still ends exactly", () => {
    const path = planFlight(
      WGS84_ELLIPSOID,
      startAt(BERN, 20 * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM, durationMs: 15_000, startSpeed: 0.05 },
    );
    const v0 = path.travelledAt(1) - path.travelledAt(0);
    const cap = (3 * path.geodesicLength) / path.durationMs;
    expect(Math.abs(v0 - cap)).toBeLessThan(0.01 * cap);
    expect(path.travelledAt(path.durationMs)).toBe(path.geodesicLength);
  });

  it("rejects bad numbers", () => {
    const start = startAt(BERN, 10_000 * KM);
    const to = orbitPose(WGS84_ELLIPSOID, BERN);
    const plan = (s: typeof start, o: Record<string, number>) => () =>
      planFlight(WGS84_ELLIPSOID, s, to, { landingM, ...o });
    expect(plan(start, { landingM: 0 })).toThrow(RangeError);
    expect(plan(start, { durationMs: -1 })).toThrow(RangeError);
    expect(plan({ ...start, distanceM: NaN }, {})).toThrow(RangeError);
    expect(plan(start, { entryPitchDeg: 0 })).toThrow(RangeError);
    expect(plan(start, { startSpeed: -1 })).toThrow(RangeError);
    expect(plan(start, { settleFactor: 1 })).toThrow(RangeError);
    const parallel = {
      ...start,
      pose: { direction: start.pose.direction, up: start.pose.direction },
    };
    expect(plan(parallel, {})).toThrow(RangeError);
    const path = planFlight(WGS84_ELLIPSOID, start, to, { landingM });
    expect(() => flightAt(path, NaN)).toThrow(RangeError);
  });
});

describe("never stops in between (measured on the camera)", () => {
  const starts = [
    { label: "landscape fit", km: 10_100 },
    { label: "portrait fit", km: 25_000 },
    { label: "the spin", km: 43_600 },
    { label: "low and far (climbs first)", km: 2 },
  ];
  const arcs = [0, 30, 90, 179];
  const landings = [2 * KM, 12 * KM];
  const HZ = [4, 10, 20, 30, 60, 120];
  const TOLS = [0.1, 0.2, 0.3];

  /** The criterion over the flight's cruise, at each frame rate. */
  function judge(path: FlightPath): string[] {
    const bad: string[] = [];
    const cruise = path.cruise;
    if (!cruise) return ["no cruise"];
    for (const hz of HZ) {
      const w = windowBetween(
        speedSamples(cameraPoint(path), path.durationMs, hz, R),
        cruise.fromMs,
        cruise.toMs,
      );
      const vs = w.map((s) => s.v);
      if (vs.length < 3) continue; // a 4 Hz sample of a short cruise
      if (!noStall(vs, 0.5)) bad.push(`${hz} Hz (a)`);
      for (const tol of TOLS) {
        if (!noStopAndGo(vs, tol)) bad.push(`${hz} Hz (b) ${tol}`);
      }
      if (!noLateSurge(w, 1.25)) bad.push(`${hz} Hz (c)`);
    }
    return bad;
  }

  for (const { label, km } of starts) {
    for (const awayDeg of arcs) {
      for (const landingM of landings) {
        // A low start with no arc is already at its landing: nothing to fly.
        if (km < 10 && awayDeg === 0) continue;
        it(`${label}, ${awayDeg} degrees away, landing ${landingM / KM} km`, () => {
          const path = fly(awayFromBern(awayDeg), km * KM, { landingM });
          expect(judge(path)).toEqual([]);
        });
      }
    }
  }

  // WHY (CF1 review finding 4): the settle's start is a parameter the
  // verdict rests on; swept over 2-5 x the landing.
  it("holds for settles starting at 2, 3 and 5 x the landing", () => {
    for (const settleFactor of [2, 3, 5]) {
      const path = fly(awayFromBern(30), 10_100 * KM, { settleFactor });
      expect(judge(path), `settle ${settleFactor}`).toEqual([]);
    }
  });

  // WHY (CF1 review finding 11): a pure climb (a press low, near the
  // target, with a higher landing) was never judged.
  it("holds for a pure climb to a higher landing", () => {
    const from = { lat: BERN.lat + 0.001, lng: BERN.lng };
    const path = fly(from, 100, { landingM: 12 * KM });
    expect(judge(path)).toEqual([]);
  });

  // The positive control (cold review finding 3): today's dive on the
  // paced clock, the data released late, must fail somewhere, or the
  // criterion could not see the owner's report at all.
  it("catches today's paced dive with a late release", () => {
    const fromM = 10_100 * KM;
    const toM = 2 * KM;
    const rows: string[] = [];
    for (const releaseKm of [500, 100, 30, 10]) {
      let pace = startPace(FLIGHT_PACE_DEFAULTS);
      const samples: SpeedSample[] = [];
      let prevH = fromM;
      const dt = 1000 / 60;
      for (let t = dt; !pace.done && t < 40_000; t += dt) {
        const progress = prevH <= releaseKm * KM ? 1 : 0;
        pace = stepPace(pace, progress, t, FLIGHT_PACE_DEFAULTS);
        const h = diveAt(pace.s * 15_000, {
          durationMs: 15_000,
          fromAltitudeM: fromM,
          toAltitudeM: toM,
        }).altitudeM;
        const v = Math.abs(Math.log(h) - Math.log(prevH)) / (dt / 1000);
        samples.push({ t, h, v });
        prevH = h;
      }
      const w = criterionWindow(samples, toM);
      const vs = w.map((s) => s.v);
      const b = noStopAndGo(vs, 0.2);
      const c = noLateSurge(w, 1.25);
      rows.push(
        `release ${releaseKm} km: (b) ${b ? "ok" : "FAIL"}, (c) ${c ? "ok" : "FAIL"}`,
      );
    }
    // Measured 2026-10-07: the late releases surge below 100 km and (c)
    // catches each; (b) never does (the slow stretch is at the end, not
    // between two faster ones), and a release at 500 km surges above 100
    // km, where no criterion looks: early data is not the owner's report.
    expect(rows).toEqual([
      "release 500 km: (b) ok, (c) ok",
      "release 100 km: (b) ok, (c) FAIL",
      "release 30 km: (b) ok, (c) FAIL",
      "release 10 km: (b) ok, (c) FAIL",
    ]);
  });
});
