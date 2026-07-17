/**
 * Example-waypoint layout for the AR mode — pure math, no WebXR.
 *
 * Spawned on the first XR frame around the user's start pose so the HUD
 * demonstrates itself immediately (2026-07-17 AR-onboarding revision of the
 * demo plan): without them, a freshly tap-placed waypoint 1–3 m away shows
 * NO indicator at all (on-screen targets inside the activation distance
 * start `hidden` by design) — a first-time tester read that as broken.
 *
 * All three targets sit beyond the AR activation distance (distanceMax
 * 3 m): straight ahead (immediate on-screen ring + distance label), to the
 * right (edge arrow), and behind (the flipped "turn around" arrow).
 */

import * as THREE from "three";

/** Distances (m) of the spawned example targets — all > AR distanceMax. */
const EXAMPLE_AHEAD_M = 5;
const EXAMPLE_RIGHT_M = 4;
const EXAMPLE_BEHIND_M = 4.5;

/**
 * Project a camera axis onto the ground plane; falls back to the given world
 * axis when the projection is degenerate (device pointing straight down at
 * session start — rare but must not yield NaN positions).
 */
function groundDirection(
  axis: THREE.Vector3,
  cameraQuaternion: THREE.Quaternion,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  const direction = axis.clone().applyQuaternion(cameraQuaternion);
  direction.y = 0;
  if (direction.lengthSq() < 1e-10) {
    return fallback.clone();
  }
  return direction.normalize();
}

/**
 * World positions of the three example waypoints for a session-start camera
 * pose. All at the camera's eye height (ground-plane directions), so they
 * float where indicators are easy to relate to.
 */
export function buildExampleWaypoints(
  cameraPosition: THREE.Vector3,
  cameraQuaternion: THREE.Quaternion,
): THREE.Vector3[] {
  const forward = groundDirection(
    new THREE.Vector3(0, 0, -1),
    cameraQuaternion,
    new THREE.Vector3(0, 0, -1),
  );
  const right = groundDirection(
    new THREE.Vector3(1, 0, 0),
    cameraQuaternion,
    new THREE.Vector3(1, 0, 0),
  );

  return [
    cameraPosition.clone().addScaledVector(forward, EXAMPLE_AHEAD_M),
    cameraPosition.clone().addScaledVector(right, EXAMPLE_RIGHT_M),
    cameraPosition.clone().addScaledVector(forward, -EXAMPLE_BEHIND_M),
  ];
}
