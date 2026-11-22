/**
 * Unit tests for replay-scene module.
 *
 * Why these tests matter:
 * The replay scene is the Three.js rendering surface for desktop replay mode.
 * It must set up the correct scene hierarchy with arpose between arWorldGroup
 * and camera, OWN its scene references (exposed via the init return value and
 * getReplayState() — it must NOT leak into webxr-session's live-session
 * getters), and use a standard requestAnimationFrame loop instead of WebXR.
 *
 * Tests are split across iterations 3a (core scene), 3b (OrbitControls),
 * and 3c (FPS toggle).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import fc from 'fast-check';
import { getScene, getArWorldGroup, getCamera } from './webxr-session.js';
import { SCENE_NODE } from './scene-node-names.js';

// We must mock WebGLRenderer since jsdom has no WebGL context.
// The mock provides the minimal interface that initReplayScene needs.
// Uses a class (not vi.fn().mockImplementation) so `new WebGLRenderer()` works
// correctly in Vitest's SSR transform.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    setAnimationLoop = vi.fn();
    xr = { enabled: false };
  }

  class MockTimer {
    update = vi.fn();
    getDelta = vi.fn().mockReturnValue(1 / 60);
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
    Timer: MockTimer,
  };
});

// We also mock OrbitControls since it needs a real DOM/WebGL canvas that
// jsdom doesn't provide. Uses a class (not vi.fn().mockImplementation)
// so `new OrbitControls()` works correctly in Vitest's SSR transform.
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const THREE = await import('three');
  class MockOrbitControls {
    enabled = true;
    enableDamping = false;
    // Use a real Vector3 so .copy()/.sub() work for follow-the-target logic
    target = new THREE.Vector3();
    update = vi.fn();
    dispose = vi.fn();
  }
  return { OrbitControls: MockOrbitControls };
});

// Mock CSS3DRenderer so we can verify it's created and called.
// Uses a class (not vi.fn().mockImplementation) to be constructable.
const mockCss3dRender = vi.fn();
const mockCss3dSetSize = vi.fn();
const mockCss3dDispose = vi.fn();
vi.mock('../visualization/css3d-renderer-manager.js', () => ({
  createCss3dRendererManager: vi.fn(() => ({
    render: mockCss3dRender,
    setSize: mockCss3dSetSize,
    dispose: mockCss3dDispose,
  })),
}));

import { createCss3dRendererManager } from '../visualization/css3d-renderer-manager.js';

// Import after mocks are set up
import {
  initReplayScene,
  disposeReplayScene,
  getReplayState,
  updateOrbitTarget,
  getCameraMode,
  toggleCameraMode,
  getCameraFollower,
  applyReplayAlignment,
  getCss3dManager,
} from './replay-scene.js';

describe('replay-scene', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    // Give the container dimensions so the renderer can size correctly
    Object.defineProperty(container, 'clientWidth', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    document.body.appendChild(container);

    // Mock requestAnimationFrame / cancelAnimationFrame for rAF loop testing
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((_cb) => {
      return 42; // Return a fake rAF ID
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    disposeReplayScene();
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Iteration 3a: Core Scene Setup
  // -----------------------------------------------------------------------

  describe('initReplayScene — core scene setup (3a)', () => {
    /**
     * Why this test matters (Issue 5 fix):
     * The camera must be a direct child of the scene root during replay
     * so OrbitControls and FPS controls operate in a stable world-space
     * frame. When the camera was under arpose, parent transform updates
     * (odom poses, alignment matrix) fought with user orbit/drag
     * interactions, causing erratic behavior.
     */
    it('reparents camera to scene root for stable controls (Issue 5)', () => {
      const result = initReplayScene(container);

      // Camera is a direct child of scene (not arpose)
      expect(result.camera.parent).toBe(result.scene);
      // Camera is NOT under arWorldGroup
      expect(result.arWorldGroup.children).not.toContain(result.camera);
    });

    /**
     * Why this test matters (surface-reduction step 2):
     * The replay scene OWNS its references — initReplayScene must NOT write
     * them into webxr-session's live-session getters (the deleted Risk R1
     * injection). getScene()/getArWorldGroup()/getCamera() stay null during
     * replay; consumers read the init return value / getReplayState().
     */
    it('does not leak scene objects into webxr-session live getters', () => {
      const result = initReplayScene(container);

      expect(getScene()).toBeNull();
      expect(getArWorldGroup()).toBeNull();
      expect(getCamera()).toBeNull();
      // The refs live in this module's own state instead.
      const st = getReplayState()!;
      expect(st.scene).toBe(result.scene);
      expect(st.arWorldGroup).toBe(result.arWorldGroup);
      expect(st.camera).toBe(result.camera);
    });

    /**
     * Why this test matters (6.3, surface-reduction step 2):
     * initReplayScene must expose the arpose Object3D through its own
     * return value / state so store subscribers (replay-mode's
     * onNewOdomPose) can update it with recorded odom data.
     */
    it('exposes arpose through the init return value and replay state', () => {
      const result = initReplayScene(container);

      expect(result.arpose).toBeDefined();
      expect(result.arpose.name).toBe('ar-pose');
      expect(getReplayState()!.arpose).toBe(result.arpose);
    });

    /**
     * Why this test matters:
     * The replay scene must NOT enable WebXR on the renderer.
     * If xr.enabled is true, Three.js expects an XR session which
     * doesn't exist in replay mode.
     */
    it('creates renderer with xr.enabled === false', () => {
      const result = initReplayScene(container);

      expect(result.renderer.xr.enabled).toBe(false);
    });

    /**
     * Why this test matters:
     * The renderer's canvas must be inserted into the provided container
     * so it's visible in the DOM.
     */
    it('inserts canvas into the provided container', () => {
      const result = initReplayScene(container);

      expect(container.contains(result.renderer.domElement)).toBe(true);
    });

    /**
     * Why this test matters:
     * The renderer must be sized to match its container for correct
     * aspect ratio and viewport coverage.
     */
    it('sizes renderer to match container dimensions', () => {
      const result = initReplayScene(container);

      // The mock renderer's setSize should have been called with container dimensions
      const renderer = result.renderer as unknown as {
        setSize: ReturnType<typeof vi.fn>;
      };
      expect(renderer.setSize).toHaveBeenCalledWith(800, 600);
    });

    /**
     * Why this test matters:
     * The render loop must use requestAnimationFrame (not WebXR's
     * setAnimationLoop) since there is no XR session.
     */
    it('starts a requestAnimationFrame render loop', () => {
      initReplayScene(container);

      expect(window.requestAnimationFrame).toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * The scene hierarchy must include lighting for visibility.
     * createSceneHierarchy() already adds ambient + directional light.
     */
    it('scene includes lighting from createSceneHierarchy', () => {
      const result = initReplayScene(container);

      const lights = result.scene.children.filter(
        (c) => c.type === 'AmbientLight' || c.type === 'DirectionalLight'
      );
      expect(lights.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * Why this test matters:
     * arWorldGroup must still be a child of scene for the alignment
     * matrix to work. Only the camera is reparented.
     */
    it('arWorldGroup remains a child of scene', () => {
      const result = initReplayScene(container);

      expect(result.arWorldGroup.parent).toBe(result.scene);
    });

    /**
     * Why this test matters:
     * Calling initReplayScene twice without disposing should throw
     * to prevent resource leaks and duplicate canvases.
     */
    it('throws if called while already initialized', () => {
      initReplayScene(container);

      expect(() => initReplayScene(container)).toThrow();
    });
  });

  describe('disposeReplayScene — cleanup (3a)', () => {
    /**
     * Why this test matters:
     * Disposal must remove the canvas from the DOM to prevent
     * orphaned elements.
     */
    it('removes canvas from container', () => {
      const result = initReplayScene(container);
      const canvas = result.renderer.domElement;
      expect(container.contains(canvas)).toBe(true);

      disposeReplayScene();

      expect(container.contains(canvas)).toBe(false);
    });

    /**
     * Why this test matters:
     * webxr-session's live getters must stay null across the whole replay
     * lifecycle — neither init nor dispose may touch the live-session
     * singleton (surface-reduction step 2 removed that injection).
     */
    it('never touches webxr-session module state (init or dispose)', () => {
      initReplayScene(container);
      expect(getScene()).toBeNull();

      disposeReplayScene();

      expect(getScene()).toBeNull();
      expect(getArWorldGroup()).toBeNull();
      expect(getCamera()).toBeNull();
    });

    /**
     * Why this test matters:
     * The rAF loop must be cancelled to prevent the disposed renderer
     * from being called.
     */
    it('cancels the requestAnimationFrame loop', () => {
      initReplayScene(container);

      disposeReplayScene();

      expect(window.cancelAnimationFrame).toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * The renderer must be disposed to free GPU resources.
     */
    it('disposes the renderer', () => {
      const result = initReplayScene(container);
      const renderer = result.renderer as unknown as {
        dispose: ReturnType<typeof vi.fn>;
      };

      disposeReplayScene();

      expect(renderer.dispose).toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * disposeReplayScene should be safe to call multiple times
     * (idempotent) without throwing.
     */
    it('is safe to call when not initialized', () => {
      expect(() => disposeReplayScene()).not.toThrow();
    });

    /**
     * Why this test matters:
     * After dispose, getReplayState should indicate no active scene.
     */
    it('getReplayState returns null after dispose', () => {
      initReplayScene(container);
      expect(getReplayState()).not.toBeNull();

      disposeReplayScene();

      expect(getReplayState()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Iteration 3b: OrbitControls
  // -----------------------------------------------------------------------

  describe('OrbitControls (3b)', () => {
    /**
     * Why this test matters:
     * OrbitControls should be the default camera control mode,
     * active immediately after initReplayScene.
     */
    it('default camera mode is orbit', () => {
      initReplayScene(container);

      expect(getCameraMode()).toBe('orbit');
    });

    /**
     * Why this test matters:
     * updateOrbitTarget must set the orbit center so the camera
     * auto-follows GPS event positions during replay.
     */
    it('updateOrbitTarget sets the orbit center', () => {
      initReplayScene(container);
      const { orbitControls } = getReplayState()!;

      updateOrbitTarget(new THREE.Vector3(5, 10, 15));

      expect(orbitControls.target.x).toBeCloseTo(5);
      expect(orbitControls.target.y).toBeCloseTo(10);
      expect(orbitControls.target.z).toBeCloseTo(15);
    });

    /**
     * Why this test matters:
     * OrbitControls.update() does NOT automatically move the camera when
     * the target moves — it recomputes offset = camera.position - target
     * each frame, which is a no-op without user input. So the camera
     * would sit still while the trajectory moves away. updateOrbitTarget
     * must translate the camera by the same delta as the target so the
     * orbit viewing relationship (angle + distance) is preserved.
     */
    it('updateOrbitTarget translates camera to follow trajectory', () => {
      const result = initReplayScene(container);
      const camera = result.camera;

      // Camera starts at (0, 5, 10), orbit target at (0, 0, 0)
      const initialCamPos = camera.position.clone();

      // Simulate first odom position arriving
      updateOrbitTarget(new THREE.Vector3(10, 0, 20));

      // Camera should have moved by the same delta: (10, 0, 20)
      expect(camera.position.x).toBeCloseTo(initialCamPos.x + 10);
      expect(camera.position.y).toBeCloseTo(initialCamPos.y + 0);
      expect(camera.position.z).toBeCloseTo(initialCamPos.z + 20);
    });

    /**
     * Why this test matters:
     * When multiple orbit target updates happen (trajectory progressing),
     * each update should apply an incremental delta, not a cumulative
     * one from the origin. This ensures the camera smoothly follows
     * the trajectory without jumps.
     */
    it('updateOrbitTarget applies incremental deltas across multiple calls', () => {
      const result = initReplayScene(container);
      const camera = result.camera;
      const initialCamPos = camera.position.clone();

      // First position
      updateOrbitTarget(new THREE.Vector3(10, 0, 0));
      // Second position — delta from first is (5, 2, 0)
      updateOrbitTarget(new THREE.Vector3(15, 2, 0));

      // Total camera movement should be (15, 2, 0) from origin
      expect(camera.position.x).toBeCloseTo(initialCamPos.x + 15);
      expect(camera.position.y).toBeCloseTo(initialCamPos.y + 2);
      expect(camera.position.z).toBeCloseTo(initialCamPos.z + 0);
    });

    /**
     * Why this test matters:
     * updateOrbitTarget should be safe to call before init
     * (no-op, no throw).
     */
    it('updateOrbitTarget is safe before init', () => {
      disposeReplayScene();
      expect(() => updateOrbitTarget(new THREE.Vector3(1, 2, 3))).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Iteration 3c: FPS Mode Toggle
  // -----------------------------------------------------------------------

  describe('Camera mode toggle (3c)', () => {
    /**
     * Why this test matters:
     * toggleCameraMode must switch from orbit to FPS mode.
     */
    it('toggleCameraMode switches from orbit to fps', () => {
      initReplayScene(container);
      expect(getCameraMode()).toBe('orbit');

      toggleCameraMode();

      expect(getCameraMode()).toBe('fps');
    });

    /**
     * Why this test matters:
     * toggleCameraMode must switch back from FPS to orbit mode.
     */
    it('toggleCameraMode switches from fps back to orbit', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps
      expect(getCameraMode()).toBe('fps');

      toggleCameraMode(); // fps → orbit

      expect(getCameraMode()).toBe('orbit');
    });

    /**
     * Why this test matters:
     * toggleCameraMode should be safe to call before init (no-op).
     */
    it('toggleCameraMode is safe before init', () => {
      disposeReplayScene();
      expect(() => toggleCameraMode()).not.toThrow();
    });

    /**
     * Why this test matters:
     * getCameraMode should return a sensible default before init.
     */
    it('getCameraMode returns orbit before init', () => {
      disposeReplayScene();
      expect(getCameraMode()).toBe('orbit');
    });

    /**
     * Why this test matters:
     * After disposal, both control systems must be cleaned up,
     * disposing any event listeners they may hold.
     */
    it('disposeReplayScene cleans up both control systems', () => {
      initReplayScene(container);
      toggleCameraMode(); // activate FPS to ensure both are created

      // Should not throw and should clean up
      expect(() => disposeReplayScene()).not.toThrow();
      expect(getReplayState()).toBeNull();
    });

    /**
     * Why this test matters:
     * Switching to FPS mode adds tabindex="0" to the container so it can
     * receive keyboard events. Switching back to orbit must restore the
     * original tabindex (or remove it if it didn't exist) to avoid
     * polluting the host application's DOM and accessibility tree.
     */
    it('restores original tabindex when switching back to orbit', () => {
      initReplayScene(container);
      expect(container.hasAttribute('tabindex')).toBe(false);

      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('0');

      toggleCameraMode(); // fps → orbit
      expect(container.hasAttribute('tabindex')).toBe(false);
    });

    /**
     * Why this test matters:
     * If the container already had a tabindex before FPS mode was
     * activated, switching back must restore that original value
     * rather than removing the attribute entirely.
     */
    it('restores pre-existing tabindex when switching back to orbit', () => {
      container.setAttribute('tabindex', '-1');
      initReplayScene(container);

      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('-1'); // preserved

      toggleCameraMode(); // fps → orbit
      expect(container.getAttribute('tabindex')).toBe('-1');
    });

    /**
     * Why this test matters:
     * When the scene is disposed while still in FPS mode, the container's
     * tabindex must be restored to avoid leaking DOM side effects into
     * the host application.
     */
    it('restores tabindex on dispose while in FPS mode', () => {
      initReplayScene(container);
      expect(container.hasAttribute('tabindex')).toBe(false);

      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('0');

      disposeReplayScene();
      expect(container.hasAttribute('tabindex')).toBe(false);
    });

    /**
     * Why this test matters:
     * Dispose while in FPS mode must restore a pre-existing tabindex
     * rather than removing it.
     */
    it('restores pre-existing tabindex on dispose while in FPS mode', () => {
      container.setAttribute('tabindex', '5');
      initReplayScene(container);

      toggleCameraMode(); // orbit → fps
      disposeReplayScene();

      expect(container.getAttribute('tabindex')).toBe('5');
    });

    /**
     * Why this test matters:
     * Before the null-sentinel fix, disposing in orbit mode (without
     * ever entering FPS) treated the uninitialized savedTabindex
     * (undefined) as "we added it — remove it," incorrectly stripping
     * a pre-existing tabindex from the container.
     */
    it('does not remove pre-existing tabindex when disposing without entering FPS', () => {
      container.setAttribute('tabindex', '3');
      initReplayScene(container);

      // Never toggle to FPS — dispose directly from orbit
      disposeReplayScene();

      expect(container.getAttribute('tabindex')).toBe('3');
    });

    /**
     * Why this test matters:
     * Multiple orbit↔FPS round-trips must correctly save and restore
     * tabindex each time without state leaking between cycles. This
     * catches bugs where the save/restore sentinel is not properly
     * reset after each round-trip (e.g., confusing null and undefined
     * as "nothing saved" vs "attribute was absent").
     */
    it('handles multiple orbit↔FPS round-trips without tabindex leakage', () => {
      initReplayScene(container);
      expect(container.hasAttribute('tabindex')).toBe(false);

      // Round-trip 1
      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('0');
      toggleCameraMode(); // fps → orbit
      expect(container.hasAttribute('tabindex')).toBe(false);

      // Round-trip 2 — must still work identically
      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('0');
      toggleCameraMode(); // fps → orbit
      expect(container.hasAttribute('tabindex')).toBe(false);

      // Round-trip 3 with dispose from FPS
      toggleCameraMode(); // orbit → fps
      disposeReplayScene();
      expect(container.hasAttribute('tabindex')).toBe(false);
    });

    /**
     * Why this test matters:
     * When the container has a pre-existing tabindex, multiple round-trips
     * must preserve the original value each time. This validates that the
     * save/restore mechanism resets cleanly between cycles.
     */
    it('preserves pre-existing tabindex across multiple orbit↔FPS round-trips', () => {
      container.setAttribute('tabindex', '-1');
      initReplayScene(container);

      // Round-trip 1
      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('-1');
      toggleCameraMode(); // fps → orbit
      expect(container.getAttribute('tabindex')).toBe('-1');

      // Round-trip 2
      toggleCameraMode(); // orbit → fps
      expect(container.getAttribute('tabindex')).toBe('-1');
      toggleCameraMode(); // fps → orbit
      expect(container.getAttribute('tabindex')).toBe('-1');
    });
  });

  // -----------------------------------------------------------------------
  // Issue 5: Orbit camera stability — camera reparented to scene root
  // -----------------------------------------------------------------------

  describe('Issue 5: Camera reparenting for stable orbit controls', () => {
    /**
     * Why this test matters:
     * arpose must remain in the hierarchy under basisChangeNode even
     * after the camera is detached from it. arpose receives recorded
     * odom poses during replay and its world position is used as the
     * orbit target to follow the trajectory.
     */
    it('arpose remains in hierarchy under basisChangeNode after camera reparent', () => {
      const result = initReplayScene(container);
      const arpose = result.arpose;
      const arWorldGroup = result.arWorldGroup;

      expect(arpose).not.toBeNull();
      expect(arpose.name).toBe('ar-pose');
      // arpose.parent = basisChangeNode, basisChangeNode.parent = arWorldGroup
      expect(arpose.parent?.parent).toBe(arWorldGroup);
    });

    /**
     * Why this test matters:
     * When camera is at scene root, arpose updates (via onNewOdomPose)
     * must NOT implicitly move the camera through the parent chain.
     * Camera movement only happens explicitly via updateOrbitTarget.
     * This is the core of Issue 5 — parent transform fighting.
     */
    it('camera world position is unaffected by arpose transform changes', () => {
      const result = initReplayScene(container);
      const arpose = result.arpose;
      const camera = result.camera;

      // Record camera world position
      const posBefore = new THREE.Vector3();
      camera.getWorldPosition(posBefore);

      // Simulate an odom pose update on arpose (as onNewOdomPose would do)
      arpose.position.set(100, 50, 200);
      arpose.quaternion.set(0.5, 0.5, 0.5, 0.5).normalize();
      arpose.updateWorldMatrix(true, false);

      // Camera world position should NOT have changed (no parent coupling)
      const posAfter = new THREE.Vector3();
      camera.getWorldPosition(posAfter);
      expect(posAfter.distanceTo(posBefore)).toBe(0);
    });

    /**
     * Why this test matters:
     * The camera should start elevated above the origin so the user
     * gets a meaningful overview when replay begins. Starting at (0,0,0)
     * would place the camera inside the scene origin with nothing visible.
     */
    it('camera starts at an elevated viewpoint above origin', () => {
      const result = initReplayScene(container);

      // Camera should be at the specific elevated viewpoint (0, 5, 10)
      expect(result.camera.position).toEqual(new THREE.Vector3(0, 5, 10));
    });
  });

  // -----------------------------------------------------------------------
  // Frame-rate independent FPS movement
  // -----------------------------------------------------------------------

  describe('FPS movement — frame-rate independence', () => {
    /**
     * Why this test matters:
     * FPS movement speed must be multiplied by the frame delta time so
     * movement is consistent regardless of display refresh rate.
     * At dt = 1/60 s with FPS_MOVE_SPEED = 9 units/s the per-frame
     * displacement should be 9 * (1/60) = 0.15 units. A frame at
     * dt = 1/144 s should move less (≈ 0.0625 units).
     */
    it('FPS movement scales with delta time, not frame count', () => {
      // Capture the animate callback passed to requestAnimationFrame
      let animateFn: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        animateFn = cb;
        return 42;
      });

      initReplayScene(container);
      toggleCameraMode(); // switch to FPS

      const st = getReplayState()!;
      const camera = st.camera;

      // Position camera at origin facing -Z
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);

      // Simulate pressing W (forward) — key event on container, not document
      container.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));

      // Record position before frame
      const posBefore = camera.position.clone();

      // Tick the render loop — Clock mock returns 1/60
      expect(animateFn).not.toBeNull();
      animateFn!(performance.now());

      // Camera should have moved by FPS_MOVE_SPEED * dt = 9 * (1/60) = 0.15
      const displacement = camera.position.clone().sub(posBefore).length();
      expect(displacement).toBeCloseTo(0.15, 2);

      // Release key
      container.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    });
  });

  // -----------------------------------------------------------------------
  // Issue 8: CameraFollower + Compass Cubes
  // -----------------------------------------------------------------------

  describe('CameraFollower + Compass Cubes (Issue 8)', () => {
    /**
     * Why this test matters:
     * The camera follower must be created during scene init so that
     * children (map mesh, compass cubes) can be attached immediately.
     * It must be a child of scene root (not arWorldGroup) so its world
     * rotation stays identity regardless of alignment matrix changes.
     */
    it('initReplayScene creates a camera-follower in scene root', () => {
      const result = initReplayScene(container);

      const follower = result.scene.getObjectByName(SCENE_NODE.CAMERA_FOLLOWER);
      expect(follower).toBeDefined();
      expect(follower!.parent).toBe(result.scene);
    });

    /**
     * Why this test matters:
     * Compass cubes provide cardinal direction indicators (N, E, S, W, Up).
     * They must be children of the camera-follower so they stay
     * GPS-aligned and near the camera.
     */
    it('compass cubes group is a child of the camera-follower', () => {
      const result = initReplayScene(container);

      const follower = result.scene.getObjectByName(SCENE_NODE.CAMERA_FOLLOWER);
      const compass = follower!.getObjectByName('gps-compass-cubes');
      expect(compass).toBeDefined();
    });

    /**
     * Why this test matters:
     * The getCameraFollower() getter must be available for external
     * callers (e.g., to reparent the map mesh).
     */
    it('getCameraFollower returns the follower Object3D after init', () => {
      initReplayScene(container);

      const followerObj = getCameraFollower();
      expect(followerObj).not.toBeNull();
      expect(followerObj!.name).toBe(SCENE_NODE.CAMERA_FOLLOWER);
    });

    /**
     * Why this test matters:
     * After dispose, the follower getter should return null to prevent
     * stale references.
     */
    it('getCameraFollower returns null after dispose', () => {
      initReplayScene(container);
      disposeReplayScene();

      expect(getCameraFollower()).toBeNull();
    });

    /**
     * Why this test matters:
     * The follower must be a direct child of scene root (not arWorldGroup
     * or basisChangeNode), so its world rotation stays identity and compass
     * directions align with the NUE GPS frame regardless of alignment.
     */
    it('camera-follower is a direct child of scene root, not under arWorldGroup', () => {
      const result = initReplayScene(container);

      const follower = result.scene.getObjectByName(SCENE_NODE.CAMERA_FOLLOWER);
      // Direct child of scene root
      expect(follower!.parent).toBe(result.scene);
      // Not a descendant of arWorldGroup
      expect(
        result.arWorldGroup.getObjectByName(SCENE_NODE.CAMERA_FOLLOWER)
      ).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Issue 6: Drag-based FPS mouse look (replaces PointerLockControls)
  // -----------------------------------------------------------------------

  describe('FPS mode — drag-based mouse look (Issue 6)', () => {
    /**
     * Why this test matters:
     * Entering FPS mode must register pointer event listeners on the
     * canvas so the user can drag to rotate the camera. Without these
     * listeners, mouse dragging does nothing — which is the original bug.
     */
    it('registers pointer listeners on canvas when entering FPS mode', () => {
      initReplayScene(container);
      const canvas = getReplayState()!.renderer.domElement;
      const addSpy = vi.spyOn(canvas, 'addEventListener');

      toggleCameraMode(); // orbit → fps

      const types = addSpy.mock.calls.map((c) => c[0]);
      expect(types).toContain('pointerdown');
      expect(types).toContain('pointermove');
      expect(types).toContain('pointerup');
    });

    /**
     * Why this test matters:
     * Left-click-drag horizontally must change the camera's yaw (Y-axis
     * rotation). This is the primary interaction for looking around in
     * FPS mode. Dragging right = rotating camera left (negative yaw).
     */
    it('left-click-drag rotates camera yaw (horizontal movement)', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const camera = getReplayState()!.camera;
      const canvas = getReplayState()!.renderer.domElement;

      // Point camera along -Z and record initial yaw
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);
      const initialYaw = new THREE.Euler().setFromQuaternion(
        camera.quaternion,
        'YXZ'
      ).y;

      // Simulate left-click drag: 50 pixels to the right
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          clientX: 400,
          clientY: 300,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          buttons: 1,
          clientX: 450,
          clientY: 300,
        })
      );
      canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }));

      const newYaw = new THREE.Euler().setFromQuaternion(
        camera.quaternion,
        'YXZ'
      ).y;

      // Yaw should have changed by -50 * 0.002 = -0.1 rad
      expect(newYaw).not.toBeCloseTo(initialYaw, 3);
    });

    /**
     * Why this test matters:
     * Left-click-drag vertically must change the camera's pitch (X-axis
     * rotation in YXZ Euler order). Dragging down = looking down.
     */
    it('left-click-drag rotates camera pitch (vertical movement)', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const camera = getReplayState()!.camera;
      const canvas = getReplayState()!.renderer.domElement;

      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);
      const initialPitch = new THREE.Euler().setFromQuaternion(
        camera.quaternion,
        'YXZ'
      ).x;

      // Simulate left-click drag: 50 pixels down
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          clientX: 400,
          clientY: 300,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          buttons: 1,
          clientX: 400,
          clientY: 350,
        })
      );
      canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }));

      const newPitch = new THREE.Euler().setFromQuaternion(
        camera.quaternion,
        'YXZ'
      ).x;

      expect(newPitch).not.toBeCloseTo(initialPitch, 3);
    });

    /**
     * Why this test matters:
     * Pitch must be clamped to prevent the camera from flipping past
     * vertical (±π/2). Without clamping, large vertical drags cause
     * gimbal lock and disorienting camera flips.
     */
    it('pitch is clamped to prevent camera flipping past vertical', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const camera = getReplayState()!.camera;
      const canvas = getReplayState()!.renderer.domElement;

      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);

      // Massive downward drag (800 pixels ≈ 1.6 rad, well past π/2)
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          clientX: 400,
          clientY: 100,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          buttons: 1,
          clientX: 400,
          clientY: 900,
        })
      );
      canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }));

      const euler = new THREE.Euler().setFromQuaternion(
        camera.quaternion,
        'YXZ'
      );
      // Pitch should be clamped — strictly inside ±π/2
      expect(euler.x).toBeGreaterThan(-Math.PI / 2);
      expect(euler.x).toBeLessThan(Math.PI / 2);
    });

    /**
     * Why this test matters:
     * When switching from orbit to FPS, the camera's current orientation
     * must be preserved so the user doesn't experience a jarring reset.
     * The drag handler initializes its internal yaw/pitch from the
     * camera's existing quaternion.
     */
    it('preserves camera orientation when switching orbit → FPS', () => {
      initReplayScene(container);

      const camera = getReplayState()!.camera;
      // Set a non-trivial orientation during orbit mode
      camera.lookAt(5, 3, -10);
      const orientBefore = camera.quaternion.clone();

      toggleCameraMode(); // orbit → fps

      // Camera orientation should remain unchanged
      expect(camera.quaternion.x).toBeCloseTo(orientBefore.x, 5);
      expect(camera.quaternion.y).toBeCloseTo(orientBefore.y, 5);
      expect(camera.quaternion.z).toBeCloseTo(orientBefore.z, 5);
      expect(camera.quaternion.w).toBeCloseTo(orientBefore.w, 5);
    });

    /**
     * Why this test matters:
     * Switching back to orbit mode must clean up the pointer listeners
     * to prevent FPS mouse look from interfering with OrbitControls.
     */
    it('removes pointer listeners when switching back to orbit mode', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const canvas = getReplayState()!.renderer.domElement;
      const removeSpy = vi.spyOn(canvas, 'removeEventListener');

      toggleCameraMode(); // fps → orbit

      const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedTypes).toContain('pointerdown');
      expect(removedTypes).toContain('pointermove');
      expect(removedTypes).toContain('pointerup');
    });

    /**
     * Why this test matters:
     * If the scene is disposed while in FPS mode, pointer listeners
     * must still be cleaned up to prevent memory leaks.
     */
    it('removes pointer listeners on dispose from FPS mode', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const canvas = getReplayState()!.renderer.domElement;
      const removeSpy = vi.spyOn(canvas, 'removeEventListener');

      disposeReplayScene();

      const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedTypes).toContain('pointerdown');
      expect(removedTypes).toContain('pointermove');
      expect(removedTypes).toContain('pointerup');
    });

    /**
     * Why this test matters:
     * FPS mouse look drag should only respond while the button is
     * held down. Mouse movement after releasing the button must not
     * rotate the camera.
     */
    it('stops rotating after pointer is released', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      const camera = getReplayState()!.camera;
      const canvas = getReplayState()!.renderer.domElement;

      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);

      // Drag then release
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          clientX: 400,
          clientY: 300,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          buttons: 1,
          clientX: 450,
          clientY: 300,
        })
      );
      canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }));

      // Record orientation after release
      const quatAfterRelease = camera.quaternion.clone();

      // More mouse movement (no button held)
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          buttons: 0,
          clientX: 500,
          clientY: 300,
        })
      );

      // Camera should NOT have rotated further
      expect(camera.quaternion.x).toBeCloseTo(quatAfterRelease.x, 5);
      expect(camera.quaternion.y).toBeCloseTo(quatAfterRelease.y, 5);
      expect(camera.quaternion.z).toBeCloseTo(quatAfterRelease.z, 5);
      expect(camera.quaternion.w).toBeCloseTo(quatAfterRelease.w, 5);
    });
  });

  // -----------------------------------------------------------------------
  // Alignment: every change lands exactly, in the frame it arrives
  // -----------------------------------------------------------------------

  describe('applyReplayAlignment', () => {
    /** A rigid alignment (rotation about an arbitrary axis plus translation). */
    function rigid(
      axis: readonly [number, number, number],
      angle: number,
      t: readonly [number, number, number]
    ): number[] {
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(...axis).normalize(),
        angle
      );
      return new THREE.Matrix4()
        .compose(new THREE.Vector3(...t), q, new THREE.Vector3(1, 1, 1))
        .toArray();
    }

    /** Element-wise exact equality (`toEqual` would tell +0 from -0). */
    function expectExact(
      actual: readonly number[],
      expected: readonly number[]
    ): void {
      for (let i = 0; i < 16; i++) expect(actual[i]! - expected[i]!).toBe(0);
    }

    const A = rigid([0, 1, 0], 0.4, [3, -1, 7]);
    const B = rigid([1, 2, -1], -1.1, [-12, 0.5, 4]);

    /**
     * Why this test matters:
     * Replay follows the same rule as the live binding: the world shows the
     * newest alignment at once. A smoothing step (half the way, an easing
     * rate) would leave the group between two alignments and turn this red,
     * for the first alignment and for the one that follows it.
     */
    it('lands each alignment exactly, in the call, and keeps the world matrix in step', () => {
      initReplayScene(container);
      const group = getReplayState()!.arWorldGroup;

      applyReplayAlignment(A);
      expectExact(group.matrix.elements, A);
      expect(group.matrixAutoUpdate).toBe(false);
      expectExact(group.matrixWorld.elements, A);

      applyReplayAlignment(B);
      expectExact(group.matrix.elements, B);
      expectExact(group.matrixWorld.elements, B);
    });

    /**
     * Why this test matters:
     * Nothing in the render loop may move the group after an alignment
     * landed: no per-frame easing is left that could pull it elsewhere.
     */
    it('render frames leave a landed alignment untouched', () => {
      let animateFn: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        animateFn = cb;
        return 42;
      });
      initReplayScene(container);
      const group = getReplayState()!.arWorldGroup;

      applyReplayAlignment(A);
      for (let i = 0; i < 5; i++) animateFn!(performance.now());
      expectExact(group.matrix.elements, A);
      expectExact(group.matrixWorld.elements, A);
    });

    /**
     * Why this test matters:
     * Whatever sequence of alignments a recording replays, the group shows
     * exactly the last one after each call: no step depends on the one
     * before it.
     */
    it('property: after any sequence of rigid alignments the group shows the last one exactly', () => {
      initReplayScene(container);
      const group = getReplayState()!.arWorldGroup;
      const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
      const unit = fc.double({ min: -1, max: 1, noNaN: true });
      const alignment = fc
        .tuple(
          fc
            .tuple(unit, unit, unit)
            .filter(([x, y, z]) => x * x + y * y + z * z > 1e-6),
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
          fc.tuple(coord, coord, coord)
        )
        .map(([axis, angle, t]) => rigid(axis, angle, t));
      fc.assert(
        fc.property(
          fc.array(alignment, { minLength: 1, maxLength: 6 }),
          (seq) => {
            for (const m of seq) {
              applyReplayAlignment(m);
              expectExact(group.matrix.elements, m);
            }
          }
        )
      );
    });

    /**
     * Why this test matters:
     * The matrix comes from the store, a module boundary: a short or
     * non-finite one must not blank the world, so it is refused and the
     * last good alignment stays.
     */
    it('refuses a malformed matrix and keeps the last good alignment', () => {
      initReplayScene(container);
      const group = getReplayState()!.arWorldGroup;
      applyReplayAlignment(A);

      applyReplayAlignment(A.slice(0, 15));
      applyReplayAlignment(A.map((v, i) => (i === 12 ? Number.NaN : v)));
      applyReplayAlignment(A.map((v, i) => (i === 0 ? Infinity : v)));

      expectExact(group.matrix.elements, A);
    });

    /**
     * Why this test matters:
     * A store subscriber may fire after the scene was disposed; the call
     * must be a silent no-op, not a crash in the dispatch chain.
     */
    it('is a no-op before init and after dispose', () => {
      expect(() => applyReplayAlignment(A)).not.toThrow();
      initReplayScene(container);
      disposeReplayScene();
      expect(() => applyReplayAlignment(A)).not.toThrow();
      expect(getReplayState()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // CSS3DRenderer integration (Approach E — Leaflet in 3D)
  // -----------------------------------------------------------------------

  describe('CSS3DRenderer integration (Approach E)', () => {
    beforeEach(() => {
      mockCss3dRender.mockClear();
      mockCss3dSetSize.mockClear();
      mockCss3dDispose.mockClear();
      vi.mocked(createCss3dRendererManager).mockClear();
    });

    /**
     * Why this test matters:
     * The CSS3DRenderer overlay must be created during scene init so that
     * CSS3DObjects (e.g., LeafletMapOverlay) are rendered from the first
     * frame. Without it, CSS3D content would be invisible.
     */
    it('creates a CSS3DRendererManager during initReplayScene', () => {
      initReplayScene(container);

      expect(createCss3dRendererManager).toHaveBeenCalledTimes(1);
      expect(createCss3dRendererManager).toHaveBeenCalledWith(
        container,
        expect.any(Number),
        expect.any(Number)
      );
    });

    /**
     * Why this test matters:
     * The CSS3D renderer must receive the same dimensions as the WebGL
     * renderer so CSS3D content aligns pixel-perfectly with 3D geometry.
     */
    it('creates CSS3DRendererManager with container dimensions', () => {
      initReplayScene(container);

      expect(createCss3dRendererManager).toHaveBeenCalledWith(
        container,
        800,
        600
      );
    });

    /**
     * Why this test matters:
     * Each frame must call both the WebGL renderer AND the CSS3D renderer
     * so that both mesh-based and DOM-based 3D objects are visible.
     * Missing the CSS3D render call would make the Leaflet map invisible.
     */
    it('calls CSS3D render in the animation loop', () => {
      // Capture the animate callback to manually tick the loop
      let animateFn: FrameRequestCallback | null = null;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        animateFn = cb;
        return 42;
      });

      initReplayScene(container);

      expect(animateFn).not.toBeNull();
      // Tick one frame
      animateFn!(performance.now());

      expect(mockCss3dRender).toHaveBeenCalledTimes(1);
      // Verify it was called with the scene and camera
      expect(mockCss3dRender).toHaveBeenCalledWith(
        expect.any(THREE.Scene),
        expect.any(THREE.PerspectiveCamera)
      );
    });

    /**
     * Why this test matters:
     * Disposal must clean up the CSS3D renderer to remove its DOM overlay
     * element and prevent memory leaks / orphaned DOM nodes.
     */
    it('disposes CSS3DRendererManager on disposeReplayScene', () => {
      initReplayScene(container);

      disposeReplayScene();

      expect(mockCss3dDispose).toHaveBeenCalledTimes(1);
    });

    /**
     * Why this test matters:
     * getCss3dManager() must be accessible so that external callers
     * (e.g., window resize handling) can update the CSS3D renderer size.
     */
    it('getCss3dManager returns the manager after init', () => {
      initReplayScene(container);

      const mgr = getCss3dManager();
      expect(mgr).not.toBeNull();
      expect(mgr).toHaveProperty('render');
      expect(mgr).toHaveProperty('setSize');
      expect(mgr).toHaveProperty('dispose');
    });

    /**
     * Why this test matters:
     * After dispose, getCss3dManager must return null to prevent
     * stale references from being used after cleanup.
     */
    it('getCss3dManager returns null after dispose', () => {
      initReplayScene(container);
      disposeReplayScene();

      expect(getCss3dManager()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // DOM hardcoding audit — regression tests
  // -----------------------------------------------------------------------

  describe('DOM hardcoding audit regressions', () => {
    /**
     * Why this test matters:
     * FPS keyboard listeners must be scoped to the container element,
     * not document, to prevent capturing events globally. Two replay
     * scenes on the same page, or a host app with keyboard shortcuts,
     * would interfere if listeners leak to document.
     * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 6 (P3).
     */
    it('FPS keyboard listeners are scoped to container, not document', () => {
      const docAddSpy = vi.spyOn(document, 'addEventListener');
      const containerAddSpy = vi.spyOn(container, 'addEventListener');

      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      // Keyboard listeners should NOT be on document
      const docKeydownCalls = docAddSpy.mock.calls.filter(
        ([event]) => event === 'keydown'
      );
      expect(docKeydownCalls).toHaveLength(0);

      // Keyboard listeners should be on container
      const containerKeydownCalls = containerAddSpy.mock.calls.filter(
        ([event]) => event === 'keydown'
      );
      expect(containerKeydownCalls).toHaveLength(1);

      docAddSpy.mockRestore();
      containerAddSpy.mockRestore();
    });

    /**
     * Why this test matters:
     * The container must be made focusable (tabindex) so that it can
     * receive keyboard events when FPS mode is activated.
     */
    it('container gets tabindex when FPS mode is activated', () => {
      initReplayScene(container);
      toggleCameraMode(); // orbit → fps

      expect(container.getAttribute('tabindex')).toBe('0');
    });
  });
});
