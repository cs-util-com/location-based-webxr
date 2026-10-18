/**
 * Why these tests matter: G0 (2026-10-17, Q3) found three rules, not frame
 * time, keeping the globe's camera from eye height: the flight's 100 m
 * clearance, the controls' 10 m / 5 m limits, and a near plane of 0.3 x
 * the height that clips nearby items (at 40 m it is 12 m: items within
 * 12 m vanished in the spike's shot). These tests pin the first-person
 * mode's own rules: an eye-height clearance, controls allowed down to it
 * and restored afterwards, and a near plane that follows the nearest item
 * as well as the ground, never below its floor and never logarithmic.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { GLOBE_FLIGHT } from "./globe-flight.js";
import { clipPlanes } from "./globe-camera.js";
import {
  GLOBE_EYE,
  applyEyeControls,
  eyeClipPlanes,
  eyeNearM,
  nearestItemDistanceM,
} from "./globe-eye-camera.js";

describe("GLOBE_EYE", () => {
  it("has an eye-height clearance of its own, not the flight's 100 m", () => {
    expect(GLOBE_EYE.clearanceM).toBe(1.7);
    expect(GLOBE_FLIGHT.clearanceM).toBe(100);
  });

  // Why: G0 measured logarithmic depth losing decal pixels at 2 and 4 km;
  // standard and reversed drew them all.
  it("asks for reversed depth and never logarithmic", () => {
    expect(GLOBE_EYE.depth).toEqual({
      reversedDepthBuffer: true,
      logarithmicDepthBuffer: false,
    });
  });
});

describe("eyeNearM", () => {
  it("is 0.3 x the clearance with no item near", () => {
    expect(eyeNearM(40)).toBeCloseTo(12, 9);
    expect(eyeNearM(1.7)).toBeCloseTo(0.51, 9);
  });

  // Why (the spike's 40 m shot): an item 6 m away was clipped by a 12 m
  // near plane; with the item rule the near plane is 3 m.
  it("is half the distance to the nearest item when that is nearer", () => {
    expect(eyeNearM(40, 6)).toBe(3);
    expect(eyeNearM(1.7, 0.4)).toBeCloseTo(0.2, 9);
  });

  it("never drops below its floor", () => {
    expect(eyeNearM(0)).toBe(GLOBE_EYE.minNearM);
    expect(eyeNearM(1.7, 0)).toBe(GLOBE_EYE.minNearM);
    expect(GLOBE_EYE.minNearM).toBeGreaterThanOrEqual(0.05);
    expect(GLOBE_EYE.minNearM).toBeLessThanOrEqual(0.1);
  });

  it("refuses a negative or NaN distance", () => {
    expect(() => eyeNearM(-1)).toThrow(RangeError);
    expect(() => eyeNearM(Number.NaN)).toThrow(RangeError);
    expect(() => eyeNearM(1, -1)).toThrow(RangeError);
    expect(() => eyeNearM(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("eyeClipPlanes", () => {
  // Why: the far plane stays the globe's (past the horizon), only the near
  // plane changes: at eye height the globe's own rule floors it at 1 m.
  it("keeps the globe's far plane and sets its own near plane", () => {
    const at = WGS84_ELLIPSOID.getCartographicToPosition(
      (48.137 * Math.PI) / 180,
      (11.575 * Math.PI) / 180,
      517.7,
      new THREE.Vector3(),
    );
    const globe = clipPlanes(WGS84_ELLIPSOID, at, { clearanceM: 1.7 });
    const eye = eyeClipPlanes(WGS84_ELLIPSOID, at, {
      clearanceM: 1.7,
      nearestItemM: 0.6,
    });
    expect(globe.near).toBe(1);
    expect(eye.near).toBeCloseTo(0.3, 9);
    expect(eye.far).toBe(globe.far);
  });

  // Why: over the bare ellipsoid (no relief, or none loaded yet) there is
  // no clearance; the height above the ellipsoid stands in for it, as in
  // the globe's own rule, and caps a clearance larger than itself (the
  // globe's own surface is drawn too).
  it("uses the height above the ellipsoid without a clearance, and caps one by it", () => {
    const at = WGS84_ELLIPSOID.getCartographicToPosition(
      0.8,
      0.2,
      1.7,
      new THREE.Vector3(),
    );
    expect(eyeClipPlanes(WGS84_ELLIPSOID, at).near).toBeCloseTo(0.51, 6);
    expect(
      eyeClipPlanes(WGS84_ELLIPSOID, at, { clearanceM: 40 }).near,
    ).toBeCloseTo(0.51, 6);
  });
});

describe("nearestItemDistanceM", () => {
  it("is the distance to the nearest sphere's surface, 0 inside", () => {
    const p = new THREE.Vector3(0, 0, 0);
    const spheres = [
      new THREE.Sphere(new THREE.Vector3(10, 0, 0), 1),
      new THREE.Sphere(new THREE.Vector3(0, 5, 0), 2),
    ];
    expect(nearestItemDistanceM(p, spheres)).toBe(3);
    expect(
      nearestItemDistanceM(p, [
        new THREE.Sphere(new THREE.Vector3(1, 0, 0), 2),
      ]),
    ).toBe(0);
  });

  it("is Infinity without items and skips empty spheres", () => {
    const p = new THREE.Vector3();
    expect(nearestItemDistanceM(p, [])).toBe(Number.POSITIVE_INFINITY);
    expect(
      nearestItemDistanceM(p, [new THREE.Sphere(new THREE.Vector3(), 0)]),
    ).toBe(0);
    const empty = new THREE.Sphere().makeEmpty();
    expect(nearestItemDistanceM(p, [empty])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("applyEyeControls", () => {
  // Why: the library's controls stop at a 10 m distance and keep 5 m off
  // the ground; first person needs them at eye height, and leaving the
  // mode must give the flight its own limits back.
  it("lowers the controls' limits and restores them", () => {
    const controls = { cameraRadius: 5, minDistance: 10, other: 1 };
    const restore = applyEyeControls(controls);
    expect(controls).toEqual({ cameraRadius: 1.7, minDistance: 0.5, other: 1 });
    restore();
    expect(controls).toEqual({ cameraRadius: 5, minDistance: 10, other: 1 });
  });
});
