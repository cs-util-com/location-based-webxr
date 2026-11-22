/**
 * Unit tests for alignment-lerper module.
 *
 * Why these tests matter:
 * The AlignmentLerper smooths alignment-matrix transitions (Issue 4)
 * by interpolating arWorldGroup.matrix toward a target each frame
 * (decompose → lerp/slerp → compose), eliminating visual jumps when
 * the alignment solver produces a new alignment (~1 Hz).
 *
 * Pattern mirrors camera-follower.ts tests — real Three.js objects,
 * no mocks for scene-graph ops.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

import {
  createAlignmentLerper,
  type AlignmentLerper,
} from './alignment-lerper.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal scene with arWorldGroup (matrixAutoUpdate=false). */
function buildTestScene(): {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
} {
  const scene = new THREE.Scene();
  const arWorldGroup = new THREE.Group();
  arWorldGroup.name = 'arWorldGroup';
  arWorldGroup.matrixAutoUpdate = false;
  scene.add(arWorldGroup);
  scene.updateMatrixWorld(true);
  return { scene, arWorldGroup };
}

/** Create a 16-element column-major identity matrix. */
function identityArray(): number[] {
  return new THREE.Matrix4().identity().toArray();
}

/** Create a 16-element column-major matrix from a translation. */
function translationArray(x: number, y: number, z: number): number[] {
  return new THREE.Matrix4().makeTranslation(x, y, z).toArray();
}

/** Create a 16-element column-major matrix from a Y-axis rotation (radians). */
function rotationYArray(angle: number): number[] {
  return new THREE.Matrix4().makeRotationY(angle).toArray();
}

/** Decompose a matrix to extract its position as a Vector3. */
function extractPosition(m: THREE.Matrix4): THREE.Vector3 {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return pos;
}

/** Decompose a matrix to extract its quaternion. */
function extractQuaternion(m: THREE.Matrix4): THREE.Quaternion {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return quat;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlignmentLerper', () => {
  let arWorldGroup: THREE.Group;
  let lerper: AlignmentLerper;

  beforeEach(() => {
    ({ arWorldGroup } = buildTestScene());
    lerper = createAlignmentLerper(arWorldGroup);
  });

  // ---- First target is applied instantly ----

  it('applies first target matrix instantly (no lerp from identity)', () => {
    // Why: On session start, the first alignment should appear immediately.
    // Lerping from identity to the real alignment would cause a meaningless
    // animation from "no alignment" to "real alignment".
    const target = translationArray(10, 5, -3);
    lerper.setTarget(target);
    lerper.update(0.016); // single frame

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(10, 1);
    expect(pos.y).toBeCloseTo(5, 1);
    expect(pos.z).toBeCloseTo(-3, 1);
  });

  // ---- Subsequent targets lerp ----

  it('interpolates position toward new target over multiple frames', () => {
    // Why: Core behavior — position should lerp, not snap, after first target.
    // Set initial target (applied instantly)
    lerper.setTarget(translationArray(0, 0, 0));
    lerper.update(0.016);

    // Set new target
    lerper.setTarget(translationArray(10, 0, 0));

    // Small step — should partially converge, not reach target
    lerper.update(0.016);
    const posAfterOne = extractPosition(arWorldGroup.matrix);
    expect(posAfterOne.x).toBeGreaterThan(0);
    expect(posAfterOne.x).toBeLessThan(10);
  });

  it('interpolates quaternion (rotation) via slerp toward target', () => {
    // Why: Rotation should also transition smoothly, not snap.
    // Set initial target — identity rotation
    lerper.setTarget(identityArray());
    lerper.update(0.016);

    // Set target to 90° Y rotation
    lerper.setTarget(rotationYArray(Math.PI / 2));

    // One small step — rotation should be partially toward target
    lerper.update(0.016);
    const quat = extractQuaternion(arWorldGroup.matrix);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    );
    // angle between current and target should be less than 90° but > 0°
    const angle = quat.angleTo(targetQuat);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.PI / 2);
  });

  // ---- Convergence ----

  it('converges to target after many small dt steps', () => {
    // Why: Repeated updates should bring the matrix arbitrarily close.
    lerper.setTarget(identityArray());
    lerper.update(0.016);

    lerper.setTarget(translationArray(10, -3, 7));

    for (let i = 0; i < 200; i++) {
      lerper.update(0.016);
    }

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(10, 1);
    expect(pos.y).toBeCloseTo(-3, 1);
    expect(pos.z).toBeCloseTo(7, 1);
  });

  it('converges rotation after many small dt steps', () => {
    // Why: Slerp should converge to the target quaternion eventually.
    lerper.setTarget(identityArray());
    lerper.update(0.016);

    lerper.setTarget(rotationYArray(Math.PI / 4));

    for (let i = 0; i < 200; i++) {
      lerper.update(0.016);
    }

    const quat = extractQuaternion(arWorldGroup.matrix);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 4
    );
    expect(quat.angleTo(targetQuat)).toBeLessThan(0.01);
  });

  // ---- No overshoot ----

  it('does not overshoot when dt is very large', () => {
    // Why: Clamped alpha prevents position/rotation from going past target.
    lerper.setTarget(identityArray());
    lerper.update(0.016);

    lerper.setTarget(translationArray(10, 0, 0));
    lerper.update(100); // enormous dt

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(10, 1);
    expect(pos.y).toBeCloseTo(0, 1);
    expect(pos.z).toBeCloseTo(0, 1);
  });

  // ---- Scale preserved ----

  it('preserves unit scale through lerp', () => {
    // Why: Decompose/compose cycle must not alter scale.
    lerper.setTarget(translationArray(5, 5, 5));
    lerper.update(0.016);

    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    arWorldGroup.matrix.decompose(pos, quat, scale);
    expect(scale.x).toBeCloseTo(1, 5);
    expect(scale.y).toBeCloseTo(1, 5);
    expect(scale.z).toBeCloseTo(1, 5);
  });

  // ---- Combined translation + rotation ----

  it('handles combined translation + rotation target', () => {
    // Why: Real alignment matrices have both translation and rotation.
    lerper.setTarget(identityArray());
    lerper.update(0.016);

    // Compose target: translate (5, 2, -1) + rotate 45° around Y
    const target = new THREE.Matrix4()
      .makeRotationY(Math.PI / 4)
      .setPosition(5, 2, -1);
    lerper.setTarget(target.toArray());

    // After many frames, should converge
    for (let i = 0; i < 200; i++) {
      lerper.update(0.016);
    }

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(5, 1);
    expect(pos.y).toBeCloseTo(2, 1);
    expect(pos.z).toBeCloseTo(-1, 1);

    const quat = extractQuaternion(arWorldGroup.matrix);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 4
    );
    expect(quat.angleTo(targetQuat)).toBeLessThan(0.01);
  });

  // ---- updateMatrixWorld is called ----

  it('calls updateMatrixWorld on arWorldGroup after update', () => {
    // Why: Children of arWorldGroup need their world matrices refreshed
    // after the parent matrix changes, otherwise scene-graph propagation
    // (e.g., cyan fused spheres from Issue 5) would be stale until
    // the next renderer.render() call.
    const child = new THREE.Object3D();
    child.position.set(1, 0, 0);
    arWorldGroup.add(child);

    lerper.setTarget(translationArray(10, 0, 0));
    lerper.update(0.016); // instant first apply

    // child's world position should reflect the parent's new matrix
    const worldPos = new THREE.Vector3();
    child.getWorldPosition(worldPos);
    expect(worldPos.x).toBeCloseTo(11, 1);
  });

  // ---- Multiple rapid setTarget calls ----

  it('uses the latest target when setTarget is called multiple times before update', () => {
    // Why: If alignment changes multiple times between frames (unlikely
    // but possible), only the latest target matters.
    lerper.setTarget(translationArray(5, 0, 0));
    lerper.setTarget(translationArray(20, 0, 0)); // override
    lerper.update(0.016); // first → instant

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(20, 1);
  });

  // ---- No-op when no target set ----

  it('does nothing when update is called without a prior setTarget', () => {
    // Why: Before the first GPS event, there's no alignment to apply.
    lerper.update(0.016);

    // arWorldGroup matrix should still be identity
    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.y).toBeCloseTo(0, 5);
    expect(pos.z).toBeCloseTo(0, 5);
  });

  // ---- Custom lerpRate ----

  it('accepts a custom lerpRate', () => {
    // Why: Different contexts (recording vs replay) may want different speeds.
    const fastLerper = createAlignmentLerper(arWorldGroup, 100);

    fastLerper.setTarget(identityArray());
    fastLerper.update(0.016);

    fastLerper.setTarget(translationArray(10, 0, 0));
    // With lerpRate=100, a single 16ms frame → alpha = min(100*0.016, 1) = 1.0
    // Should snap almost immediately
    fastLerper.update(0.016);

    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBeCloseTo(10, 1);
  });

  // ---- dispose ----

  it('dispose is a no-op (does not crash)', () => {
    // Why: Lerper doesn't own arWorldGroup, just references it.
    // Dispose should be safe to call for lifecycle symmetry.
    expect(() => lerper.dispose()).not.toThrow();
  });

  // ---- E-5: epsilon-snap convergence ----

  it('snaps exactly to the target once within epsilon and stops touching the group', () => {
    // Why (quality-review E-5): before the snap, the lerper decomposed,
    // lerped, recomposed AND ran a whole-subtree updateMatrixWorld(true)
    // every frame FOREVER — the exponential lerp never reaches the target.
    // After convergence the matrix must equal the target exactly and
    // further update() calls must leave the group untouched.
    lerper.setTarget(identityArray());
    lerper.update(0.016); // instant first apply (converged immediately)
    lerper.setTarget(translationArray(10, 0, 0));
    for (let i = 0; i < 300; i++) {
      lerper.update(0.016);
    }
    // Exact equality — the convergence path snaps to the stored target.
    const pos = extractPosition(arWorldGroup.matrix);
    expect(pos.x).toBe(10);

    // Canary: external write survives further update() calls — proves the
    // converged lerper no longer recomposes per frame.
    arWorldGroup.matrix.elements[12] = 123;
    lerper.update(0.016);
    expect(arWorldGroup.matrix.elements[12]).toBe(123);
  });

  it('resumes lerping when a new target arrives after convergence', () => {
    lerper.setTarget(identityArray());
    lerper.update(0.016);
    lerper.setTarget(translationArray(10, 0, 0));
    for (let i = 0; i < 300; i++) {
      lerper.update(0.016);
    }
    expect(extractPosition(arWorldGroup.matrix).x).toBe(10);

    lerper.setTarget(translationArray(-4, 0, 0));
    for (let i = 0; i < 300; i++) {
      lerper.update(0.016);
    }
    expect(extractPosition(arWorldGroup.matrix).x).toBe(-4);
  });
});
