/**
 * Why this test matters: the owner's report on r790 (2026-10-07): the
 * pin's flight "stops again near the Earth, and only then flies in", and
 * it should be "one continuous, clean flight that dives into the
 * atmosphere at an angle; it must never stop in between or brake oddly"
 * (continuous-flight plan 2026-10-07-0941, CF1). These tests hold the
 * path to that, measured the way a viewer would judge it: the camera's
 * speed v = sqrt((d ln h/dt)^2 + (ground speed / h)^2) (the cold review's
 * criterion, finding 3), sampled at 30, 60 and 120 Hz from 0.5 s after the
 * press until 3 x the landing altitude:
 * - (a) no stall: v never below half its median;
 * - (b) no stop-and-go: v_j >= 0.8 x min(v_i, v_k) for every i < j < k;
 * - (c) no late surge: v below 100 km at most 1.25 x the largest v above.
 * The tolerances are swept (0.1-0.3) and the verdict reported across them,
 * and a positive control shows the criterion catches today's paced dive.
 */

import { describe, expect, it } from "vitest";

import * as THREE from "three";
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
} from "./flight-path.js";
import {
  criterionWindow,
  noLateSurge,
  noStall,
  noStopAndGo,
  speedSamples,
  type SpeedSample,
} from "./test-utils/flight-speed.js";

const R = 6_371_000;
const KM = 1_000;
const DEG = Math.PI / 180;
const BERN = { lat: 46.948, lng: 7.4474 };

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

describe("FLIGHT_PATH", () => {
  // DEC-CF-2: a shallow entry, 20-25 degrees below the horizontal through
  // the atmosphere, 45 at the landing.
  it("enters at 20-25 degrees and lands at 45", () => {
    expect(FLIGHT_PATH.entryPitchDeg).toBeGreaterThanOrEqual(20);
    expect(FLIGHT_PATH.entryPitchDeg).toBeLessThanOrEqual(25);
    expect(FLIGHT_PATH.landingPitchDeg).toBe(45);
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

  // WHY: a kink in the pitch is a jump in the camera's turn rate.
  it("changes smoothly with the altitude's logarithm", () => {
    let prev = descentPitchDeg(1 * KM, { landingM });
    let worst = 0;
    for (let lh = Math.log(1 * KM); lh <= Math.log(60_000 * KM); lh += 0.001) {
      const p = descentPitchDeg(Math.exp(lh), { landingM });
      worst = Math.max(worst, Math.abs(p - prev));
      prev = p;
    }
    // 0.001 in ln h; the steepest band (45 to 22.5 over ln 5) moves about
    // 0.02 degrees per step; a kink or a step would read far more.
    expect(worst).toBeLessThan(0.05);
  });

  it("rejects a non-finite altitude or landing", () => {
    expect(() => descentPitchDeg(NaN, { landingM })).toThrow(RangeError);
    expect(() => descentPitchDeg(1, { landingM: 0 })).toThrow(RangeError);
  });
});

describe("planFlight and flightAt", () => {
  const landingM = 2 * KM;
  const plan = (startKm: number, awayDeg: number, l = landingM) =>
    planFlight(
      WGS84_ELLIPSOID,
      startAt(awayFromBern(awayDeg), startKm * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM: l, durationMs: 15_000 },
    );

  // WHY: a jump at the press is the camera snapping from where it was.
  it("starts exactly where the camera is", () => {
    const start = startAt(awayFromBern(30), 10_100 * KM);
    const path = planFlight(
      WGS84_ELLIPSOID,
      start,
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM, durationMs: 15_000 },
    );
    const c = flightCamera(path, 0);
    const startPos = start.pose.direction
      .clone()
      .multiplyScalar(start.distanceM);
    expect(c.position.distanceTo(startPos)).toBeLessThan(1e-3);
    expect(c.quaternion.angleTo(start.quaternion)).toBeLessThan(1e-6);
  });

  // WHY: a missed end is a landing somewhere else.
  it("ends exactly at the landing over the target, at the landing pitch", () => {
    const path = plan(10_100, 30);
    const end = flightAt(path, path.durationMs);
    expect(end.done).toBe(true);
    expect(end.altitudeM).toBeCloseTo(landingM, 6);
    expect(end.arcRad).toBeCloseTo(0, 9);
    expect(end.pitchDeg).toBeCloseTo(45, 6);
    const target = orbitPose(WGS84_ELLIPSOID, BERN).direction;
    expect(end.centre.angleTo(target)).toBeLessThan(1e-9);
    expect(flightAt(path, path.durationMs - 1).done).toBe(false);
    expect(flightAt(path, path.durationMs + 5_000).altitudeM).toBeCloseTo(
      landingM,
      6,
    );
  });

  // WHY (cold review finding 2): a turn in time with an exponential
  // descent is hundreds of km/s near the ground. The remaining ground arc
  // is held to k x the height above the landing, plus one landing altitude:
  // a target nearer than the altitude is flown near the geodesic's top,
  // where the height barely falls (the property test found a 2 m hop at
  // 1 km against a bound of 1 m), and from 45 degrees down the target is a
  // landing altitude ahead anyway.
  it("keeps the remaining ground arc within k x the height above the landing", () => {
    for (const awayDeg of [0, 10, 45, 90, 179]) {
      const path = plan(43_600, awayDeg);
      for (let t = 0; t <= path.durationMs; t += 50) {
        const f = flightAt(path, t);
        expect(f.arcRad * R).toBeLessThanOrEqual(
          FLIGHT_PATH.arcPerAltitude * (f.altitudeM - landingM) + landingM,
        );
      }
    }
  });

  // WHY: the view's centre travels the great circle to the target, never
  // off it (a path that wandered would bend the ground track).
  it("moves the view's centre along the great circle to the target", () => {
    const path = plan(10_100, 60);
    const a = path.startCentre;
    const b = orbitPose(WGS84_ELLIPSOID, BERN).direction;
    const n = new THREE.Vector3().crossVectors(a, b).normalize();
    for (let t = 0; t <= path.durationMs; t += 250) {
      expect(Math.abs(flightAt(path, t).centre.dot(n))).toBeLessThan(1e-9);
    }
  });

  // WHY (cold review finding 2): obliqueCamera puts the camera behind the
  // view's centre along `up`; the course must be that up, or a northern
  // approach flies backwards and an east-west one crabs.
  it("puts the camera behind the view's centre along its course", () => {
    // Approaches from the east, the west, the north and the south: a fixed
    // north-up camera would fly backwards from the north and crab from the
    // east or west, which only the direction of the offset can show.
    const starts = [
      awayFromBern(40),
      awayFromBern(-40),
      { lat: BERN.lat + 25, lng: BERN.lng },
      { lat: BERN.lat - 25, lng: BERN.lng },
    ];
    const target = orbitPose(WGS84_ELLIPSOID, BERN).direction;
    for (const from of starts) {
      const path = planFlight(
        WGS84_ELLIPSOID,
        startAt(from, 10_100 * KM),
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM, durationMs: 15_000 },
      );
      const normal = new THREE.Vector3()
        .crossVectors(path.startCentre, target)
        .normalize();
      for (let t = 4_000; t < path.durationMs; t += 500) {
        const f = flightAt(path, t);
        const course = new THREE.Vector3()
          .crossVectors(normal, f.centre)
          .normalize();
        const cam = flightCamera(path, t).position.clone().normalize();
        // From the camera to the view's centre, on the ground's plane: the
        // way it looks and flies.
        const ahead = f.centre.clone().sub(cam).projectOnPlane(f.centre);
        expect(ahead.length()).toBeGreaterThan(0);
        expect(ahead.angleTo(course)).toBeLessThan(2 * DEG);
      }
    }
  });

  // WHY: a descent that reverses reads as a bounce.
  it("only descends from a start above the glide slope", () => {
    const path = plan(10_100, 30);
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
    const path = plan(2, 60);
    let top = 0;
    for (let t = 0; t <= path.durationMs; t += 50) {
      top = Math.max(top, flightAt(path, t).altitudeM);
    }
    // The arc is the great circle's (60 degrees of longitude at 47 N is
    // about 40 degrees of it), not the longitude difference.
    expect(top).toBeGreaterThan(
      ((path.arcRad * R) / FLIGHT_PATH.arcPerAltitude) * 0.9,
    );
  });

  // WHY (found by the property test, 2026-10-07): a start a hair off the
  // target (a press right above the device) made the arc micrometres
  // long, and van Wijk's ln(sqrt(b^2 + 1) - b) cancelled to ln(0): NaN
  // altitudes. Such a flight is a pure zoom.
  it("stays finite when the start is a hair off the target", () => {
    for (const offDeg of [1e-12, 1e-9, 1e-6]) {
      const path = planFlight(
        WGS84_ELLIPSOID,
        startAt({ lat: 1e-11, lng: offDeg }, 1 * KM),
        orbitPose(WGS84_ELLIPSOID, { lat: 0, lng: 0 }),
        { landingM: 1.08 * KM, durationMs: 4_000 },
      );
      for (let t = 0; t <= 4_000; t += 40) {
        const f = flightAt(path, t);
        expect(Number.isFinite(f.altitudeM)).toBe(true);
        expect(f.altitudeM).toBeGreaterThanOrEqual(1 * KM * (1 - 1e-9));
      }
    }
  });

  it("rejects bad numbers", () => {
    const start = startAt(BERN, 10_000 * KM);
    const to = orbitPose(WGS84_ELLIPSOID, BERN);
    expect(() =>
      planFlight(WGS84_ELLIPSOID, start, to, { landingM: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      planFlight(WGS84_ELLIPSOID, start, to, {
        landingM,
        durationMs: -1,
      }),
    ).toThrow(RangeError);
  });
});

describe("never stops in between (the cold review's criterion)", () => {
  const starts = [
    { label: "landscape fit", km: 10_100 },
    { label: "portrait fit", km: 25_000 },
    { label: "the spin", km: 43_600 },
    { label: "low and far (climbs first)", km: 2 },
  ];
  const arcs = [0, 30, 90, 179];
  const landings = [2 * KM, 12 * KM];
  const TOLS = [0.1, 0.2, 0.3];

  for (const { label, km } of starts) {
    for (const awayDeg of arcs) {
      for (const landingM of landings) {
        // A low start with no arc is already at its landing: nothing to fly.
        if (km < 10 && awayDeg === 0) continue;
        it(`${label}, ${awayDeg} degrees away, landing ${landingM / KM} km`, () => {
          const path = planFlight(
            WGS84_ELLIPSOID,
            startAt(awayFromBern(awayDeg), km * KM),
            orbitPose(WGS84_ELLIPSOID, BERN),
            { landingM, durationMs: 15_000 },
          );
          for (const hz of [30, 60, 120]) {
            const w = criterionWindow(
              speedSamples((t) => flightAt(path, t), path.durationMs, hz, R),
              landingM,
            );
            const vs = w.map((s) => s.v);
            expect(vs.length).toBeGreaterThan(10);
            expect(noStall(vs, 0.5)).toBe(true);
            // Reported across the sweep; asserted at the review's 0.2.
            const verdicts = TOLS.map((tol) => noStopAndGo(vs, tol));
            expect(
              verdicts[1],
              `tolerances ${JSON.stringify(TOLS)}: ${JSON.stringify(verdicts)}`,
            ).toBe(true);
            expect(noLateSurge(w, 1.25)).toBe(true);
          }
        });
      }
    }
  }

  // The positive control (cold review finding 3): today's dive on the
  // paced clock, the data released late, must fail (b) or (c) somewhere,
  // or the criterion could not see the owner's report at all.
  it("catches today's paced dive with a late release", () => {
    const fromM = 10_100 * KM;
    const toM = 2 * KM;
    const rows: string[] = [];
    let caught = 0;
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
      if (!b || !c) caught += 1;
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
    expect(caught).toBeGreaterThan(0);
  });
});
