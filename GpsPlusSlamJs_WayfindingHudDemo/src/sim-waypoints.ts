/**
 * Synthetic waypoints for the desktop walk simulator, plus the shared
 * wireframe-sphere marker factory (also used for AR tap-to-place markers).
 *
 * Layout follows the frozen Prototype-1 precedent (one straight ahead, one
 * off to the side, one behind, one elevated) scaled so the ahead target can
 * be reached in a few seconds of WASD walking: with the simulator deadband
 * (SIM_HUD_CONFIG 8/12 m) it starts as a ring and hides ("arrived") after
 * ~2 s of walking forward — the loop the e2e walk-flow spec drives.
 */

import * as THREE from "three";

/** Eye height of the simulator camera, in meters. */
export const SIM_EYE_HEIGHT = 1.6;

/** One simulator waypoint: a stable id (the HUD keys per-target hysteresis
 * state by it, 2026-07-20 per-target config plan) plus its world position. */
export interface SimWaypoint {
  id: string;
  position: THREE.Vector3;
}

/**
 * Simulator waypoints (world space, meters; camera starts at
 * (0, SIM_EYE_HEIGHT, 5) looking toward −z).
 */
export const SIM_WAYPOINTS: readonly SimWaypoint[] = [
  // straight ahead — starts as a ring
  { id: "ahead", position: new THREE.Vector3(0, SIM_EYE_HEIGHT, -14) },
  // off to the right — edge arrow
  { id: "right", position: new THREE.Vector3(15, SIM_EYE_HEIGHT, 0) },
  // behind-left — flipped arrow
  { id: "behind-left", position: new THREE.Vector3(-12, SIM_EYE_HEIGHT, 12) },
  // elevated, behind — arrow with pitch
  { id: "elevated", position: new THREE.Vector3(0, 8, 20) },
];

const WAYPOINT_COLOR = 0x4caf50;

/**
 * Create a wireframe waypoint marker sphere at the given position.
 * The caller owns scene-graph insertion and disposal.
 */
export function createWaypointMarker(position: THREE.Vector3): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: WAYPOINT_COLOR, wireframe: true }),
  );
  marker.name = "waypoint-marker";
  marker.position.copy(position);
  return marker;
}
