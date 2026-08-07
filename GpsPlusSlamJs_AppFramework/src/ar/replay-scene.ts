/**
 * Replay Scene Module
 *
 * Sets up a standard Three.js rendering environment for desktop replay mode
 * (no WebXR). Uses createSceneHierarchy() from ar-scene-hierarchy.ts — the
 * scene graph shared with live AR — then
 * reparents the camera to the scene root (Issue 5 fix) so orbit and FPS
 * controls operate in a stable world-space frame, unaffected by the
 * alignment matrix on arWorldGroup or odom pose updates on arpose.
 *
 * OWNS its scene objects: the replay scene/arWorldGroup/camera/arpose are
 * exposed via initReplayScene()'s return value and getReplayState(), and are
 * NEVER injected into webxr-session.ts (the historical Risk R1
 * setScene/setArWorldGroup/setCamera/setArPose hack was removed by the
 * 2026-07-11 webxr-session surface-reduction plan, step 2). The live-session
 * getters (getScene() etc.) stay null during replay; replay consumers read
 * this module's accessors instead, and scene-reading visualizers (e.g.
 * gpsEventVisualizer.setSceneSource) are pointed at these references by the
 * replay orchestrator.
 *
 * Camera modes:
 *   - orbit (default): OrbitControls — click-drag orbit + scroll zoom
 *   - fps: Drag-based mouse look + WASD — left-click-drag rotates camera,
 *     WASD moves, Space/Shift for vertical movement (Issue 6)
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md Issue 4, Issue 5, Risk R1, R5
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-12-user-feedback.md Issue 5
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSceneHierarchy } from './ar-scene-hierarchy.js';
import { createLogger } from '../utils/logger.js';
import {
  createCameraFollower,
  type CameraFollower,
} from '../visualization/camera-follower.js';
import {
  createAlignmentLerper,
  type AlignmentLerper,
} from '../visualization/alignment-lerper.js';
import { createGpsCompassCubes } from '../visualization/gps-compass-cubes.js';
import {
  createCss3dRendererManager,
  type Css3dRendererManager,
} from '../visualization/css3d-renderer-manager.js';

const log = createLogger('ReplayScene');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraMode = 'orbit' | 'fps';

export interface ReplaySceneState {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
  /**
   * The arpose node (between basisChangeNode and the detached camera slot).
   * Store subscribers write recorded odom poses here during replay.
   */
  arpose: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  orbitControls: OrbitControls;
  cameraMode: CameraMode;
  rAFId: number;
  container: HTMLElement;
  cameraFollower: CameraFollower;
  alignmentLerper: AlignmentLerper;
  css3dManager: Css3dRendererManager;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let state: ReplaySceneState | null = null;

/** WASD key tracking for FPS mode */
const keysPressed: Record<string, boolean> = {};
/** Movement speed in world-units per second (≈0.15 per frame × 60 fps). */
const FPS_MOVE_SPEED = 9;

/** Reusable scratch vectors — avoids per-frame allocations in updateFpsMovement. */
const _direction = new THREE.Vector3();
const _right = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Drag-based mouse look state (Issue 6)
// ---------------------------------------------------------------------------

const MOUSE_SENSITIVITY = 0.002; // radians per pixel
const MAX_PITCH = Math.PI / 2 - 0.01; // prevent gimbal lock
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let fpsPitch = 0; // radians (X rotation in YXZ order)
let fpsYaw = 0; // radians (Y rotation in YXZ order)
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Saved tabindex state before FPS mode mutated the container. */
type SavedTabindex =
  | { state: 'none' }
  | { state: 'saved'; value: string | undefined };
let savedTabindex: SavedTabindex = { state: 'none' };

// ---------------------------------------------------------------------------
// Keyboard handler for FPS mode
// ---------------------------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  keysPressed[e.code] = true;
}

function onKeyUp(e: KeyboardEvent): void {
  keysPressed[e.code] = false;
}

function updateFpsMovement(dt: number): void {
  if (!state || state.cameraMode !== 'fps') {
    return;
  }

  const speed = FPS_MOVE_SPEED * dt;
  const camera = state.camera;

  // Camera's forward direction (negative Z in camera space)
  camera.getWorldDirection(_direction);
  _right.crossVectors(_direction, camera.up).normalize();

  if (keysPressed['KeyW']) {
    camera.position.addScaledVector(_direction, speed);
  }
  if (keysPressed['KeyS']) {
    camera.position.addScaledVector(_direction, -speed);
  }
  if (keysPressed['KeyA']) {
    camera.position.addScaledVector(_right, -speed);
  }
  if (keysPressed['KeyD']) {
    camera.position.addScaledVector(_right, speed);
  }
  if (keysPressed['Space']) {
    camera.position.y += speed;
  }
  if (keysPressed['ShiftLeft'] || keysPressed['ShiftRight']) {
    camera.position.y -= speed;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the replay scene with a standard Three.js renderer.
 *
 * - Creates the scene hierarchy via createSceneHierarchy()
 * - Reparents camera from arWorldGroup to scene root (Risk R5)
 * - Creates a WebGLRenderer WITHOUT WebXR
 * - Keeps its own scene/arWorldGroup/arpose/camera references (returned
 *   here and via getReplayState()) — nothing is written into webxr-session
 * - Inserts canvas into the provided container
 * - Starts a requestAnimationFrame render loop
 * - Sets up OrbitControls as default camera mode
 *
 * @param container - DOM element to insert the canvas into
 * @returns Scene state object for downstream use
 * @throws If already initialized (call disposeReplayScene first)
 */
export function initReplayScene(container: HTMLElement): {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
  arpose: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
} {
  if (state) {
    throw new Error(
      'Replay scene already initialized. Call disposeReplayScene() first.'
    );
  }

  // Create scene hierarchy (camera inside arWorldGroup → arpose → camera)
  const hierarchy = createSceneHierarchy();
  const { scene, arWorldGroup, arpose, camera } = hierarchy;

  // Issue 5 fix: Reparent camera from arpose to scene root so
  // OrbitControls / FPS controls operate in a stable world-space frame.
  // When camera was under arpose, parent transform updates (odom poses,
  // alignment matrix) fought with user controls, causing erratic behavior.
  // arpose still receives recorded poses (for orbit target tracking and
  // VIO sphere visualization) — it just no longer drags the camera along.
  scene.add(camera);

  // Start camera at an elevated viewpoint for a good initial overview.
  // NUE convention: X=North, Y=Up, Z=East.
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  // Create standard renderer (no WebXR)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height);

  // Explicitly ensure WebXR is disabled
  renderer.xr.enabled = false;

  // Insert canvas into DOM
  container.appendChild(renderer.domElement);

  // Create CSS3D renderer overlay for DOM-based 3D objects (Approach E)
  const css3dManager = createCss3dRendererManager(container, width, height);

  // Set up OrbitControls as default camera mode
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.target.set(0, 0, 0);

  // Create alignment lerper (Issue 4) — smooths alignment-matrix transitions
  // so arWorldGroup.matrix lerps toward target instead of snapping.
  const alignmentLerper = createAlignmentLerper(arWorldGroup);

  // Create camera follower (Issue 8) — child of scene root (not arWorldGroup),
  // so world rotation stays identity regardless of alignment matrix.
  const cameraFollower = createCameraFollower(scene);
  createGpsCompassCubes(cameraFollower.object3D);

  // Start render loop
  const rAFId = startRenderLoop(
    renderer,
    scene,
    camera,
    orbitControls,
    css3dManager
  );

  state = {
    scene,
    arWorldGroup,
    arpose,
    camera,
    renderer,
    orbitControls,
    cameraMode: 'orbit',
    rAFId,
    container,
    cameraFollower,
    alignmentLerper,
    css3dManager,
  };

  log.info('Replay scene initialized');

  return { scene, arWorldGroup, arpose, camera, renderer };
}

/**
 * Dispose the replay scene, cleaning up all resources.
 *
 * - Cancels the rAF render loop
 * - Disposes renderer (frees GPU resources)
 * - Disposes camera controls
 * - Removes canvas from DOM
 * - Clears this module's state (getReplayState() returns null afterwards)
 *
 * Safe to call multiple times (idempotent).
 */
export function disposeReplayScene(): void {
  if (!state) {
    return;
  }

  // Cancel render loop
  cancelAnimationFrame(state.rAFId);

  // Dispose alignment lerper and camera follower
  state.alignmentLerper.dispose();
  state.cameraFollower.dispose();

  // Dispose CSS3D renderer overlay
  state.css3dManager.dispose();

  // Dispose controls
  state.orbitControls.dispose();

  // Remove FPS listeners if active
  if (state.cameraMode === 'fps') {
    removeFpsListeners();
  }
  state.container.removeEventListener('keydown', onKeyDown);
  state.container.removeEventListener('keyup', onKeyUp);

  // Restore original tabindex
  restoreTabindex();

  // Remove canvas from DOM
  if (state.renderer.domElement.parentElement) {
    state.renderer.domElement.parentElement.removeChild(
      state.renderer.domElement
    );
  }

  // Dispose renderer (free GPU resources)
  state.renderer.dispose();

  state = null;

  log.info('Replay scene disposed');
}

/**
 * Get the current replay scene state, or null if not initialized.
 */
export function getReplayState(): ReplaySceneState | null {
  return state;
}

/** Scratch vector for orbit-target follow delta — avoids per-call allocation. */
const _targetDelta = new THREE.Vector3();

/**
 * Update the OrbitControls target position and translate the camera
 * by the same delta so the orbit viewing relationship is preserved.
 *
 * OrbitControls.update() does NOT automatically move the camera when
 * the target changes — it recomputes offset = camera.position - target
 * each frame, which is a no-op without user input. Without explicit
 * camera translation, the camera would sit still while the trajectory
 * moves away. Moving the camera by the target delta keeps the viewing
 * angle and distance constant as the trajectory progresses.
 *
 * Call this as new odom poses are replayed so the orbit camera
 * auto-follows the recorded trajectory.
 *
 * No-op if not initialized.
 */
export function updateOrbitTarget(position: THREE.Vector3): void {
  if (!state) {
    return;
  }
  _targetDelta.copy(position).sub(state.orbitControls.target);
  state.camera.position.add(_targetDelta);
  state.orbitControls.target.copy(position);
}

/**
 * Get the current camera control mode.
 * Returns 'orbit' if not initialized.
 */
export function getCameraMode(): CameraMode {
  return state?.cameraMode ?? 'orbit';
}

/**
 * Get the camera follower's Object3D, or null if the replay scene
 * is not initialized. Use this to attach children (e.g., map mesh)
 * that should track the camera's position but stay GPS-aligned.
 */
export function getCameraFollower(): THREE.Object3D | null {
  return state?.cameraFollower.object3D ?? null;
}

/**
 * Get the alignment lerper, or null if not initialized.
 * Used by replay-mode to route store-subscriber alignment updates
 * through the lerper instead of applying them directly.
 */
export function getAlignmentLerper(): AlignmentLerper | null {
  return state?.alignmentLerper ?? null;
}

/**
 * Get the CSS3D renderer manager, or null if not initialized.
 * Used for external resize handling or to verify the CSS3D layer exists.
 */
export function getCss3dManager(): Css3dRendererManager | null {
  return state?.css3dManager ?? null;
}

/**
 * Toggle between orbit and FPS camera modes.
 *
 * - orbit → fps: Disables OrbitControls, creates and enables
 *   PointerLockControls + WASD keyboard handler
 * - fps → orbit: Disables PointerLockControls, re-enables OrbitControls
 *
 * No-op if not initialized.
 */
export function toggleCameraMode(): void {
  if (!state) {
    return;
  }

  if (state.cameraMode === 'orbit') {
    switchToFps();
  } else {
    switchToOrbit();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function startRenderLoop(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  orbitControls: OrbitControls,
  css3dManager: Css3dRendererManager
): number {
  const timer = new THREE.Timer();

  function animate(): void {
    if (!state) {
      return;
    }
    state.rAFId = requestAnimationFrame(animate);

    timer.update();
    const dt = timer.getDelta();

    // Update active controls
    if (state.cameraMode === 'orbit') {
      orbitControls.update();
    } else {
      updateFpsMovement(dt);
    }

    // Update alignment lerper (Issue 4) — interpolate arWorldGroup.matrix
    // toward the latest target set by store subscribers.
    state.alignmentLerper.update(dt);

    // Update camera follower position (Issue 8) — must happen after
    // controls update so the follower sees the latest camera position.
    state.cameraFollower.update(state.camera, dt);

    renderer.render(scene, camera);
    css3dManager.render(scene, camera);
  }

  return requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Drag-based mouse look handlers (Issue 6)
// ---------------------------------------------------------------------------

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) {
    return;
  } // left-click only
  isDragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
}

function onPointerMove(e: PointerEvent): void {
  if (!isDragging || !state) {
    return;
  }

  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  fpsYaw -= dx * MOUSE_SENSITIVITY;
  fpsPitch -= dy * MOUSE_SENSITIVITY;
  fpsPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, fpsPitch));

  _euler.set(fpsPitch, fpsYaw, 0, 'YXZ');
  state.camera.quaternion.setFromEuler(_euler);
}

function onPointerUp(): void {
  isDragging = false;
}

/** Restore the container's tabindex to its pre-FPS-mode value. */
function restoreTabindex(): void {
  if (!state || savedTabindex.state === 'none') {
    return;
  }
  if (savedTabindex.value === undefined) {
    // We added it — remove it
    state.container.removeAttribute('tabindex');
  } else if (savedTabindex.value !== state.container.getAttribute('tabindex')) {
    // We may have changed it — restore original
    state.container.setAttribute('tabindex', savedTabindex.value);
  }
  savedTabindex = { state: 'none' };
}

function addFpsListeners(): void {
  if (!state) {
    return;
  }
  const canvas = state.renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
}

function removeFpsListeners(): void {
  if (!state) {
    return;
  }
  const canvas = state.renderer.domElement;
  canvas.removeEventListener('pointerdown', onPointerDown);
  canvas.removeEventListener('pointermove', onPointerMove);
  canvas.removeEventListener('pointerup', onPointerUp);
  isDragging = false;
}

// ---------------------------------------------------------------------------
// Camera mode switching
// ---------------------------------------------------------------------------

function switchToFps(): void {
  if (!state) {
    return;
  }

  // Disable orbit controls
  state.orbitControls.enabled = false;

  // Extract current yaw/pitch from camera orientation so drag
  // continues from the current viewing direction.
  _euler.setFromQuaternion(state.camera.quaternion, 'YXZ');
  fpsYaw = _euler.y;
  fpsPitch = _euler.x;

  // Add drag-based mouse look + WASD keyboard listeners
  addFpsListeners();
  // Attach keyboard listeners to container (not document) to avoid
  // capturing events globally. Make container focusable if needed.
  // Store original tabindex so we can restore it on cleanup.
  const currentTabindex = state.container.hasAttribute('tabindex')
    ? (state.container.getAttribute('tabindex') ?? '')
    : undefined;
  savedTabindex = { state: 'saved', value: currentTabindex };
  if (currentTabindex === undefined) {
    state.container.setAttribute('tabindex', '0');
  }
  state.container.focus();
  state.container.addEventListener('keydown', onKeyDown);
  state.container.addEventListener('keyup', onKeyUp);

  state.cameraMode = 'fps';
  log.info('Switched to FPS camera mode');
}

function switchToOrbit(): void {
  if (!state || state.cameraMode === 'orbit') {
    return;
  }

  state.cameraMode = 'orbit';

  // Remove FPS listeners
  removeFpsListeners();
  state.container.removeEventListener('keydown', onKeyDown);
  state.container.removeEventListener('keyup', onKeyUp);

  // Restore original tabindex
  restoreTabindex();

  // Re-enable orbit controls
  state.orbitControls.enabled = true;

  // Clear any pressed keys
  for (const k of Object.keys(keysPressed)) {
    keysPressed[k] = false;
  }

  log.info('Switched to Orbit camera mode');
}
