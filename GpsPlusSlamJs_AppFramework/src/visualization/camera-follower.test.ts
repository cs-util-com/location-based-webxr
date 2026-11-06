/**
 * Unit tests for camera-follower module.
 *
 * Why these tests matter:
 * The CameraFollower solves the "map rotates with camera" bug (Issue 8).
 * It reads the camera's world position each frame and lerps toward it
 * while keeping its own rotation at identity (GPS-aligned). The follower
 * is a child of the scene root (not arWorldGroup) so its world rotation
 * stays identity regardless of alignment matrix changes. Children like
 * the map mesh and compass cubes stay flat/world-oriented regardless of
 * camera rotation, orbit controls, or alignment matrix changes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

import {
  createCameraFollower,
  type CameraFollower,
} from './camera-follower.js';
import { SCENE_NODE } from '../ar/scene-node-names.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal scene graph matching the real hierarchy:
 *  scene → arWorldGroup → basisChangeNode → arpose → camera */
function buildTestScene(): {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
  camera: THREE.PerspectiveCamera;
  arpose: THREE.Object3D;
} {
  const scene = new THREE.Scene();
  const arWorldGroup = new THREE.Group();
  arWorldGroup.name = 'arWorldGroup';
  scene.add(arWorldGroup);

  // basisChangeNode with an identity matrix (simplifies tests)
  const basisChangeNode = new THREE.Object3D();
  basisChangeNode.name = SCENE_NODE.BASIS_CHANGE;
  arWorldGroup.add(basisChangeNode);

  const arpose = new THREE.Object3D();
  arpose.name = 'arpose';
  basisChangeNode.add(arpose);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
  arpose.add(camera);

  // Ensure all world matrices are up to date
  scene.updateMatrixWorld(true);

  return { scene, arWorldGroup, camera, arpose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraFollower', () => {
  let scene: THREE.Scene;
  let arWorldGroup: THREE.Group;
  let camera: THREE.PerspectiveCamera;
  let follower: CameraFollower;

  beforeEach(() => {
    ({ scene, arWorldGroup, camera } = buildTestScene());
    follower = createCameraFollower(scene);
  });

  // ---- Construction & hierarchy ----

  it('is a child of scene root (not arWorldGroup)', () => {
    expect(follower.object3D.parent).toBe(scene);
    expect(arWorldGroup.children).not.toContain(follower.object3D);
  });

  it('has name "camera-follower"', () => {
    expect(follower.object3D.name).toBe(SCENE_NODE.CAMERA_FOLLOWER);
  });

  it('starts at position (0,0,0)', () => {
    const { x, y, z } = follower.object3D.position;
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });

  it('starts with identity rotation', () => {
    const q = follower.object3D.quaternion;
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  // ---- update() — position tracking ----

  it('lerps position toward camera world position in scene space', () => {
    // Move the camera to (5, 2, 3) in world space
    camera.position.set(5, 2, 3);
    scene.updateMatrixWorld(true);

    // After a large dt, follower should be very close to the target
    follower.update(camera, 1.0);

    const pos = follower.object3D.position;
    expect(pos.x).toBeCloseTo(5, 0);
    expect(pos.y).toBeCloseTo(2, 0);
    expect(pos.z).toBeCloseTo(3, 0);
  });

  it('does not overshoot when dt is very large', () => {
    camera.position.set(10, 0, 0);
    scene.updateMatrixWorld(true);

    // dt = 100 should NOT overshoot past the target
    follower.update(camera, 100);

    const pos = follower.object3D.position;
    // Should clamp to exactly target, not beyond
    expect(pos.x).toBeCloseTo(10, 1);
    expect(pos.y).toBeCloseTo(0, 1);
    expect(pos.z).toBeCloseTo(0, 1);
  });

  it('converges incrementally with small dt steps', () => {
    camera.position.set(10, 0, 0);
    scene.updateMatrixWorld(true);

    // Small step — should partially converge
    follower.update(camera, 0.016);
    const afterOneFrame = follower.object3D.position.x;
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(10);

    // More steps — should converge further
    for (let i = 0; i < 100; i++) {
      follower.update(camera, 0.016);
    }
    const afterManyFrames = follower.object3D.position.x;
    expect(afterManyFrames).toBeCloseTo(10, 0);
  });

  // ---- Rotation invariant ----

  it('keeps rotation at identity after update, regardless of camera rotation', () => {
    // Rotate camera wildly
    camera.quaternion.setFromEuler(new THREE.Euler(1, 2, 3));
    camera.position.set(5, 3, 7);
    scene.updateMatrixWorld(true);

    follower.update(camera, 1.0);

    const q = follower.object3D.quaternion;
    expect(q.x).toBeCloseTo(0, 5);
    expect(q.y).toBeCloseTo(0, 5);
    expect(q.z).toBeCloseTo(0, 5);
    expect(q.w).toBeCloseTo(1, 5);
  });

  it('keeps rotation at identity even when arWorldGroup has a non-identity matrix', () => {
    // Simulate an alignment matrix on arWorldGroup
    arWorldGroup.matrix.makeRotationY(Math.PI / 4);
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.updateMatrixWorld(true);

    camera.position.set(5, 0, 0);
    scene.updateMatrixWorld(true);

    follower.update(camera, 1.0);

    const q = follower.object3D.quaternion;
    expect(q.x).toBeCloseTo(0, 5);
    expect(q.y).toBeCloseTo(0, 5);
    expect(q.z).toBeCloseTo(0, 5);
    expect(q.w).toBeCloseTo(1, 5);
  });

  // ---- arWorldGroup with alignment matrix ----

  it('correctly tracks camera world position when arWorldGroup has an alignment matrix', () => {
    // Apply a rotation to arWorldGroup (simulating GPS/AR alignment)
    arWorldGroup.matrix.makeRotationY(Math.PI / 2);
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.updateMatrixWorld(true);

    // Camera is inside arWorldGroup → its world position includes arWorldGroup's
    // transform. The follower (at scene root) should track the camera's world
    // position directly.
    camera.position.set(3, 0, 0);
    scene.updateMatrixWorld(true);

    const expectedWorldPos = new THREE.Vector3();
    camera.getWorldPosition(expectedWorldPos);

    follower.update(camera, 1.0);

    const pos = follower.object3D.position;
    expect(pos.x).toBeCloseTo(expectedWorldPos.x, 0);
    expect(pos.y).toBeCloseTo(expectedWorldPos.y, 0);
    expect(pos.z).toBeCloseTo(expectedWorldPos.z, 0);
  });

  // ---- Children follow ----

  it('children of the follower inherit its position but stay world-axis-aligned', () => {
    const childCube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    childCube.position.set(1, 0, 0); // 1m "north" of follower
    follower.object3D.add(childCube);

    camera.position.set(5, 0, 0);
    scene.updateMatrixWorld(true);
    follower.update(camera, 1.0);

    // After update, follower is near (5,0,0), child should be near (6,0,0)
    scene.updateMatrixWorld(true);
    const childWorldPos = new THREE.Vector3();
    childCube.getWorldPosition(childWorldPos);
    expect(childWorldPos.x).toBeCloseTo(6, 0);
    expect(childWorldPos.y).toBeCloseTo(0, 0);
    expect(childWorldPos.z).toBeCloseTo(0, 0);
  });

  // ---- World rotation invariant (bug fix: cameraFollower outside arWorldGroup) ----

  it('compass cube child points along world +X (North) even when arWorldGroup has alignment rotation', () => {
    // Why this test matters: when cameraFollower was a child of arWorldGroup,
    // its world rotation inherited the alignment matrix rotation. This caused
    // compass cubes to point in the initial forward direction rather than true
    // N/E/S/W. Moving cameraFollower to scene root fixes this because
    // its world rotation stays identity regardless of alignment changes.
    const northCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial()
    );
    northCube.position.set(1, 0, 0); // 1m along local +X ("North" in NUE)
    follower.object3D.add(northCube);

    // Apply a 90° Y rotation to arWorldGroup (simulating GPS/AR alignment)
    arWorldGroup.matrix.makeRotationY(Math.PI / 2);
    arWorldGroup.matrixAutoUpdate = false;
    scene.updateMatrixWorld(true);

    // Move camera and update follower
    camera.position.set(5, 0, 0);
    scene.updateMatrixWorld(true);
    follower.update(camera, 1.0);
    scene.updateMatrixWorld(true);

    // The follower's world rotation must be identity — children should
    // be offset along the true world axes, not rotated axes.
    const followerWorldPos = new THREE.Vector3();
    follower.object3D.getWorldPosition(followerWorldPos);

    const cubeWorldPos = new THREE.Vector3();
    northCube.getWorldPosition(cubeWorldPos);

    // The offset from follower to cube in world space should be exactly +X
    const offset = cubeWorldPos.clone().sub(followerWorldPos);
    expect(offset.x).toBeCloseTo(1, 1); // +X = North
    expect(offset.y).toBeCloseTo(0, 1);
    expect(offset.z).toBeCloseTo(0, 1);
  });

  it('world quaternion of follower is identity even when arWorldGroup has alignment rotation', () => {
    // Why this test matters: The local quaternion was always identity (never set),
    // but the WORLD quaternion inherited arWorldGroup's rotation. This is the
    // root cause of compass cubes pointing in the wrong direction.
    arWorldGroup.matrix.makeRotationY(Math.PI / 3);
    arWorldGroup.matrixAutoUpdate = false;
    scene.updateMatrixWorld(true);

    follower.update(camera, 1.0);
    scene.updateMatrixWorld(true);

    const worldQuat = new THREE.Quaternion();
    follower.object3D.getWorldQuaternion(worldQuat);
    expect(worldQuat.x).toBeCloseTo(0, 5);
    expect(worldQuat.y).toBeCloseTo(0, 5);
    expect(worldQuat.z).toBeCloseTo(0, 5);
    expect(worldQuat.w).toBeCloseTo(1, 5);
  });

  // ---- dispose ----

  it('dispose removes follower from parent', () => {
    follower.dispose();
    // After the fix, follower is a child of scene (not arWorldGroup)
    expect(follower.object3D.parent).toBeNull();
  });
});
