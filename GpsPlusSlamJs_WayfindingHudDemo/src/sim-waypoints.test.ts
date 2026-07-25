/**
 * Unit tests for the simulator waypoints + marker factory.
 *
 * Why these tests matter: the e2e walk-flow spec depends on the waypoint
 * GEOMETRY contract — exactly one target starts inside the camera's forward
 * view beyond the simulator deadband (ring), the others start off-screen
 * (arrows). If the layout drifts, the e2e assertions on the status line stop
 * meaning what they claim.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  SIM_EYE_HEIGHT,
  SIM_WAYPOINTS,
  createWaypointMarker,
} from "./sim-waypoints";
import { SIM_HUD_CONFIG } from "./hud-config";

const CAMERA_START = new THREE.Vector3(0, SIM_EYE_HEIGHT, 5);

describe("SIM_WAYPOINTS", () => {
  it("places every waypoint beyond the simulator activation distance", () => {
    for (const waypoint of SIM_WAYPOINTS) {
      expect(CAMERA_START.distanceTo(waypoint.position)).toBeGreaterThanOrEqual(
        SIM_HUD_CONFIG.distanceMax,
      );
    }
  });

  it("has exactly one waypoint straight ahead of the start pose (the ring target)", () => {
    // Camera starts looking toward −z; "ahead" = negative z relative to start
    // and laterally centered.
    const ahead = SIM_WAYPOINTS.filter(
      (w) => w.position.z < CAMERA_START.z && Math.abs(w.position.x) < 1,
    );
    expect(ahead.length).toBe(1);
    expect(ahead[0]!.position.y).toBe(SIM_EYE_HEIGHT); // at eye height, not floating
  });

  it("includes a behind-the-start target and an elevated target (arrow variety)", () => {
    expect(SIM_WAYPOINTS.some((w) => w.position.z > CAMERA_START.z)).toBe(true);
    expect(SIM_WAYPOINTS.some((w) => w.position.y > SIM_EYE_HEIGHT + 1)).toBe(
      true,
    );
  });

  // Why this test matters: the HUD keys per-target hysteresis state by id
  // (2026-07-20 per-target config plan); duplicate ids would silently drop
  // waypoints from the HUD (only the first occurrence is shown).
  it("gives every waypoint a unique stable id", () => {
    const ids = SIM_WAYPOINTS.map((w) => w.id);
    expect(new Set(ids).size).toBe(SIM_WAYPOINTS.length);
  });
});

describe("createWaypointMarker", () => {
  it("returns a named wireframe sphere at the requested position", () => {
    const position = new THREE.Vector3(1, 2, 3);
    const marker = createWaypointMarker(position);
    expect(marker.name).toBe("waypoint-marker");
    expect(marker.position).toEqual(position);
    expect((marker.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
  });

  it("does not retain the caller's vector instance (no aliasing)", () => {
    const position = new THREE.Vector3(1, 2, 3);
    const marker = createWaypointMarker(position);
    position.set(9, 9, 9);
    expect(marker.position.x).toBe(1);
  });
});
