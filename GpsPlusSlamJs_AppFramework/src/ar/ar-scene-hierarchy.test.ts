/**
 * Unit tests for the shared AR scene-graph builder.
 *
 * CRITICAL: These tests verify the AR/GPS coordinate frame separation.
 * See docs/architecture-ar-gps-pose-separation.md for why this matters.
 *
 * Moved here verbatim from `webxr-session.test.ts` when
 * `createSceneHierarchy` was extracted out of the live-session module; the
 * builder has two render paths (live AR and replay) and only one of them is a
 * WebXR session.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createSceneHierarchy } from './ar-scene-hierarchy.js';
import { SCENE_NODE } from './scene-node-names';

describe('createSceneHierarchy', () => {
  /**
   * Why this test matters:
   * The arWorldGroup MUST be a child of the scene for the alignment
   * matrix to work correctly. Without this, the GPS world frame cannot
   * transform the AR local frame.
   */
  it('creates scene with arWorldGroup as direct child', () => {
    const { scene, arWorldGroup } = createSceneHierarchy();

    expect(arWorldGroup.parent).toBe(scene);
    expect(arWorldGroup.name).toBe('ar-world');
  });

  /**
   * Why this test matters:
   * The camera MUST be a descendant of arWorldGroup (via arpose) so that:
   * - camera.matrix (local) = raw AR pose
   * - camera.matrixWorld = GPS world pose
   * If camera is directly in scene, we can't read the raw AR pose.
   */
  it('creates camera as descendant of arWorldGroup (via arpose)', () => {
    const { arpose, camera } = createSceneHierarchy();

    expect(camera.parent).toBe(arpose);
  });

  /**
   * Why this test matters:
   * Verifies the complete hierarchy depth:
   * scene -> arWorldGroup -> basisChangeNode -> arpose -> camera
   * The basisChangeNode holds the constant WEBXR_TO_NUE basis-change so
   * arWorldGroup's local space remains NUE (not WebXR).
   */
  it('maintains correct hierarchy depth (scene -> arWorldGroup -> basisChangeNode -> arpose -> camera)', () => {
    const { scene, arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    // Traverse from camera up to scene
    expect(camera.parent).toBe(arpose);
    expect(arpose.parent).toBe(basisChangeNode);
    expect(basisChangeNode.parent).toBe(arWorldGroup);
    expect(arWorldGroup.parent).toBe(scene);
    expect(scene.parent).toBeNull();
  });

  /**
   * Why this test matters:
   * F2 (2026-07-04 user feedback): objects 100–200 m away popped in late
   * because the far plane was a hard-coded literal 100 in the camera
   * constructor. The frustum lives in the module-private AR_CAMERA_*
   * constants (a single source of truth — live AR and replay both go
   * through createSceneHierarchy(); the constants are un-exported because
   * nothing outside the module consumes them), and far is 200 m to cover
   * the reported range. Pinning the values on the constructed camera keeps
   * the F2 regression guard: a silent revert of any constant trips this
   * test. Depth precision stays comfortable: far/near = 2×10⁴ on a 24-bit
   * buffer.
   */
  it('camera frustum is fov 70°, near 0.01 m, far 200 m (F2)', () => {
    const { camera } = createSceneHierarchy();

    expect(camera.fov).toBe(70);
    expect(camera.near).toBe(0.01);
    expect(camera.far).toBe(200);
  });

  /**
   * Why this test matters:
   * The arWorldGroup's transform is where the alignment matrix is applied.
   * We need to verify we can modify it without affecting initial state.
   */
  it('arWorldGroup starts with identity transform', () => {
    const { arWorldGroup } = createSceneHierarchy();

    // Position should be (0,0,0)
    expect(arWorldGroup.position.x).toBe(0);
    expect(arWorldGroup.position.y).toBe(0);
    expect(arWorldGroup.position.z).toBe(0);

    // Rotation should be identity quaternion (0,0,0,1)
    expect(arWorldGroup.quaternion.x).toBe(0);
    expect(arWorldGroup.quaternion.y).toBe(0);
    expect(arWorldGroup.quaternion.z).toBe(0);
    expect(arWorldGroup.quaternion.w).toBe(1);
  });

  /**
   * Why this test matters:
   * Lighting should be in GPS world space (scene level), not AR space.
   * This ensures lighting stays consistent as AR frame moves.
   */
  it('adds lighting to scene (not arWorldGroup)', () => {
    const { scene, arWorldGroup } = createSceneHierarchy();

    // Scene should have lights
    const sceneLights = scene.children.filter(
      (child) =>
        child.type === 'AmbientLight' || child.type === 'DirectionalLight'
    );
    expect(sceneLights.length).toBeGreaterThanOrEqual(2);

    // arWorldGroup should NOT have lights (only camera)
    const arLights = arWorldGroup.children.filter(
      (child) =>
        child.type === 'AmbientLight' || child.type === 'DirectionalLight'
    );
    expect(arLights.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 6.1: arpose intermediate Object3D
  // -----------------------------------------------------------------------

  /**
   * Why this test matters:
   * The arpose node sits between arWorldGroup and camera so that replay
   * mode can write recorded odomPosition/odomRotation to it without
   * touching the camera's local transform. During recording, arpose
   * stays at identity, making it transparent in the transform chain.
   */
  it('returns an arpose Object3D in the hierarchy result', () => {
    const result = createSceneHierarchy();

    expect(result.arpose).toBeDefined();
    expect(result.arpose).toBeInstanceOf(Object);
    expect(result.arpose.name).toBe('ar-pose');
  });

  /**
   * Why this test matters:
   * basisChangeNode must exist as a direct child of arWorldGroup. It holds
   * the constant WEBXR_TO_NUE matrix so that arWorldGroup's local space is
   * NUE — objects placed at [1,0,0] in arWorldGroup are 1m North, not East.
   */
  it('basisChangeNode (webxr-to-nue) is a direct child of arWorldGroup', () => {
    const { arWorldGroup } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    );

    expect(basisChangeNode).toBeDefined();
    expect(basisChangeNode!.parent).toBe(arWorldGroup);
  });

  /**
   * Why this test matters:
   * The basisChangeNode matrix must equal WEBXR_TO_NUE (column-major) and
   * must have matrixAutoUpdate=false so Three.js never overwrites it from
   * position/quaternion/scale decomposition. This guarantees the basis
   * change is permanent and free (no per-frame recomputation).
   *
   * WEBXR_TO_NUE column-major elements:
   *   [0,0,1,0, 0,1,0,0, -1,0,0,0, 0,0,0,1]
   * Key entries: el[2]=1 (East→Z), el[5]=1 (Up→Up), el[8]=-1 (South→-North)
   */
  it('basisChangeNode has WEBXR_TO_NUE matrix frozen (matrixAutoUpdate=false)', () => {
    const { arWorldGroup } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(basisChangeNode.matrixAutoUpdate).toBe(false);
    const el = basisChangeNode.matrix.elements;
    // col0: [0,0,1,0] — WebXR X(East) → NUE Z(East)
    expect(el[0]).toBeCloseTo(0, 10);
    expect(el[1]).toBeCloseTo(0, 10);
    expect(el[2]).toBeCloseTo(1, 10);
    expect(el[3]).toBeCloseTo(0, 10);
    // col1: [0,1,0,0] — WebXR Y(Up) → NUE Y(Up)
    expect(el[5]).toBeCloseTo(1, 10);
    // col2: [-1,0,0,0] — WebXR Z(South) → NUE X(North) negated
    expect(el[8]).toBeCloseTo(-1, 10);
    expect(el[9]).toBeCloseTo(0, 10);
    expect(el[10]).toBeCloseTo(0, 10);
  });

  /**
   * Why this test matters:
   * arpose must be a child of basisChangeNode (not arWorldGroup directly).
   * Full chain: alignment × WEBXR_TO_NUE × arpose × camera.
   */
  it('arpose is a direct child of basisChangeNode, not arWorldGroup', () => {
    const { arWorldGroup, arpose } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(arpose.parent).toBe(basisChangeNode);
    expect(arWorldGroup.children).not.toContain(arpose);
  });

  /**
   * Why this test matters:
   * Camera must be a child of arpose (not directly of arWorldGroup or basisChangeNode).
   * Hierarchy: basisChangeNode → arpose → camera.
   */
  it('camera is a child of arpose, not arWorldGroup or basisChangeNode directly', () => {
    const { arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(camera.parent).toBe(arpose);
    expect(basisChangeNode.children).toContain(arpose);
    expect(arWorldGroup.children).not.toContain(arpose);
    expect(arWorldGroup.children).not.toContain(camera);
  });

  /**
   * Why this test matters:
   * The full hierarchy must be scene → arWorldGroup → basisChangeNode → arpose → camera.
   * This is the chain through which transforms compose.
   */
  it('full hierarchy is scene → arWorldGroup → basisChangeNode → arpose → camera', () => {
    const { scene, arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(camera.parent).toBe(arpose);
    expect(arpose.parent).toBe(basisChangeNode);
    expect(basisChangeNode.parent).toBe(arWorldGroup);
    expect(arWorldGroup.parent).toBe(scene);
    expect(scene.parent).toBeNull();
  });

  /**
   * Why this test matters:
   * arpose must start at identity transform. During recording, WebXR
   * writes the pose to camera, and an identity arpose is transparent:
   * arWorldGroup × I × camera = arWorldGroup × camera.
   */
  it('arpose starts with identity transform', () => {
    const { arpose } = createSceneHierarchy();

    expect(arpose.position.x).toBe(0);
    expect(arpose.position.y).toBe(0);
    expect(arpose.position.z).toBe(0);
    expect(arpose.quaternion.x).toBe(0);
    expect(arpose.quaternion.y).toBe(0);
    expect(arpose.quaternion.z).toBe(0);
    expect(arpose.quaternion.w).toBe(1);
  });
});
