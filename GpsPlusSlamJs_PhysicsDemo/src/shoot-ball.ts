/**
 * Shoot a ball from the camera — the shared spawn action for both modes.
 *
 * User feedback: a ball should not appear at the clicked surface; it should leave
 * the camera and fly toward where the user aimed, so it hits the reconstructed
 * mesh with enough momentum to bounce and roll. Desktop passes the camera→pointer
 * ray direction; AR passes the camera's forward direction (tap = shoot ahead).
 */

import type * as THREE from "three";
import type { PhysicsRuntime } from "./physics-runtime";

/** Speed (m/s) a ball leaves the camera — enough momentum to bounce + roll. */
export const SHOOT_SPEED = 6;

/** Spawn this far in front of the camera so the ball is not born in the near plane. */
const SPAWN_OFFSET_M = 0.3;

/**
 * Spawn a ball just in front of `cameraWorldPos` travelling along `direction`
 * (world) at {@link SHOOT_SPEED}. `direction` need not be normalized.
 */
export function shootBallFromCamera(
  runtime: PhysicsRuntime,
  cameraWorldPos: THREE.Vector3,
  direction: THREE.Vector3,
): void {
  const dir = direction.clone().normalize();
  const origin = cameraWorldPos.clone().addScaledVector(dir, SPAWN_OFFSET_M);
  runtime.spawnBallWithVelocity(origin, dir.multiplyScalar(SHOOT_SPEED));
}
