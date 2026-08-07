/**
 * AR scene-graph construction — the shared root of both render paths.
 *
 * This is the ONE builder for the scene graph, used by live AR
 * (`webxr-session.ts`) and by desktop replay (`replay-scene.ts`). It lives in
 * its own module precisely because it has two consumers: while it sat inside
 * `webxr-session.ts`, the replay path had to import the live-session module —
 * and with it the module-level `activeSession` singleton, the XR frame loop and
 * the three capture subsystems — to build a scene that never enters a WebXR
 * session at all.
 *
 * The module is pure apart from reading `window.innerWidth/innerHeight` for the
 * initial camera aspect.
 */

import * as THREE from 'three';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import { SCENE_NODE } from './scene-node-names';

/**
 * AR camera frustum constants — the single source of truth for live AR and
 * replay (both build their camera via {@link createSceneHierarchy}).
 *
 * F2 (2026-07-04 user feedback): far raised 100 → 200 m so objects in the
 * reported 100–200 m range are no longer frustum-culled. The far-plane
 * distance itself is essentially free at this app's object counts; the real
 * constraint is depth precision — far/near = 2×10⁴ is comfortable for a
 * 24-bit depth buffer. Revisit the ratio if AR_CAMERA_NEAR ever shrinks.
 *
 * Note: these apply to WebGL content only. The CSS3D minimap is composited by
 * the browser from the camera fov alone — near/far do not clip it (F1 in the
 * same feedback doc).
 *
 * Module-private (no consumer outside this file): the values are pinned
 * observably on the constructed camera by the frustum test in
 * `ar-scene-hierarchy.test.ts`.
 */
const AR_CAMERA_FOV = 70;
const AR_CAMERA_NEAR = 0.01;
const AR_CAMERA_FAR = 200;

/**
 * Create the scene hierarchy with proper AR/GPS frame separation.
 * This is a pure function for testability.
 *
 * Hierarchy:
 *   scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
 *   ├── ambientLight
 *   ├── directionalLight
 *   └── arWorldGroup (local space = NUE; receives alignment matrix)
 *       └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix)
 *           └── arpose (Object3D — AR pose; local space = WebXR)
 *               └── camera (PerspectiveCamera)
 *
 * basisChangeNode is a static scene-graph node that holds the WEBXR_TO_NUE
 * basis-change matrix permanently (matrixAutoUpdate=false). Moving it here
 * instead of composing it in applyAlignmentMatrix() keeps arWorldGroup's
 * local space in the **NUE axis convention** (X=North, Y=Up, Z=East), so no
 * WebXR↔NUE swizzle is needed for children.
 *
 * CAUTION — two NUE frames: arWorldGroup's local space is the *AR-odometry*
 * NUE frame, i.e. the **domain** of the alignment matrix, NOT the GPS-world
 * NUE frame of the scene root. Only content authored in AR-odometry
 * coordinates (e.g. the camera subtree) may be placed with raw local values.
 * GPS-world content (a lat/lon → NUE point) is expressed in the scene-root
 * frame and must be pre-multiplied by alignment⁻¹ before being used as a
 * local position under arWorldGroup — see createGpsAnchor and the
 * alignment-frame bug doc
 * (GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).
 *
 * - Recording: arpose stays at identity; WebXRManager writes to camera.
 * - Replay: arpose receives recorded odomPosition/odomRotation;
 *   camera is owned by user controls (OrbitControls / FPS).
 *
 * @returns Object containing scene, arWorldGroup, arpose, and camera
 */
export function createSceneHierarchy(): {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
  arpose: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
} {
  const newScene = new THREE.Scene();

  // Create the AR world group — local space is NUE (X=North, Y=Up, Z=East).
  // applyAlignmentMatrix() writes the alignment matrix directly here.
  const newArWorldGroup = new THREE.Group();
  newArWorldGroup.name = 'ar-world';
  newScene.add(newArWorldGroup);

  // Static basis-change node: converts WebXR camera coordinates to NUE world
  // space. Set once at scene creation from WEBXR_TO_NUE and never modified.
  // matrixAutoUpdate=false ensures Three.js never overwrites it from
  // position/quaternion/scale decomposition.
  const newBasisChangeNode = new THREE.Group();
  newBasisChangeNode.name = SCENE_NODE.BASIS_CHANGE;
  newBasisChangeNode.matrix.copy(WEBXR_TO_NUE);
  newBasisChangeNode.matrixAutoUpdate = false;
  newArWorldGroup.add(newBasisChangeNode);

  // Create arpose — intermediate node between basisChangeNode and camera.
  // Its local space is WebXR (X=East, Y=Up, Z=South).
  // During recording it stays at identity (transparent in transform chain).
  // During replay it receives the recorded AR pose.
  const newArPose = new THREE.Object3D();
  newArPose.name = 'ar-pose';
  newBasisChangeNode.add(newArPose);

  // Create camera INSIDE arpose.
  // Its local transform = raw AR pose from WebXR (recording) or user controls (replay).
  // Its world transform = arWorldGroup.matrix × basisChangeNode.matrix × arpose.matrix × camera.matrix
  //                     = alignment × WEBXR_TO_NUE × arpose × camera  (mathematically identical to before)
  const newCamera = new THREE.PerspectiveCamera(
    AR_CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    AR_CAMERA_NEAR,
    AR_CAMERA_FAR
  );
  newArPose.add(newCamera);

  // Add lighting to the scene (outside AR world - fixed in GPS space)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  newScene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(0, 10, 5);
  newScene.add(directionalLight);

  return {
    scene: newScene,
    arWorldGroup: newArWorldGroup,
    arpose: newArPose,
    camera: newCamera,
  };
}
