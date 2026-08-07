/**
 * Camera Follower Module
 *
 * Creates an Object3D that tracks the camera's world position
 * every frame via lerp, while keeping its own rotation at identity
 * (GPS-world-aligned).
 *
 * The follower is placed at the scene root (outside arWorldGroup)
 * so its world rotation stays identity regardless of the alignment
 * matrix applied to arWorldGroup. This ensures compass cubes and
 * the map mesh point to true N/E/S/W in the NUE GPS frame.
 *
 * Children of the follower (map mesh, compass cubes) stay
 * flat / world-oriented regardless of camera rotation or
 * orbit / FPS controls.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-12-user-feedback.md Issue 8
 */

import * as THREE from 'three';
import { DEFAULT_LERP_RATE, clampedAlpha } from './lerp-utils';
import { SCENE_NODE } from '../ar/scene-node-names';

// Reusable scratch vector to avoid per-frame allocations
const _worldPos = new THREE.Vector3();

export interface CameraFollower {
  /** The underlying Object3D — add children (map, cubes) here. */
  readonly object3D: THREE.Object3D;

  /**
   * Update the follower position. Call once per frame before render.
   *
   * @param camera The active camera (its world position is read).
   * @param dt     Delta time in seconds since last frame.
   */
  update(camera: THREE.Camera, dt: number): void;

  /** Remove the follower from the scene graph. */
  dispose(): void;
}

/**
 * Create a CameraFollower and attach it as a child of the given parent.
 *
 * The parent should be the scene root (not arWorldGroup) so that the
 * follower's world rotation stays identity — ensuring compass directions
 * align with the NUE GPS frame regardless of alignment matrix changes.
 *
 * @param parent   Parent node — should be the scene root.
 * @param lerpRate Lerp speed multiplier (default 8).
 */
export function createCameraFollower(
  parent: THREE.Object3D,
  lerpRate = DEFAULT_LERP_RATE
): CameraFollower {
  const node = new THREE.Object3D();
  node.name = SCENE_NODE.CAMERA_FOLLOWER;
  parent.add(node);

  return {
    object3D: node,

    update(camera: THREE.Camera, dt: number): void {
      // Get camera's world position (already in scene/NUE space)
      camera.getWorldPosition(_worldPos);
      // Lerp toward target, clamping factor to [0, 1] to prevent overshoot
      const alpha = clampedAlpha(lerpRate, dt);
      node.position.lerp(_worldPos, alpha);
      // Rotation stays at identity — never modified
    },

    dispose(): void {
      if (node.parent) {
        node.parent.remove(node);
      }
    },
  };
}
