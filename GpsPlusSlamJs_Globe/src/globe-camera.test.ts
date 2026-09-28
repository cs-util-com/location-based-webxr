/**
 * Why this test matters: the intro ends with the target in the middle of
 * the screen, north up, and a wrong frame is easy to miss by eye - a
 * mirrored globe still has north up, and a geodetic instead of a geocentric
 * ray is off by only up to 0.19 degrees. So the checks go through three's
 * own camera and projection, for any target (poles, the antimeridian, the
 * south), any aspect and any field of view the lab allows; and the turn is
 * checked for what a viewer would see as a glitch: a jump at either end, a
 * camera that drifts away from the target, a roll that flips at a pole.
 */

import fc from "fast-check";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  GLOBE_CLIP,
  applyOrbitPose,
  clipPlanes,
  orbitDistanceToFit,
  orbitPose,
  smoothstep,
  turnPose,
  type OrbitPose,
} from "./globe-camera.js";

const DEG = Math.PI / 180;
const R = WGS84_ELLIPSOID.radius.x;

const surfacePoint = (lat: number, lng: number): THREE.Vector3 =>
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat * DEG,
    lng * DEG,
    0,
    new THREE.Vector3(),
  );

/** A camera posed at `pose`, fitted to the frame, matrices up to date. */
function posedCamera(
  pose: OrbitPose,
  fovYDeg: number,
  aspect: number,
  margin = 0.1,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fovYDeg, aspect, R * 0.01, R * 20);
  const distance = orbitDistanceToFit({
    fovYRad: fovYDeg * DEG,
    aspect,
    margin,
    radius: R,
  });
  applyOrbitPose(camera, pose, distance);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

const lat = fc.double({ min: -90, max: 90, noNaN: true });
const lng = fc.double({ min: -180, max: 180, noNaN: true });
const fovY = fc.double({ min: 20, max: 70, noNaN: true });
const aspect = fc.double({ min: 0.4, max: 2.5, noNaN: true });
const unitPose = fc
  .record({ lat, lng })
  .map((t) => orbitPose(WGS84_ELLIPSOID, t));

function expectOrthonormal(pose: OrbitPose): void {
  expect(pose.direction.length()).toBeCloseTo(1, 12);
  expect(pose.up.length()).toBeCloseTo(1, 12);
  expect(Math.abs(pose.direction.dot(pose.up))).toBeLessThan(1e-12);
}

describe("orbitPose", () => {
  it("puts any target at the exact centre of the frame", () => {
    fc.assert(
      fc.property(lat, lng, fovY, aspect, (la, ln, f, a) => {
        const camera = posedCamera(
          orbitPose(WGS84_ELLIPSOID, { lat: la, lng: ln }),
          f,
          a,
        );
        const ndc = surfacePoint(la, ln).project(camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1e-9);
        expect(Math.abs(ndc.y)).toBeLessThan(1e-9);
        expect(ndc.z).toBeGreaterThan(-1);
        expect(ndc.z).toBeLessThan(1);
      }),
    );
  });

  it("shows north up and east to the right (not mirrored), south pole included", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 89.8, noNaN: true }),
        lng,
        fovY,
        aspect,
        (la, ln, f, a) => {
          const camera = posedCamera(
            orbitPose(WGS84_ELLIPSOID, { lat: la, lng: ln }),
            f,
            a,
          );
          const north = surfacePoint(la + 0.1, ln).project(camera);
          expect(north.y).toBeGreaterThan(0);
        },
      ),
    );
    // Away from the poles, where "east" and "straight up" are defined.
    fc.assert(
      fc.property(
        fc.double({ min: -89.5, max: 89.5, noNaN: true }),
        lng,
        fovY,
        aspect,
        (la, ln, f, a) => {
          const camera = posedCamera(
            orbitPose(WGS84_ELLIPSOID, { lat: la, lng: ln }),
            f,
            a,
          );
          const north = surfacePoint(la + 0.1, ln).project(camera);
          const east = surfacePoint(la, ln + 0.1).project(camera);
          expect(east.x).toBeGreaterThan(0);
          // The meridian through the target is exactly vertical: any roll
          // at all moves the point north of it sideways.
          expect(Math.abs(north.x)).toBeLessThan(1e-7 * Math.abs(north.y));
        },
      ),
    );
  });

  it("is orthonormal everywhere, the poles included", () => {
    fc.assert(fc.property(unitPose, expectOrthonormal));
    for (const la of [90, -90]) {
      for (const ln of [-180, 0, 37, 180]) {
        expectOrthonormal(orbitPose(WGS84_ELLIPSOID, { lat: la, lng: ln }));
      }
    }
  });
});

describe("orbitDistanceToFit", () => {
  /** The largest |NDC| of the sphere's silhouette, per axis. */
  function silhouetteExtent(
    camera: THREE.PerspectiveCamera,
    d: number,
  ): { x: number; y: number } {
    const axis = camera.position.clone().normalize();
    const u = new THREE.Vector3().crossVectors(axis, camera.up).normalize();
    const v = new THREE.Vector3().crossVectors(u, axis);
    const centre = axis.clone().multiplyScalar((R * R) / d);
    const rho = R * Math.sqrt(1 - (R * R) / (d * d));
    let x = 0;
    let y = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * 2 * Math.PI;
      const p = centre
        .clone()
        .addScaledVector(u, rho * Math.cos(a))
        .addScaledVector(v, rho * Math.sin(a))
        .project(camera);
      x = Math.max(x, Math.abs(p.x));
      y = Math.max(y, Math.abs(p.y));
    }
    return { x, y };
  }

  it("fits the whole disc inside the narrower side, touching (1 - margin) of it", () => {
    fc.assert(
      fc.property(
        fovY,
        aspect,
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        (f, a, margin) => {
          const pose = orbitPose(WGS84_ELLIPSOID, { lat: 12, lng: 34 });
          const camera = posedCamera(pose, f, a, margin);
          const d = camera.position.length();
          const { x, y } = silhouetteExtent(camera, d);
          expect(x).toBeLessThanOrEqual(1 - margin + 1e-9);
          expect(y).toBeLessThanOrEqual(1 - margin + 1e-9);
          expect(Math.max(x, y)).toBeGreaterThan(1 - margin - 1e-4);
        },
      ),
    );
  });

  it("refuses a field of view, aspect, margin or radius it cannot fit", () => {
    const ok = { fovYRad: 50 * DEG, aspect: 1, margin: 0.1, radius: R };
    expect(orbitDistanceToFit(ok)).toBeGreaterThan(R);
    for (const bad of [
      { fovYRad: 0 },
      { fovYRad: Math.PI },
      { fovYRad: Number.NaN },
      { aspect: 0 },
      { aspect: Number.POSITIVE_INFINITY },
      { margin: -0.1 },
      { margin: 1 },
      { radius: 0 },
    ]) {
      expect(() => orbitDistanceToFit({ ...ok, ...bad })).toThrow(RangeError);
    }
  });
});

describe("turnPose", () => {
  const angle = (a: THREE.Vector3, b: THREE.Vector3): number =>
    Math.atan2(a.clone().cross(b).length(), a.dot(b));

  it("starts and ends exactly on its poses", () => {
    fc.assert(
      fc.property(unitPose, unitPose, (from, to) => {
        const start = turnPose(from, to, 0);
        const end = turnPose(from, to, 1);
        expect(start.direction.equals(from.direction)).toBe(true);
        expect(start.up.equals(from.up)).toBe(true);
        expect(end.direction.equals(to.direction)).toBe(true);
        expect(end.up.equals(to.up)).toBe(true);
        // Outside [0, 1] it holds the ends, never extrapolates.
        expect(turnPose(from, to, -1).direction.equals(from.direction)).toBe(
          true,
        );
        expect(turnPose(from, to, 2).up.equals(to.up)).toBe(true);
      }),
    );
  });

  it("stays orthonormal, closes in on the target monotonically, along the shorter arc", () => {
    fc.assert(
      fc.property(unitPose, unitPose, (from, to) => {
        const total = angle(from.direction, to.direction);
        let last = Number.POSITIVE_INFINITY;
        for (let i = 0; i <= 20; i++) {
          const pose = turnPose(from, to, i / 20);
          expectOrthonormal(pose);
          const left = angle(pose.direction, to.direction);
          expect(left).toBeLessThanOrEqual(last + 1e-12);
          last = left;
        }
        // Half way is half the angle: a great circle, the shorter way.
        const mid = turnPose(from, to, 0.5).direction;
        expect(angle(from.direction, mid)).toBeCloseTo(total / 2, 9);
      }),
    );
  });

  // Only EXACT antipodes (cross product below 1e-9) take this branch; a
  // near-antipode follows the one great circle through both points, which
  // its tiny offset decides.
  it("turns between exact antipodes deterministically, via the start's up (north)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        lng,
        (la, ln) => {
          const from = orbitPose(WGS84_ELLIPSOID, { lat: la, lng: ln });
          const to: OrbitPose = {
            direction: from.direction.clone().negate(),
            up: from.up.clone(),
          };
          const mid = turnPose(from, to, 0.5);
          const again = turnPose(from, to, 0.5);
          expect(mid.direction.equals(again.direction)).toBe(true);
          expect(mid.direction.distanceTo(from.up)).toBeLessThan(1e-9);
        },
      ),
    );
  });

  // The exact ends are returned early, so they prove nothing about the
  // poses next to them: a wrong roll sign leaves the up 130 degrees off at
  // t = 0.999 and then jumps. Continuity up to and including the ends is
  // what catches it. The bounds are per unit of t (the direction turns at
  // most pi, the up at most pi plus a roll of at most pi), so they hold for
  // any step count.
  it("is continuous up to and including both ends, for any step", () => {
    const eps = 1e-6;
    const ts = [0, eps, 0.25, 0.5, 0.75, 1 - eps, 1];
    fc.assert(
      fc.property(unitPose, unitPose, (from, to) => {
        for (let i = 1; i < ts.length; i++) {
          const [t0, t1] = [ts[i - 1] as number, ts[i] as number];
          const a = turnPose(from, to, t0);
          const b = turnPose(from, to, t1);
          expect(angle(a.direction, b.direction)).toBeLessThanOrEqual(
            Math.PI * (t1 - t0) + 1e-9,
          );
          expect(angle(a.up, b.up)).toBeLessThanOrEqual(
            2 * Math.PI * (t1 - t0) + 1e-9,
          );
        }
      }),
    );
  });

  it("spreads the half-turn roll over a turn across a pole, no snap", () => {
    // From (60, 10) to (60, -170): the shorter arc crosses the north pole,
    // where a plain north-up camera would spin half a turn at once. Here the
    // up turns about three times faster than the view moves (the owner
    // judges on the phone whether that reads well), but never in one step.
    const from = orbitPose(WGS84_ELLIPSOID, { lat: 60, lng: 10 });
    const to = orbitPose(WGS84_ELLIPSOID, { lat: 60, lng: -170 });
    const total = angle(from.direction, to.direction);
    for (const steps of [20, 50, 200]) {
      let prev = turnPose(from, to, 0);
      for (let i = 1; i <= steps; i++) {
        const pose = turnPose(from, to, i / steps);
        expect(angle(prev.up, pose.up)).toBeLessThanOrEqual(
          (total + Math.PI) / steps + 1e-9,
        );
        prev = pose;
      }
    }
  });
});

describe("smoothstep", () => {
  it("eases from 0 to 1, monotonic, symmetric, clamped outside [0, 1]", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(-3)).toBe(0);
    expect(smoothstep(7)).toBe(1);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(smoothstep(lo)).toBeLessThanOrEqual(smoothstep(hi));
          expect(smoothstep(a) + smoothstep(1 - a)).toBeCloseTo(1, 12);
        },
      ),
    );
  });
});

// WHY (round-2 plan 2026-09-26-2055 M3b): the intro's planes follow the
// altitude. The geometry is covered by globe-camera.property.test.ts; these
// pin the scale (a dive's near plane shrinks with it, the fitted view's far
// plane stops short of the Earth's centre, so the far side is culled) and
// the refusals.
describe("clipPlanes", () => {
  it("scales the near plane with the height, down to its floor", () => {
    const over = (h: number) =>
      clipPlanes(
        WGS84_ELLIPSOID,
        WGS84_ELLIPSOID.getCartographicToPosition(
          0.3,
          0.2,
          h,
          new THREE.Vector3(),
        ),
      );
    expect(over(150_000).near).toBeCloseTo(
      150_000 * GLOBE_CLIP.nearFraction,
      3,
    );
    expect(over(20_000).near).toBeCloseTo(20_000 * GLOBE_CLIP.nearFraction, 3);
    expect(over(0).near).toBe(GLOBE_CLIP.minNearM);
  });

  it("puts the far plane short of the centre from the fitted view, and near the horizon low down", () => {
    const fitted = orbitDistanceToFit({
      fovYRad: 50 * DEG,
      aspect: 1.6,
      margin: 0.1,
      radius: R,
    });
    const { far } = clipPlanes(
      WGS84_ELLIPSOID,
      new THREE.Vector3(fitted, 0, 0),
    );
    // The Earth's far half lies beyond the centre, so it is culled.
    expect(far).toBeLessThan(fitted);
    // At 150 km a sphere of the equatorial radius has its horizon about
    // 1,390 km away; the polar radius and the radii's difference (the
    // ellipsoid's limb) add about 120 km.
    const low = clipPlanes(
      WGS84_ELLIPSOID,
      new THREE.Vector3(R + 150_000, 0, 0),
    );
    expect(low.far).toBeGreaterThan(1_380_000);
    expect(low.far).toBeLessThan(1_550_000);
  });

  it("refuses a camera at the centre or off the numbers", () => {
    expect(() => clipPlanes(WGS84_ELLIPSOID, new THREE.Vector3())).toThrow(
      RangeError,
    );
    expect(() =>
      clipPlanes(WGS84_ELLIPSOID, new THREE.Vector3(Number.NaN, 0, 0)),
    ).toThrow(RangeError);
  });
});
