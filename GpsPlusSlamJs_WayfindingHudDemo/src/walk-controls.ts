/**
 * Keyboard walk controls for the desktop simulator — pure key-state tracking
 * and ground-plane movement math (no DOM, no three.js scene).
 *
 * Ported from the frozen Prototype-1 walk loop with one deliberate fix: the
 * step is dt-scaled (meters per second) instead of the prototype's fixed
 * 0.1 m per frame, so walking speed is frame-rate independent.
 */

import * as THREE from "three";

export type MoveDirection = "forward" | "back" | "left" | "right";

const KEY_TO_DIRECTION: Readonly<Record<string, MoveDirection>> = {
  w: "forward",
  W: "forward",
  ArrowUp: "forward",
  s: "back",
  S: "back",
  ArrowDown: "back",
  a: "left",
  A: "left",
  ArrowLeft: "left",
  d: "right",
  D: "right",
  ArrowRight: "right",
};

/** Map a KeyboardEvent.key to a move direction, or null for unrelated keys. */
export function directionForKey(key: string): MoveDirection | null {
  return KEY_TO_DIRECTION[key] ?? null;
}

export interface KeyState {
  /** The directions currently held. */
  readonly active: ReadonlySet<MoveDirection>;
  keyDown(key: string): void;
  keyUp(key: string): void;
  /** Release everything (e.g. on blur, so keys never stick). */
  clear(): void;
}

/** Track which move directions are held, keyed by KeyboardEvent.key. */
export function createKeyState(): KeyState {
  const active = new Set<MoveDirection>();
  return {
    active,
    keyDown(key: string): void {
      const direction = directionForKey(key);
      if (direction) active.add(direction);
    },
    keyUp(key: string): void {
      const direction = directionForKey(key);
      if (direction) active.delete(direction);
    },
    clear(): void {
      active.clear();
    },
  };
}

/** Default walking speed, meters per second. */
export const WALK_SPEED_MPS = 4;

/**
 * Project a camera axis onto the ground plane. Looking straight up/down
 * collapses one projection — that axis contributes nothing while the other
 * keeps working (e.g. strafing while looking at the floor).
 */
function groundProjection(axis: THREE.Vector3): THREE.Vector3 {
  axis.y = 0;
  if (axis.lengthSq() > 1e-10) return axis.normalize();
  return axis.set(0, 0, 0);
}

/**
 * Compute the ground-plane displacement for one frame.
 *
 * Forward/right derive from the camera orientation with the vertical
 * component removed (you walk on the floor even while looking up/down); the
 * combined direction is normalized so diagonals are not faster. Returns a
 * zero vector when no direction is held or the camera looks straight
 * up/down (degenerate ground projection).
 */
export function computeMoveStep(
  active: ReadonlySet<MoveDirection>,
  cameraQuaternion: THREE.Quaternion,
  dt: number,
  speedMps: number = WALK_SPEED_MPS,
): THREE.Vector3 {
  const step = new THREE.Vector3();
  if (active.size === 0 || !Number.isFinite(dt) || dt <= 0) {
    return step;
  }

  const forward = groundProjection(
    new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion),
  );
  const right = groundProjection(
    new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion),
  );

  if (active.has("forward")) step.add(forward);
  if (active.has("back")) step.addScaledVector(forward, -1);
  if (active.has("right")) step.add(right);
  if (active.has("left")) step.addScaledVector(right, -1);

  if (step.lengthSq() === 0) {
    return step; // opposing keys cancel
  }
  return step.normalize().multiplyScalar(speedMps * dt);
}
