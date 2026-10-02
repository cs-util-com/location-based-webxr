/**
 * Why this test matters: the pin's dive (round-2 plan 2026-09-26-2055
 * M3g; the owner's "turns the globe towards me and zooms in over about
 * 15 s") is a curve a viewer judges by eye, and its failures are glitches:
 * a jump at the start (the camera snapping from wherever the user left it),
 * a jump at the end (the hand-over altitude missed, so the city opens from
 * somewhere else), a descent that reverses, or a turn still running when
 * the camera is already low. So the ends are exact, the altitude moves one
 * way only and evenly in its logarithm (every halving of the height takes
 * as long as the one before, near the ends eased), and the turn is over
 * before the last stretch.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { pitchAtDeg } from "./globe-flight.js";
import {
  GLOBE_DIVE,
  diveAt,
  diveStep,
  orbitQuaternion,
  planDive,
  surfaceRadiusAlong,
} from "./globe-dive.js";

const altitude = fc
  .double({ min: Math.log(1_000), max: Math.log(60_000_000), noNaN: true })
  .map(Math.exp);
const duration = fc.integer({ min: 1, max: 120_000 });

describe("GLOBE_DIVE", () => {
  it("holds the owner's numbers: about 15 s, handed over at 150 km", () => {
    expect(GLOBE_DIVE.durationMs).toBe(15_000);
    expect(GLOBE_DIVE.handOverAltitudeM).toBe(150_000);
    expect(GLOBE_DIVE.turnShare).toBeGreaterThan(0);
    expect(GLOBE_DIVE.turnShare).toBeLessThan(1);
  });
});

describe("diveAt", () => {
  it("starts exactly where the camera is and ends exactly at the hand-over", () => {
    fc.assert(
      fc.property(altitude, altitude, duration, (from, to, durationMs) => {
        const opts = { durationMs, fromAltitudeM: from, toAltitudeM: to };
        const start = diveAt(0, opts);
        expect(start.altitudeM).toBe(from);
        expect(start.turnT).toBe(0);
        expect(start.done).toBe(false);
        const end = diveAt(durationMs, opts);
        expect(end.altitudeM).toBe(to);
        expect(end.turnT).toBe(1);
        expect(end.done).toBe(true);
        // Past the end it holds; before the start it holds.
        expect(diveAt(durationMs * 3, opts).altitudeM).toBe(to);
        expect(diveAt(-5, opts).altitudeM).toBe(from);
      }),
    );
  });

  it("moves the altitude one way only, and the turn forward only", () => {
    fc.assert(
      fc.property(
        altitude,
        altitude,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (from, to, a, b) => {
          const opts = {
            durationMs: 15_000,
            fromAltitudeM: from,
            toAltitudeM: to,
          };
          const [early, late] = a <= b ? [a, b] : [b, a];
          const p = diveAt(early * 15_000, opts);
          const q = diveAt(late * 15_000, opts);
          const lo = Math.min(from, to) * (1 - 1e-12);
          const hi = Math.max(from, to) * (1 + 1e-12);
          expect(p.altitudeM).toBeGreaterThanOrEqual(lo);
          expect(p.altitudeM).toBeLessThanOrEqual(hi);
          // Later is never farther from the end than earlier.
          const towards = Math.sign(to - from);
          expect(towards * (q.altitudeM - p.altitudeM)).toBeGreaterThanOrEqual(
            -1e-12 * p.altitudeM,
          );
          expect(q.turnT).toBeGreaterThanOrEqual(p.turnT);
        },
      ),
    );
  });

  it("descends evenly in the logarithm: half way in time is the geometric mean", () => {
    const opts = {
      durationMs: 15_000,
      fromAltitudeM: 10_000_000,
      toAltitudeM: 150_000,
    };
    const mid = diveAt(7_500, opts);
    expect(mid.altitudeM).toBeCloseTo(Math.sqrt(10_000_000 * 150_000), 3);
  });

  it("finishes the turn by the turn share of the dive, and eases it", () => {
    const opts = {
      durationMs: 15_000,
      fromAltitudeM: 10_000_000,
      toAltitudeM: 150_000,
    };
    const turnEnd = GLOBE_DIVE.turnShare * 15_000;
    expect(diveAt(turnEnd, opts).turnT).toBe(1);
    expect(diveAt(turnEnd / 2, opts).turnT).toBeCloseTo(0.5, 12);
    // Eased: slow at the start.
    expect(diveAt(turnEnd * 0.1, opts).turnT).toBeLessThan(0.1);
  });

  it("has no jump: a millisecond moves the altitude by under half a percent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 14_999 }), (ms) => {
        const opts = {
          durationMs: 15_000,
          fromAltitudeM: 10_000_000,
          toAltitudeM: 20_000,
        };
        const a = diveAt(ms, opts).altitudeM;
        const b = diveAt(ms + 1, opts).altitudeM;
        expect(Math.abs(Math.log(b / a))).toBeLessThan(0.005);
      }),
    );
  });

  it("refuses a duration or altitude it cannot fly", () => {
    const ok = { durationMs: 15_000, fromAltitudeM: 1e7, toAltitudeM: 1.5e5 };
    expect(() => diveAt(0, ok)).not.toThrow();
    for (const bad of [
      { durationMs: 0 },
      { durationMs: Number.NaN },
      { fromAltitudeM: 0 },
      { toAltitudeM: -1 },
      { toAltitudeM: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => diveAt(0, { ...ok, ...bad })).toThrow(RangeError);
    }
  });
});

// WHY (milestone review of the pin, findings m2 and m3): the dive must
// start exactly where the camera is, whatever it looks at and wherever it
// is. Two ways it did not:
// - the start's height was taken above the TARGET's surface radius, so a
//   camera low over a pole diving to the equator (21 km of radius apart)
//   jumped at the start and skimmed the ground;
// - the camera's own rotation was blended in whole, so even an untilted
//   start was pulled back towards its old look direction mid-turn (up to
//   14 deg on a half turn): only the start's OFFSET from its own orbit view
//   may fade out.
describe("surfaceRadiusAlong", () => {
  it("meets the ellipsoid: the equatorial radius on the equator, the polar at a pole", () => {
    const { x: a, z: b } = WGS84_ELLIPSOID.radius;
    expect(
      surfaceRadiusAlong(WGS84_ELLIPSOID, new THREE.Vector3(1, 0, 0)),
    ).toBeCloseTo(a, 6);
    expect(
      surfaceRadiusAlong(WGS84_ELLIPSOID, new THREE.Vector3(0, 0, -3)),
    ).toBeCloseTo(b, 6);
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (x, y, z) => {
          const d = new THREE.Vector3(x, y, z);
          fc.pre(d.length() > 1e-3);
          const p = d
            .normalize()
            .multiplyScalar(surfaceRadiusAlong(WGS84_ELLIPSOID, d));
          expect(
            Math.abs(WGS84_ELLIPSOID.getPositionElevation(p)),
          ).toBeLessThan(1e-3);
        },
      ),
    );
  });
});

describe("planDive and diveStep", () => {
  const ell = WGS84_ELLIPSOID;
  const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => a.angleTo(b);
  /** A camera posed on its orbit, as the lab's intro leaves it. */
  const orbitCamera = (lat: number, lng: number, distanceM: number) => {
    const pose = orbitPose(ell, { lat, lng });
    return {
      pose,
      distanceM,
      quaternion: orbitQuaternion(pose, new THREE.Quaternion()),
    };
  };
  const equator = orbitPose(ell, { lat: 0, lng: 20 });

  it("starts exactly where a camera low over a pole is, and never skims the ground", () => {
    const start = orbitCamera(90, 0, ell.radius.z + 1000);
    const dive = planDive(ell, start, equator, {
      durationMs: 15_000,
      toAltitudeM: 150_000,
    });
    const first = diveStep(dive, 0);
    expect(
      first.position.distanceTo(
        start.pose.direction.clone().multiplyScalar(start.distanceM),
      ),
    ).toBeLessThan(1e-6);
    for (let i = 0; i <= 200; i++) {
      const step = diveStep(dive, (15_000 * i) / 200);
      const height =
        step.position.length() - surfaceRadiusAlong(ell, step.position);
      expect(height).toBeGreaterThanOrEqual(1000 * (1 - 1e-9));
      expect(ell.getPositionElevation(step.position)).toBeGreaterThan(900);
    }
    expect(diveStep(dive, 15_000).altitudeM).toBe(150_000);
  });

  // Why (round-5 plan §3.5, F1): the dive is now an OBLIQUE approach. Far
  // out it looks at the Earth's centre (continuous with the intro's end);
  // below 1,000 km the view looks down at the pitch law's 45 degrees
  // (pitchAtDeg), always at the ground point under the path, so the
  // target stays at the frame's centre while the ground ahead comes into
  // view.
  it("looks at the centre far out and at the target's ground at the pitch law's angle low down", () => {
    const start = orbitCamera(48, -120, 20_000_000);
    const dive = planDive(ell, start, equator, {
      durationMs: 15_000,
      toAltitudeM: 150_000,
    });
    // The least alignment with the centre among the steps above 5,000 km.
    let farAlignment = Infinity;
    let farSteps = 0;
    for (let i = 0; i <= 100; i++) {
      const step = diveStep(dive, (15_000 * i) / 100);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        step.quaternion,
      );
      const down = step.position.clone().negate().normalize();
      const depressionDeg =
        (Math.asin(Math.min(1, forward.dot(down))) * 180) / Math.PI;
      expect(depressionDeg).toBeCloseTo(pitchAtDeg(step.altitudeM), 4);
      if (step.altitudeM >= 5_000_000) {
        farAlignment = Math.min(farAlignment, forward.dot(down));
        farSteps++;
      }
    }
    expect(farSteps).toBeGreaterThan(10);
    expect(farAlignment).toBeGreaterThan(1 - 1e-12);
    // At the end the forward ray meets the target's ground point.
    const end = diveStep(dive, 15_000);
    const ground = equator.direction
      .clone()
      .multiplyScalar(surfaceRadiusAlong(ell, equator.direction));
    const toGround = ground.clone().sub(end.position).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(end.quaternion);
    expect(forward.dot(toGround)).toBeGreaterThan(1 - 1e-9);
  });

  it("starts at a tilted camera's own rotation and fades it out over the first fifth", () => {
    const start = orbitCamera(10, 30, 30_000_000);
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      0.6,
    );
    const tilted = {
      ...start,
      quaternion: start.quaternion.clone().multiply(tilt),
    };
    const dive = planDive(ell, tilted, equator, {
      durationMs: 15_000,
      toAltitudeM: 150_000,
    });
    expect(angle(diveStep(dive, 0).quaternion, tilted.quaternion)).toBeLessThan(
      1e-7,
    );
    // After the first fifth the tilt is gone: the same rotation as an
    // untilted start's dive.
    const plain = planDive(ell, start, equator, {
      durationMs: 15_000,
      toAltitudeM: 150_000,
    });
    for (const ms of [3_000, 8_000, 15_000]) {
      expect(
        angle(diveStep(dive, ms).quaternion, diveStep(plain, ms).quaternion),
      ).toBeLessThan(1e-7);
    }
  });
});
