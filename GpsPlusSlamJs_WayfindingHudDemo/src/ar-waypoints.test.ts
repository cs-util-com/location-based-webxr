/**
 * Unit tests for the AR example-waypoint layout.
 *
 * Why these tests matter: the spawned examples are the AR mode's
 * self-demonstration — the layout CONTRACT is that every target starts
 * beyond the AR activation distance (so all three are immediately active:
 * ring ahead, arrows for the rest), exactly one sits behind the user (the
 * "turn around" arrow), and everything floats at eye height. If the layout
 * drifts inside the deadband, the demo boots into the very "nothing
 * happens" trap the spawn exists to prevent.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildExampleWaypoints } from "./ar-waypoints";
import { AR_HUD_CONFIG } from "./hud-config";

const IDENTITY = new THREE.Quaternion();

describe("buildExampleWaypoints", () => {
  it("places every example beyond the AR activation distance, at eye height", () => {
    const cameraPosition = new THREE.Vector3(0, 1.6, 0);
    const waypoints = buildExampleWaypoints(cameraPosition, IDENTITY);
    expect(waypoints.length).toBe(3);
    for (const waypoint of waypoints) {
      expect(cameraPosition.distanceTo(waypoint)).toBeGreaterThan(
        AR_HUD_CONFIG.distanceMax,
      );
      expect(waypoint.y).toBeCloseTo(cameraPosition.y, 10);
    }
  });

  it("puts exactly one target behind the camera and one ahead (identity pose looks toward -z)", () => {
    const waypoints = buildExampleWaypoints(new THREE.Vector3(), IDENTITY);
    const ahead = waypoints.filter((w) => w.z < 0);
    const behind = waypoints.filter((w) => w.z > 0);
    expect(ahead.length).toBe(1);
    expect(behind.length).toBe(1);
  });

  it("rotates the layout with the camera heading", () => {
    const yaw90 = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.PI / 2, 0), // looking toward -x
    );
    const [aheadTarget] = buildExampleWaypoints(new THREE.Vector3(), yaw90);
    expect(aheadTarget!.x).toBeLessThan(-4); // ahead is now -x
    expect(Math.abs(aheadTarget!.z)).toBeLessThan(1e-6);
  });

  it("survives a straight-down start pose without NaN (world-axis fallback)", () => {
    const straightDown = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    const waypoints = buildExampleWaypoints(
      new THREE.Vector3(0, 1.6, 0),
      straightDown,
    );
    for (const waypoint of waypoints) {
      expect(Number.isFinite(waypoint.x)).toBe(true);
      expect(Number.isFinite(waypoint.z)).toBe(true);
      expect(new THREE.Vector3(0, 1.6, 0).distanceTo(waypoint)).toBeGreaterThan(
        AR_HUD_CONFIG.distanceMax,
      );
    }
  });

  it("returns fresh vectors (the caller's position is not retained)", () => {
    const position = new THREE.Vector3(1, 1.6, 1);
    const waypoints = buildExampleWaypoints(position, IDENTITY);
    position.set(9, 9, 9);
    expect(waypoints[0]!.y).toBeCloseTo(1.6, 10);
  });
});
