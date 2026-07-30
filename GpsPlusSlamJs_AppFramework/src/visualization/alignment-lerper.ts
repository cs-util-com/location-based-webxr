/**
 * Alignment Lerper Module
 *
 * Smoothly interpolates arWorldGroup.matrix toward a target alignment
 * matrix each frame, eliminating visual jumps when the alignment solver
 * produces a new alignment (~1 Hz).
 *
 * Pattern: decompose → lerp position / slerp quaternion → compose.
 * Same lerpRate convention as camera-follower.ts (default 8 → ~90%
 * convergence in ~0.3 s at 60 fps).
 *
 * The first target is applied instantly (no animation from identity).
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-21-user-feedback.md Issue 4
 */

import * as THREE from 'three';
import { DEFAULT_LERP_RATE, clampedAlpha } from './lerp-utils';

// Reusable scratch objects (avoid per-frame allocations)
const _currentPos = new THREE.Vector3();
const _currentQuat = new THREE.Quaternion();
const _currentScale = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _targetScale = new THREE.Vector3();

export interface AlignmentLerper {
  /**
   * Set the target alignment matrix. The arWorldGroup will lerp toward
   * this target on subsequent update() calls.
   *
   * @param matrix 16-element column-major matrix (gl-matrix mat4 / Three.js toArray format)
   */
  setTarget(matrix: readonly number[]): void;

  /**
   * Advance the interpolation by dt seconds. Call once per frame.
   *
   * @param dt Delta time in seconds since last frame.
   */
  update(dt: number): void;

  /** Lifecycle cleanup (no-op — lerper does not own arWorldGroup). */
  dispose(): void;
}

/**
 * Create an AlignmentLerper that drives arWorldGroup.matrix smoothly.
 *
 * @param arWorldGroup The group whose matrix is interpolated.
 * @param lerpRate     Lerp speed multiplier (default 8).
 */
// Convergence epsilons (quality-review E-5): the exponential lerp never
// mathematically reaches the target, so without a snap the lerper decomposed,
// lerped, recomposed and ran a whole-subtree `updateMatrixWorld(true)` every
// frame FOREVER. Within these thresholds the residual is far below anything
// visible in AR: 0.1 mm position, ~0.02° rotation, 1e-6 relative scale.
const CONVERGED_POS_EPSILON_SQ = 1e-4 * 1e-4;
const CONVERGED_QUAT_DOT = 1 - 1e-8;
const CONVERGED_SCALE_EPSILON_SQ = 1e-6 * 1e-6;

export function createAlignmentLerper(
  arWorldGroup: THREE.Object3D,
  lerpRate = DEFAULT_LERP_RATE
): AlignmentLerper {
  let hasTarget = false;
  let isFirstTarget = true;
  let converged = false;

  // Stored decomposed target
  const storedTargetPos = new THREE.Vector3();
  const storedTargetQuat = new THREE.Quaternion();
  const storedTargetScale = new THREE.Vector3(1, 1, 1);

  const _matrix = new THREE.Matrix4();

  /** Write the exact stored target and refresh the subtree. */
  const applyTargetExactly = (): void => {
    _matrix.compose(storedTargetPos, storedTargetQuat, storedTargetScale);
    arWorldGroup.matrix.copy(_matrix);
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.updateMatrixWorld(true);
  };

  return {
    setTarget(matrix: readonly number[]): void {
      _matrix.fromArray(matrix);
      _matrix.decompose(storedTargetPos, storedTargetQuat, storedTargetScale);
      hasTarget = true;
      converged = false;
    },

    update(dt: number): void {
      if (!hasTarget || converged) {
        return;
      }

      if (isFirstTarget) {
        // First alignment — apply instantly, no lerp from identity
        applyTargetExactly();
        isFirstTarget = false;
        converged = true;
        return;
      }

      // Decompose current matrix
      arWorldGroup.matrix.decompose(_currentPos, _currentQuat, _currentScale);

      // Compute clamped alpha
      const alpha = clampedAlpha(lerpRate, dt);

      // Lerp position, slerp quaternion
      _currentPos.lerp(storedTargetPos, alpha);
      _currentQuat.slerp(storedTargetQuat, alpha);
      // Scale: lerp toward target (normally both are [1,1,1])
      _currentScale.lerp(storedTargetScale, alpha);

      // Epsilon-snap (E-5): once the residual is imperceptible, write the
      // EXACT target and stop the per-frame decompose/compose +
      // updateMatrixWorld work until the next setTarget.
      if (
        _currentPos.distanceToSquared(storedTargetPos) <
          CONVERGED_POS_EPSILON_SQ &&
        Math.abs(_currentQuat.dot(storedTargetQuat)) > CONVERGED_QUAT_DOT &&
        _currentScale.distanceToSquared(storedTargetScale) <
          CONVERGED_SCALE_EPSILON_SQ
      ) {
        applyTargetExactly();
        converged = true;
        return;
      }

      // Recompose and write
      _matrix.compose(_currentPos, _currentQuat, _currentScale);
      arWorldGroup.matrix.copy(_matrix);
      arWorldGroup.matrixAutoUpdate = false;
      arWorldGroup.updateMatrixWorld(true);
    },

    dispose(): void {
      // No-op — lerper does not own arWorldGroup
    },
  };
}
