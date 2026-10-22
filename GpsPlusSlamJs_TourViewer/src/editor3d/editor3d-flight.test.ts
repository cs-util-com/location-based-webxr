/**
 * Why these tests matter: a click on a station's card flies the 3D view's
 * camera there, Frame fits the tour, the compass turns north up and plus
 * and minus zoom - all as short flights between two orbit poses. A
 * flight must start exactly where the camera is and end exactly at its
 * goal (or the camera jumps), turn the short way round (from 170 to -170
 * degrees is 20 degrees, never 340), change the distance evenly on a log
 * scale (a flight from 1000 m to 10 m does not race through the first
 * half), and never end flatter than the editor's cap, so a flight never
 * leaves the creator looking along the ground.
 */
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { EDITOR_CAMERA } from "./editor3d-camera.js";
import {
  FLIGHT,
  flightGoal,
  frameDistanceM,
  orbitPoseBetween,
  orbitPoseOf,
  orbitPosition,
  tourFrame,
  type OrbitPose,
} from "./editor3d-flight.js";

const DEG = Math.PI / 180;

function pose(over: Partial<OrbitPose> = {}): OrbitPose {
  return {
    target: new THREE.Vector3(0, 500, 0),
    distanceM: 300,
    polarRad: 50 * DEG,
    azimuthRad: 0,
    ...over,
  };
}

describe("orbit poses", () => {
  it("reads a camera's pose around its target and puts it back", () => {
    const target = new THREE.Vector3(10, 500, -5);
    const camera = new THREE.Vector3(10 + 148, 500 + 210, -5 + 177);
    const read = orbitPoseOf(camera, target);
    expect(read.distanceM).toBeCloseTo(camera.distanceTo(target), 9);
    expect(read.polarRad).toBeCloseTo(Math.acos(210 / read.distanceM), 9);
    // x east, z south: a camera south-east of its target.
    expect(read.azimuthRad).toBeCloseTo(Math.atan2(148, 177), 9);
    const back = orbitPosition(read, new THREE.Vector3());
    expect(back.distanceTo(camera)).toBeLessThan(1e-9);
  });
});

describe("orbitPoseBetween", () => {
  it("starts where the camera is and ends at the goal", () => {
    const a = pose();
    const b = pose({
      target: new THREE.Vector3(50, 510, 20),
      distanceM: 20,
      polarRad: 30 * DEG,
      azimuthRad: 1,
    });
    const start = orbitPoseBetween(a, b, 0);
    const end = orbitPoseBetween(a, b, 1);
    expect(start.target.equals(a.target)).toBe(true);
    expect(start.distanceM).toBeCloseTo(a.distanceM, 9);
    expect(end.target.equals(b.target)).toBe(true);
    expect(end.distanceM).toBeCloseTo(b.distanceM, 9);
    expect(end.polarRad).toBeCloseTo(b.polarRad, 9);
    expect(end.azimuthRad).toBeCloseTo(b.azimuthRad, 9);
  });

  it("turns the short way round", () => {
    const a = pose({ azimuthRad: 170 * DEG });
    const b = pose({ azimuthRad: -170 * DEG });
    const half = orbitPoseBetween(a, b, 0.5);
    expect(
      Math.abs(Math.cos(half.azimuthRad) - Math.cos(Math.PI)),
    ).toBeLessThan(1e-9);
  });

  it("changes the distance on a log scale", () => {
    const half = orbitPoseBetween(
      pose({ distanceM: 1000 }),
      pose({ distanceM: 10 }),
      0.5,
    );
    expect(half.distanceM).toBeCloseTo(100, 6);
  });

  // Why: for any two poses and any point of the flight, the distance and
  // the tilt stay between the ends, the turn never takes the long way, and
  // nothing is NaN, so a flight cannot overshoot into the ground or spin.
  it("stays between its ends at every point of the flight", () => {
    const anyPose = fc.record({
      x: fc.double({ min: -500, max: 500, noNaN: true }),
      distanceM: fc.double({ min: 2.5, max: 1100, noNaN: true }),
      polarRad: fc.double({ min: 0.0006, max: 1.48, noNaN: true }),
      azimuthRad: fc.double({ min: -10, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(
        anyPose,
        anyPose,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p, q, k) => {
          const a = pose({ ...p, target: new THREE.Vector3(p.x, 500, 0) });
          const b = pose({ ...q, target: new THREE.Vector3(q.x, 500, 0) });
          const at = orbitPoseBetween(a, b, k);
          const lo = (u: number, v: number) => Math.min(u, v) - 1e-9;
          const hi = (u: number, v: number) => Math.max(u, v) + 1e-9;
          expect(at.distanceM).toBeGreaterThanOrEqual(
            lo(a.distanceM, b.distanceM),
          );
          expect(at.distanceM).toBeLessThanOrEqual(
            hi(a.distanceM, b.distanceM),
          );
          expect(at.polarRad).toBeGreaterThanOrEqual(
            lo(a.polarRad, b.polarRad),
          );
          expect(at.polarRad).toBeLessThanOrEqual(hi(a.polarRad, b.polarRad));
          // The turn so far is never more than half a circle.
          const turned = Math.abs(
            Math.atan2(
              Math.sin(at.azimuthRad - a.azimuthRad),
              Math.cos(at.azimuthRad - a.azimuthRad),
            ),
          );
          expect(turned).toBeLessThanOrEqual(Math.PI + 1e-9);
          expect(Number.isFinite(at.target.x)).toBe(true);
        },
      ),
    );
  });
});

describe("flightGoal", () => {
  it("frames a station by its radius, keeping the turn and capping the tilt", () => {
    const now = pose({ polarRad: 80 * DEG, azimuthRad: 0.7 });
    const at = new THREE.Vector3(40, 505, -30);
    const goal = flightGoal(now, { at, radiusM: 25, kind: "station" });
    expect(goal.target.equals(at)).toBe(true);
    expect(goal.distanceM).toBeCloseTo(frameDistanceM(25 * 1.05), 9);
    expect(goal.azimuthRad).toBe(0.7);
    expect(goal.polarRad).toBeCloseTo(FLIGHT.flatCapRad, 9);
    // A steeper view is kept as it is.
    const steep = flightGoal(pose({ polarRad: 30 * DEG }), {
      at,
      radiusM: 25,
      kind: "station",
    });
    expect(steep.polarRad).toBeCloseTo(30 * DEG, 9);
  });

  it("brings an item to a working distance, never farther than 60 m", () => {
    const at = new THREE.Vector3(0, 500, 0);
    const far = flightGoal(pose({ distanceM: 300 }), {
      at,
      radiusM: 1.6,
      kind: "item",
    });
    expect(far.distanceM).toBe(FLIGHT.itemMaxM);
    const near = flightGoal(pose({ distanceM: 3 }), {
      at,
      radiusM: 1.6,
      kind: "item",
    });
    expect(near.distanceM).toBeCloseTo(frameDistanceM(1.6) * 3, 9);
    const mid = flightGoal(pose({ distanceM: 30 }), {
      at,
      radiusM: 1.6,
      kind: "item",
    });
    expect(mid.distanceM).toBe(30);
  });

  it("stays inside the orbit's limits", () => {
    const at = new THREE.Vector3(0, 500, 0);
    const huge = flightGoal(pose(), { at, radiusM: 5000, kind: "station" });
    expect(huge.distanceM).toBe(EDITOR_CAMERA.maxDistanceM);
    expect(frameDistanceM(0)).toBe(FLIGHT.minFrameM);
    expect(() =>
      flightGoal(pose(), { at, radiusM: Number.NaN, kind: "station" }),
    ).toThrow(RangeError);
  });
});

describe("tourFrame", () => {
  // Why: Frame with nothing selected (and Home) fits the whole tour: a
  // sphere around every station's circle and every code, so the frame
  // shows each of them, centred on the tour rather than on its first
  // station.
  it("holds every station's circle and every code", () => {
    const frame = tourFrame([
      { at: new THREE.Vector3(0, 500, 0), radiusM: 10 },
      { at: new THREE.Vector3(100, 504, 0), radiusM: 25 },
      { at: new THREE.Vector3(50, 502, 80), radiusM: 0 },
    ])!;
    expect(frame.centre.x).toBeCloseTo(50, 9);
    expect(frame.centre.z).toBeCloseTo(40, 9);
    for (const [x, z, r] of [
      [0, 0, 10],
      [100, 0, 25],
      [50, 80, 0],
    ] as const) {
      expect(Math.hypot(x - 50, z - 40) + r).toBeLessThanOrEqual(
        frame.radiusM + 1e-9,
      );
    }
    expect(tourFrame([])).toBeNull();
  });
});
