/**
 * Unit tests for WebXR session utilities.
 *
 * Tests the pure, extractable parts of WebXR session setup.
 * The actual WebXR API calls require a real device or emulator.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * Tests verify the scene hierarchy and pose separation invariants.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSessionOptions,
  extractPoseFromViewer,
  extractResetTransformData,
  createSceneHierarchy,
  isXRCameraLike,
  getXrCameraFromPose,
  shouldLogCameraAccessDiagnostic,
  isWebXRSupported,
  getCurrentArPose,
  getScene,
  getArWorldGroup,
  getCamera,
  resetWebXRState,
  endARSession,
  applyAlignmentMatrix,
  nuePositionToWebXR,
  startImageCapture,
  stopImageCapture,
  getImageCaptureFrameCount,
  startDepthCapture,
  stopDepthCapture,
  getDepthSampleCount,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  getCameraFrameCount,
  DEFAULT_CAMERA_FRAME_CAPTURE_SIZE,
  getDepthInfoFromFrame,
  type ARPose,
} from './webxr-session.js';
import { createMockPose } from '../test-utils/browser-mocks.js';
import {
  registerSessionDisposer,
  clearSessionDisposers,
} from './session-disposers.js';
import { SCENE_NODE } from './scene-node-names';

describe('buildSessionOptions', () => {
  /**
   * Why this test matters:
   * Ensures the session options include all required WebXR features.
   * This is a regression test for the domOverlay type safety fix.
   */
  it('returns valid XRSessionInit with required features', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.requiredFeatures).toContain('local-floor');
    expect(options.optionalFeatures).toContain('dom-overlay');
    expect(options.optionalFeatures).toContain('depth-sensing');
    expect(options.domOverlay).toEqual({ root: mockElement });
  });

  /**
   * Why this test matters:
   * Regression test for the null-safety issue that was previously
   * hidden by @ts-expect-error. If document.getElementById returns null,
   * we must fail fast with a clear error rather than passing null to WebXR.
   */
  it('throws when rootElement is null', () => {
    expect(() => buildSessionOptions(null)).toThrow(
      'App root element not found'
    );
  });

  /**
   * Why this test matters:
   * Validates that the domOverlay.root is the exact element passed in,
   * ensuring correct DOM overlay behavior in AR sessions.
   */
  it('uses the provided element as domOverlay root', () => {
    const appDiv = document.createElement('div');
    appDiv.id = 'app';

    const options = buildSessionOptions(appDiv);

    expect(options.domOverlay?.root).toBe(appDiv);
  });

  /**
   * Why this test matters:
   * REGRESSION TEST for Sentry issue JS-GPS-RECORDER-1.
   * Three.js has a bug in WebXRManager where glBinding.getDepthInformation()
   * is called without null-checking when gpu-optimized depth is active.
   * This causes crashes during XR session teardown race conditions.
   * We MUST only use cpu-optimized to avoid triggering this bug.
   * Our DepthSampler uses XRFrame.getDepthInformation() which works with cpu-optimized.
   */
  it('uses only cpu-optimized depth sensing to avoid Three.js bug', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    // Access the depthSensing property (typed as unknown in XRSessionInit)
    const depthSensing = (
      options as { depthSensing?: { usagePreference?: string[] } }
    ).depthSensing;

    expect(depthSensing).toBeDefined();
    expect(depthSensing?.usagePreference).toContain('cpu-optimized');
    expect(depthSensing?.usagePreference).not.toContain('gpu-optimized');
  });

  /**
   * Why this test matters (Black Frames Bug Fix):
   * The 'camera-access' optional feature is required for
   * renderer.xr.getCameraTexture() to work. Without it, the WebXR
   * camera texture is not available and we fall back to canvas.toBlob()
   * which produces black frames on Android Chrome.
   *
   * @see docs/2026-02-06-bug-camera-frames-black.md
   */
  it('includes camera-access in optional features for blit capture', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.optionalFeatures).toContain('camera-access');
  });

  it('omits dom-overlay when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDomOverlay: false,
    });

    expect(options.optionalFeatures).not.toContain('dom-overlay');
    expect(options.domOverlay).toBeUndefined();
  });

  it('omits camera-access when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableCameraAccess: false,
    });

    expect(options.optionalFeatures).not.toContain('camera-access');
  });

  it('omits depth-sensing config when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDepthSensingFeature: false,
    }) as XRSessionInit & { depthSensing?: unknown };

    expect(options.optionalFeatures).not.toContain('depth-sensing');
    expect(options.depthSensing).toBeUndefined();
  });

  it('can build a minimal baseline session request with all optional flags disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDomOverlay: false,
      enableCameraAccess: false,
      enableDepthSensingFeature: false,
    }) as XRSessionInit & { depthSensing?: unknown };

    expect(options.requiredFeatures).toEqual(['local-floor']);
    expect(options.optionalFeatures).toBeUndefined();
    expect(options.domOverlay).toBeUndefined();
    expect(options.depthSensing).toBeUndefined();
  });

  /**
   * Why this test matters:
   * The minimal AR hit-test example needs the session to request the WebXR
   * `hit-test` feature. It is opt-in (default off) so existing
   * recorder/anchor sessions are unaffected, and it is *optional* (not
   * required) so the session still starts on runtimes without hit-test. See
   * `2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md` §6.3.
   */
  it('does not request hit-test by default', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.optionalFeatures ?? []).not.toContain('hit-test');
    expect(options.requiredFeatures).not.toContain('hit-test');
  });

  it('requests hit-test as an optional feature when requestHitTest is true', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      {},
      { requestHitTest: true }
    );

    expect(options.optionalFeatures).toContain('hit-test');
    // Still optional, never required, so unsupported devices can still start.
    expect(options.requiredFeatures).toEqual(['local-floor']);
  });

  it('keeps hit-test off when requestHitTest is false even with other flags disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      {
        enableDomOverlay: false,
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
      },
      { requestHitTest: false }
    );

    expect(options.optionalFeatures).toBeUndefined();
  });

  /**
   * Why these tests matter (live depth occluder, Iter 1 —
   * 2026-06-14-0009-webxr-depth-occlusion-plan.md §6/§8):
   * The live CPU-depth occluder is a consumer of the SAME cpu-optimized depth
   * stream the grid uses, but consumer apps want occlusion WITHOUT the
   * recorder's depth-capture crash-isolation flag. So `requestDepthOcclusion`
   * must request `depth-sensing` (cpu-optimized) independently of
   * `enableDepthSensingFeature`. Crucially, BOTH flags resolving the same
   * cpu-optimized usage is valid — there is no conflict and no throw (this is
   * the key difference from the deleted gpu-optimized plan, which had to throw
   * when both were requested).
   */
  it('requests cpu-optimized depth-sensing when requestDepthOcclusion is true even if depth capture is off', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      { enableDepthSensingFeature: false },
      { requestDepthOcclusion: true }
    ) as XRSessionInit & {
      depthSensing?: { usagePreference?: string[] };
    };

    expect(options.optionalFeatures).toContain('depth-sensing');
    expect(options.depthSensing?.usagePreference).toContain('cpu-optimized');
    expect(options.depthSensing?.usagePreference).not.toContain(
      'gpu-optimized'
    );
  });

  it('requests depth-sensing exactly once (no conflict/throw) when BOTH depth flags are set', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      { enableDepthSensingFeature: true },
      { requestDepthOcclusion: true }
    ) as XRSessionInit & {
      depthSensing?: { usagePreference?: string[] };
    };

    // Coexist on the same cpu-optimized stream — requested once, not duplicated.
    const depthEntries = (options.optionalFeatures ?? []).filter(
      (f) => f === 'depth-sensing'
    );
    expect(depthEntries).toHaveLength(1);
    expect(options.depthSensing?.usagePreference).toContain('cpu-optimized');
  });

  it('keeps depth-sensing off when both depth flags are off', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      { enableDepthSensingFeature: false },
      { requestDepthOcclusion: false }
    ) as XRSessionInit & { depthSensing?: unknown };

    expect(options.optionalFeatures ?? []).not.toContain('depth-sensing');
    expect(options.depthSensing).toBeUndefined();
  });
});

describe('extractPoseFromViewer', () => {
  /**
   * Why this test matters:
   * Verifies that pose extraction correctly maps XRViewerPose data
   * to our ARPose interface for downstream processing.
   */
  it('extracts position and orientation from valid pose', () => {
    const mockPose = createMockPose(
      { x: 1.5, y: 2.0, z: -3.0 },
      { x: 0.1, y: 0.2, z: 0.3, w: 0.9 }
    );

    // Cast to XRViewerPose - mock contains only properties needed for extraction
    const result = extractPoseFromViewer(mockPose as unknown as XRViewerPose);

    expect(result).not.toBeNull();
    expect(result?.position).toEqual({ x: 1.5, y: 2.0, z: -3.0 });
    expect(result?.orientation).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
  });

  /**
   * Why this test matters:
   * Ensures graceful handling when pose is unavailable (e.g., tracking lost).
   */
  it('returns null when pose is null', () => {
    const result = extractPoseFromViewer(null);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * Handles edge case where pose exists but has no views.
   */
  it('returns null when pose has no views', () => {
    const emptyPose = { views: [] } as unknown as XRViewerPose;

    const result = extractPoseFromViewer(emptyPose);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * Validates that the extracted pose is a plain object (not a reference
   * to the XR types), allowing safe serialization and storage.
   */
  it('returns plain object suitable for serialization', () => {
    const mockPose = createMockPose(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 }
    );

    // Cast to XRViewerPose - mock contains only properties needed for extraction
    const result = extractPoseFromViewer(mockPose as unknown as XRViewerPose);

    // Should be serializable as JSON
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized) as ARPose;

    expect(parsed.position).toEqual({ x: 0, y: 1, z: 0 });
    expect(parsed.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('isXRCameraLike', () => {
  /**
   * Why this test matters:
   * The WebXR frame loop uses this guard before forwarding camera dimensions
   * into the capture pipeline, so accepted values must satisfy downstream
   * assumptions about finite, non-zero render target sizes.
   */
  it('accepts objects with finite positive dimensions', () => {
    expect(isXRCameraLike({ width: 1920, height: 1080 })).toBe(true);
  });

  /**
   * Why this test matters:
   * Invalid dimensions can reach sizing code and produce broken render targets
   * or unexpected capture behavior, so the guard must reject non-finite and
   * non-positive numbers.
   */
  it.each([
    { width: 0, height: 1080 },
    { width: -1, height: 1080 },
    { width: Number.NaN, height: 1080 },
    { width: Number.POSITIVE_INFINITY, height: 1080 },
    { width: 1920, height: 0 },
    { width: 1920, height: -1 },
    { width: 1920, height: Number.NaN },
    { width: 1920, height: Number.POSITIVE_INFINITY },
  ])('rejects invalid camera dimensions: %o', (value) => {
    expect(isXRCameraLike(value)).toBe(false);
  });
});

describe('getXrCameraFromPose', () => {
  /**
   * Why this test matters:
   * REGRESSION — the per-frame texture acquisition block used to leave a
   * stale `latestCameraTexture` reference in place whenever its preconditions
   * failed (pose=null, no views, no `.camera`, or invalid dimensions).
   * WebXR camera textures are only valid within the frame callback, so
   * reusing a stale reference can crash the native renderer. This helper
   * collapses every precondition failure to a single `null` result so the
   * caller can unconditionally clear the cache above it.
   * @see 2026-02-06-bug-camera-frames-black.md
   */
  it('returns null when pose is null (tracking lost)', () => {
    expect(getXrCameraFromPose(null)).toBeNull();
  });

  it('returns null when pose has no views', () => {
    const pose = { views: [] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns null when the first view has no camera property (camera-access not granted)', () => {
    const pose = { views: [{}] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns null when the camera property has invalid dimensions', () => {
    const pose = {
      views: [{ camera: { width: 0, height: 1080 } }],
    } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns the camera when the first view exposes a valid XRCameraLike', () => {
    const camera = { width: 1920, height: 1080 };
    const pose = { views: [{ camera }] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBe(camera);
  });
});

describe('shouldLogCameraAccessDiagnostic', () => {
  /**
   * Why these tests matter:
   * REGRESSION — if the session's first XR frame arrives with `pose === null`
   * (tracking lost at startup), `getXrCameraFromPose(null)` returns null
   * regardless of whether camera-access was granted. Without the pose gate,
   * the diagnostic would log "camera-access NOT GRANTED" and latch
   * `cameraAccessLoggedOnce = true`, permanently suppressing the correct
   * status once a pose becomes available. Locks in the pose-guarded
   * behaviour of the one-shot diagnostic.
   */
  const validPose = {
    views: [{ camera: { width: 1920, height: 1080 } }],
  } as unknown as XRViewerPose;

  it('returns false when pose is null (avoids false "NOT GRANTED" on tracking-lost startup)', () => {
    expect(shouldLogCameraAccessDiagnostic(null, false, true)).toBe(false);
  });

  it('returns false when already logged (one-shot)', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, true, true)).toBe(false);
  });

  it('returns false when no capture session is active', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, false, false)).toBe(
      false
    );
  });

  it('returns true when pose is available, not yet logged, and capture is active', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, false, true)).toBe(true);
  });
});

/**
 * Scene Hierarchy Tests
 *
 * CRITICAL: These tests verify the AR/GPS coordinate frame separation.
 * See docs/architecture-ar-gps-pose-separation.md for why this matters.
 */
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
   * through createSceneHierarchy(); the constants were un-exported in
   * surface-reduction step 3 because nothing outside the module consumed
   * them), and far is 200 m to cover the reported range. Pinning the values
   * on the constructed camera keeps the F2 regression guard: a silent
   * revert of any constant trips this test. Depth precision stays
   * comfortable: far/near = 2×10⁴ on a 24-bit buffer.
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

describe('isWebXRSupported', () => {
  /**
   * Why this test matters:
   * When navigator.xr is not available, we should return false
   * rather than throwing an error.
   */
  it('returns false when navigator.xr is undefined', async () => {
    // navigator.xr is undefined in jsdom by default
    const result = await isWebXRSupported();
    expect(result).toBe(false);
  });

  /**
   * Why this test matters:
   * Even when navigator.xr exists, if isSessionSupported throws,
   * we should handle gracefully and return false.
   */
  it('returns false when isSessionSupported throws', async () => {
    const mockXR = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('Not supported')),
    };
    vi.stubGlobal('navigator', { xr: mockXR });

    const result = await isWebXRSupported();
    expect(result).toBe(false);

    vi.unstubAllGlobals();
  });

  /**
   * Why this test matters:
   * When WebXR reports immersive-ar is supported, we should return true.
   */
  it('returns true when immersive-ar is supported', async () => {
    const mockXR = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('navigator', { xr: mockXR });

    const result = await isWebXRSupported();
    expect(result).toBe(true);
    expect(mockXR.isSessionSupported).toHaveBeenCalledWith('immersive-ar');

    vi.unstubAllGlobals();
  });
});

describe('module state accessors', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, these accessors should return null
   * rather than throwing errors.
   */
  it('getCurrentArPose returns null before initialization', () => {
    expect(getCurrentArPose()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getScene should return null.
   */
  it('getScene returns null before initialization', () => {
    expect(getScene()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getArWorldGroup should return null.
   */
  it('getArWorldGroup returns null before initialization', () => {
    expect(getArWorldGroup()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getCamera should return null.
   */
  it('getCamera returns null before initialization', () => {
    expect(getCamera()).toBeNull();
  });

  /**
   * Why this test matters: `resetWebXRState()` is the single teardown chokepoint
   * every restart must pass through (initAR throws while a prior session is
   * live). Session-scoped resources that are not per-frame ticks — e.g. the
   * store subscription opened by `enableArWorldGroupAlignment` — register a
   * disposer that this flush must run, or they leak across sessions. This pins
   * the wiring so a future refactor of the teardown can't silently drop it.
   */
  it('resetWebXRState runs (and clears) registered session disposers', () => {
    const dispose = vi.fn();
    registerSessionDisposer(dispose);

    resetWebXRState();
    expect(dispose).toHaveBeenCalledTimes(1);

    // Cleared as it ran: a second teardown must not re-run it.
    resetWebXRState();
    expect(dispose).toHaveBeenCalledTimes(1);

    clearSessionDisposers();
  });
});

describe('applyAlignmentMatrix', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * applyAlignmentMatrix should handle cases where arWorldGroup is not initialized.
   */
  it('does not throw when arWorldGroup is not initialized', () => {
    const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // Should not throw - just logs a warning
    expect(() => applyAlignmentMatrix(identityMatrix)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Invalid matrix length should be rejected.
   */
  it('does not throw with invalid matrix length', () => {
    const shortMatrix = [1, 0, 0, 0];
    expect(() => applyAlignmentMatrix(shortMatrix)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Empty matrix should be handled gracefully.
   */
  it('does not throw with empty matrix', () => {
    expect(() => applyAlignmentMatrix([])).not.toThrow();
  });

  // NOTE: the behavioural applyAlignmentMatrix tests (alignment written to
  // the live arWorldGroup, full-chain WebXR→NUE mapping, replay composition
  // with nuePositionToWebXR) live in webxr-session.alignment.test.ts — they
  // seed the module arWorldGroup through the real initAR() path now that the
  // replay-mode injection setters (setArWorldGroup et al.) are deleted
  // (surface-reduction step 2).
});

describe('nuePositionToWebXR', () => {
  /**
   * Why this test matters:
   * nuePositionToWebXR is the inverse of the WEBXR_TO_NUE transform applied
   * in applyAlignmentMatrix. Replay mode needs this to set arpose in WebXR
   * space so (alignment × W2N) × arpose_WebXR = alignment × odom_NUE.
   */
  it('converts NUE [north, up, east] to WebXR [east, up, -north]', () => {
    const nue = [10, 2, 5]; // north=10, up=2, east=5
    const webxr = nuePositionToWebXR(nue);

    // WebXR: x=east=5, y=up=2, z=south=-north=-10
    expect(webxr[0]).toBe(5);
    expect(webxr[1]).toBe(2);
    expect(webxr[2]).toBe(-10);
  });

  /**
   * Why this test matters:
   * Round-trip: WebXR→NUE (in extractOdomPosition) then NUE→WebXR should
   * recover the original WebXR position.
   */
  it('is the inverse of extractOdomPosition (round-trip)', () => {
    // Simulate extractOdomPosition: WebXR [3, 7, -11] → NUE [11, 7, 3]
    const webxrOriginal = [3, 7, -11];
    const nue = [-(webxrOriginal[2] ?? 0), webxrOriginal[1], webxrOriginal[0]]; // extractOdomPosition logic
    const webxrRecovered = nuePositionToWebXR(nue);

    expect(webxrRecovered[0]).toBeCloseTo(webxrOriginal[0], 10);
    expect(webxrRecovered[1]).toBeCloseTo(webxrOriginal[1], 10);
    expect(webxrRecovered[2]).toBeCloseTo(webxrOriginal[2], 10);
  });

  // NOTE: the replay-composition test ("composes correctly with
  // applyAlignmentMatrix for replay") moved to webxr-session.alignment.test.ts
  // — it needs the module arWorldGroup, which is now only seeded by initAR()
  // (surface-reduction step 2 deleted the injection setters).
});

describe('image capture functions', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * startImageCapture should gracefully handle missing renderer
   */
  it('startImageCapture does not throw when renderer not initialized', () => {
    expect(() => startImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * startImageCapture should gracefully handle a session initialized without
   * the `imageCapture` callbacks group (the slots stay null).
   */
  it('startImageCapture does not throw when callbacks not set', () => {
    // Just test it doesn't throw
    expect(() => startImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * stopImageCapture should be safe to call when not capturing
   */
  it('stopImageCapture does not throw when not capturing', () => {
    expect(() => stopImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * Calling startImageCapture() again while a capture session is already
   * running (e.g. toggling capture settings mid-session) must dispose the
   * previous CameraBlitCapture (and its WebGLRenderTarget GPU memory) and
   * stop the previous ImageCaptureManager — otherwise the module-level
   * `blitCapture`/`imageCaptureManager` references are overwritten, leaking
   * GPU memory and leaving two managers competing over the same callbacks
   * plus a dangling safety timeout.
   *
   * initAR() (which sets the private `renderer`) can't run in jsdom, so we
   * assert on the source of startImageCapture that it stops any in-flight
   * session before allocating new resources — matching the source-inspection
   * pattern used for the resetWebXRState/endARSession cleanup tests above.
   */
  it('startImageCapture stops any in-flight capture before starting a new one', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    const startBlock = source.slice(
      source.indexOf('function startImageCapture'),
      source.indexOf('function stopImageCapture')
    );
    // The guard must check for an existing session and call stopImageCapture()
    // before the new CameraBlitCapture / ImageCaptureManager are constructed.
    const guardIndex = startBlock.indexOf('stopImageCapture()');
    const blitIndex = startBlock.indexOf('new CameraBlitCapture()');
    const managerIndex = startBlock.indexOf('new ImageCaptureManager(');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(blitIndex).toBeGreaterThan(-1);
    expect(managerIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(blitIndex);
    expect(guardIndex).toBeLessThan(managerIndex);
  });

  /**
   * Why this test matters:
   * getImageCaptureFrameCount should return 0 when not capturing
   */
  it('getImageCaptureFrameCount returns 0 when not capturing', () => {
    expect(getImageCaptureFrameCount()).toBe(0);
  });
});

describe('depth capture functions', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * startDepthCapture should gracefully handle missing sampler
   */
  it('startDepthCapture does not throw when sampler not initialized', () => {
    expect(() => startDepthCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * stopDepthCapture should be safe to call when not sampling
   */
  it('stopDepthCapture does not throw when not sampling', () => {
    expect(() => stopDepthCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * getDepthSampleCount should return 0 when not sampling
   */
  it('getDepthSampleCount returns 0 when not sampling', () => {
    expect(getDepthSampleCount()).toBe(0);
  });
});

/**
 * `getDepthInfoFromFrame` is exported so a consumer can feed the live depth
 * occluder from a `registerXrFrameUpdate` callback. These tests pin that it
 * surfaces the widened occluder metadata (`data` / `rawValueToMeters` /
 * `normDepthBufferFromNormView` / `projectionMatrix`) and degrades to `null`
 * exactly when depth is unavailable — so a degraded frame can never feed the
 * occluder stale/garbage depth.
 */
describe('getDepthInfoFromFrame', () => {
  const identity16 = (): Float32Array => {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  };

  it('wraps per-frame XRCPUDepthInformation with the widened occluder fields', () => {
    const projectionMatrix = identity16();
    const pose = {
      views: [{ projectionMatrix } as unknown as XRView],
    } as unknown as XRViewerPose;
    const depthData = new ArrayBuffer(16 * 16 * 2);
    const frame = {
      getDepthInformation: vi.fn(() => ({
        width: 16,
        height: 16,
        getDepthInMeters: () => 1,
        data: depthData,
        rawValueToMeters: 0.001,
        normDepthBufferFromNormView: { matrix: identity16() },
      })),
    } as unknown as XRFrame;

    const info = getDepthInfoFromFrame(frame, pose);
    expect(info).not.toBeNull();
    expect(info!.data).toBe(depthData); // live reference, no clone
    expect(info!.rawValueToMeters).toBe(0.001);
    expect(info!.normDepthBufferFromNormView).toHaveLength(16);
    expect(info!.projectionMatrix).toHaveLength(16);
  });

  it('returns null when there is no pose/view', () => {
    expect(getDepthInfoFromFrame({} as XRFrame, null)).toBeNull();
  });

  it('returns null when the frame has no getDepthInformation', () => {
    const pose = {
      views: [{ projectionMatrix: identity16() } as unknown as XRView],
    } as unknown as XRViewerPose;
    expect(getDepthInfoFromFrame({} as XRFrame, pose)).toBeNull();
  });

  it('returns null when getDepthInformation throws (device hiccup)', () => {
    const pose = {
      views: [{ projectionMatrix: identity16() } as unknown as XRView],
    } as unknown as XRViewerPose;
    const frame = {
      getDepthInformation: vi.fn(() => {
        throw new Error('depth unavailable');
      }),
    } as unknown as XRFrame;
    expect(getDepthInfoFromFrame(frame, pose)).toBeNull();
  });
});

describe('camera frame capture (B2)', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * startCameraFrameCapture must gracefully no-op when the frame source was
   * never created (the `cameraFrame` callbacks group was not passed to
   * initAR), not throw.
   */
  it('startCameraFrameCapture does not throw when source not initialized', () => {
    expect(() => startCameraFrameCapture()).not.toThrow();
    expect(() =>
      startCameraFrameCapture({ intervalMs: 100, captureSize: 256 })
    ).not.toThrow();
  });

  /**
   * Why this test matters:
   * stopCameraFrameCapture must be safe to call when nothing is running (e.g.
   * teardown after a failed start).
   */
  it('stopCameraFrameCapture does not throw when not running', () => {
    expect(() => stopCameraFrameCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * getCameraFrameCount returns 0 when no capture has happened — the default
   * the Recorder/demo read before any frame is delivered.
   */
  it('getCameraFrameCount returns 0 when not capturing', () => {
    expect(getCameraFrameCount()).toBe(0);
  });
});

// NOTE: the getLiveCss3dManager tests that lived here were deleted together
// with the getter (surface-reduction step 3 — zero consumers). They only ever
// observed the getter's null default (initAR never ran in this file, so the
// manager was never non-null) and thus pinned no lifecycle behaviour. The
// CSS3D manager lifecycle is now pinned OBSERVABLY in
// webxr-session.session-end.test.ts: initAR (real path, mocked renderer)
// appends the CSS3D overlay element when `enableCss3dRenderer` is on, and
// session teardown removes it from the DOM.

// ---------------------------------------------------------------------------
// extractResetTransformData — distinguishes missing vs null vs present
// ---------------------------------------------------------------------------

describe('extractResetTransformData', () => {
  /**
   * Why this test matters:
   * When the XRReferenceSpaceEvent.transform property is present and contains
   * valid position/orientation data, the function must extract and return it
   * as a ResetTransformData object.
   */
  it('returns extracted data when transform is present with valid data', () => {
    const event = {
      transform: {
        position: { x: 0.5, y: 0, z: -0.3 },
        orientation: { x: 0, y: 0.1, z: 0, w: 0.995 },
      },
    };

    const result = extractResetTransformData(event);

    expect(result).toEqual({
      position: [0.5, 0, -0.3],
      orientation: [0, 0.1, 0, 0.995],
    });
  });

  /**
   * Why this test matters:
   * When the transform property exists but is null, the runtime could not
   * determine the delta between old and new coordinate systems. This must
   * return null (not undefined) to match OdometryTrackingRestartedPayload
   * semantics: null = "runtime explicitly could not determine the delta".
   */
  it('returns null when transform property exists but is null', () => {
    const event = { transform: null };

    const result = extractResetTransformData(event);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * When the transform property does not exist on the event (older browsers),
   * the function must return undefined to match OdometryTrackingRestartedPayload
   * semantics: undefined = "the reset event did not provide a transform".
   * This is the key distinction the junior dev's comment identified.
   */
  it('returns undefined when transform property is missing (older browsers)', () => {
    const event = {};

    const result = extractResetTransformData(event);

    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * Ensures null and undefined cases are not conflated. Both falsy, but
   * carry different diagnostic meaning in OdometryTrackingRestartedPayload.
   */
  it('distinguishes null transform from missing transform', () => {
    const nullTransformResult = extractResetTransformData({ transform: null });
    const missingTransformResult = extractResetTransformData({});

    expect(nullTransformResult).toBeNull();
    expect(missingTransformResult).toBeUndefined();
    expect(nullTransformResult).not.toBe(missingTransformResult);
  });
});

// ---------------------------------------------------------------------------
// DOM hardcoding audit — regression tests
// ---------------------------------------------------------------------------

describe('DOM hardcoding audit regressions', () => {
  /**
   * Why this test matters:
   * The renderer canvas must not have a hardcoded ID like 'ar-canvas'.
   * Hardcoded IDs are leaky abstractions: HTML IDs must be unique, and
   * multiple framework instances or host-app collisions would break.
   * The caller owns the container and can set attributes if needed.
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 1.
   */
  it('initAR does not assign a hardcoded id to the renderer canvas', async () => {
    // We cannot call initAR in jsdom (no WebXR), so we verify that the
    // source code no longer contains the hardcoded ID assignment.
    // This is a "grep-style" regression guard.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sourcePath = resolve(process.cwd(), 'src/ar/webxr-session.ts');
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toContain("domElement.id = 'ar-canvas'");
    expect(source).not.toContain('domElement.id = "ar-canvas"');
  });

  /**
   * Why this test matters:
   * resetWebXRState must stop the animation loop, remove the canvas from
   * the DOM, and dispose the renderer to avoid orphaned <canvas> elements
   * and leaked WebGL contexts (matching disposeReplayScene pattern).
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 11 (P2).
   */
  it('resetWebXRState disposes renderer and removes canvas from DOM', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    // The resetWebXRState function must call setAnimationLoop(null),
    // renderer.dispose(), and remove the domElement before dropping the
    // reference. Stage 3 of the ArSession refactor replaced the field-by-field
    // "renderer = null" reset with the wholesale handle replacement, so the
    // slice now ends at that replacement line — assertions unchanged.
    const resetBlock = source.slice(
      source.indexOf('function resetWebXRState'),
      source.indexOf('activeSession = defaultArSessionHandle();')
    );
    expect(resetBlock).toContain('setAnimationLoop(null)');
    expect(resetBlock).toContain('renderer.dispose()');
    expect(resetBlock).toContain('removeChild(renderer.domElement)');
  });

  /**
   * Why this test matters:
   * endARSession is the production teardown path. It must perform the same
   * thorough cleanup as resetWebXRState() — ending the XR session AND
   * clearing every module-level reference — so no state leaks into the
   * next session. Asserting it delegates to resetWebXRState() (rather than
   * re-implementing a subset of the teardown inline) guards against the
   * leak class where new module state is added to resetWebXRState() but
   * forgotten in endARSession().
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 11 (P2).
   */
  it('endARSession ends the XR session and delegates teardown to resetWebXRState', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    const endBlock = source.slice(
      source.indexOf('function endARSession'),
      source.indexOf('function startImageCapture')
    );
    // Must still end the actual XR session — resetWebXRState() only nulls
    // the reference, it never calls XRSession.end().
    expect(endBlock).toContain('xrSession.end()');
    // Must reuse the comprehensive synchronous teardown rather than
    // re-implementing a subset of it.
    expect(endBlock).toContain('resetWebXRState()');
  });

  // NOTE: the behavioural leak proof ("endARSession clears scene-graph
  // references") used to seed the module refs through the replay-mode
  // injection setters, which were deleted (surface-reduction step 2). The
  // same leak class is now pinned through the real initAR() path: the
  // session-end tests (webxr-session.session-end.test.ts) assert
  // getScene()/getCamera()/getArWorldGroup() are null after both end paths.

  /**
   * Why this test matters:
   * endARSession must not throw when called before initAR.
   * This is a defensive check for the production cleanup path.
   */
  it('endARSession does not throw when not initialized', async () => {
    resetWebXRState();
    await expect(endARSession()).resolves.toBeUndefined();
  });

  it('initAR only creates CSS3D renderer when enableCss3dRenderer is true', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );

    // Stage 0 of the ArSession refactor moved the isolation options onto the
    // per-session handle (`activeSession.crashIsolation`) — the assertion pins
    // the same gate, at its new spelling.
    expect(source).toContain(
      'if (activeSession.crashIsolation.enableCss3dRenderer)'
    );
    expect(source).toContain('createCss3dRendererManager');
  });

  it('onXRFrame gates camera texture acquisition and CSS3D render on the isolation flags', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );

    // Same Stage 0 handle move as above — gates unchanged, spelling updated.
    // (Stage 3 moved the CSS3D manager onto the handle's scene-graph cluster,
    // read via a `css3d` destructure in onXRFrame.)
    expect(source).toContain(
      'if (activeSession.crashIsolation.enableCameraTextureAcquisition)'
    );
    expect(source).toContain(
      'if (activeSession.crashIsolation.enableCss3dRenderer && css3d)'
    );
  });
});

describe('camera-frame capture-size default (WS-C on-device sweep)', () => {
  /**
   * Why this test matters: the camera-frame blit resolution is the QR-detection
   * lever. The on-device sweep (2026-06-17, `?capture=`) showed 512 only decoded
   * a small/out-of-focus QR at very close range, while 1024 decoded it reliably
   * with no perceptible cadence cost. This locks the tuned default so a silent
   * revert to 512 (which reintroduces the "must move very close" symptom) trips a
   * test rather than shipping. See the QR-size-accuracy plan WS-C.
   */
  it('defaults the long-edge blit to 1024 px', () => {
    expect(DEFAULT_CAMERA_FRAME_CAPTURE_SIZE).toBe(1024);
  });

  // NOTE: the companion test "resetWebXRState restores the live capture size
  // to the tuned default" was deleted with the getCameraFrameCaptureSize()
  // getter (surface-reduction step 3 — zero consumers). It could never fail:
  // a non-default size is only settable via startCameraFrameCapture() on a
  // LIVE cameraFrameSource, which this jsdom file cannot create, so the test
  // asserted default-in/default-out. The reset of the internal slot is one of
  // the ~30 resets pinned collectively by the session-end teardown tests.
});
