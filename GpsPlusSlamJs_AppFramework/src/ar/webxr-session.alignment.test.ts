/**
 * applyAlignmentMatrix behavioural tests (module arWorldGroup path).
 *
 * Why these tests matter:
 * `applyAlignmentMatrix()` writes the alignment directly to the LIVE
 * session's `arWorldGroup.matrix` (no WEBXR_TO_NUE composition — that basis
 * change lives permanently in basisChangeNode). These tests pin:
 *  - the matrix is written verbatim (identity stays exact identity),
 *  - the full chain `arWorldGroup × basisChangeNode` maps WebXR coordinates
 *    to NUE (north/east) correctly,
 *  - `nueToWebXR()` round-trips through that chain (the conversion
 *    replay uses when writing recorded odom poses to its own arpose node).
 *
 * They seed the module `arWorldGroup` through the REAL `initAR()` path
 * (mocked WebGLRenderer + navigator.xr — same pattern as
 * `webxr-session.session-end.test.ts`). Historically they injected a group
 * via the replay-mode `setArWorldGroup()` export, which was deleted by the
 * 2026-07-11 webxr-session surface-reduction plan, step 2 (replay owns its
 * scene in `replay-scene.ts` and no longer touches this module).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// Mock only WebGLRenderer (jsdom has no WebGL context). Spreading `...actual`
// keeps every other THREE export real.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    setAnimationLoop = vi.fn();
    xr = {
      enabled: false,
      setSession: vi.fn().mockResolvedValue(undefined),
      getReferenceSpace: vi.fn().mockReturnValue(null),
    };
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import {
  initAR,
  resetWebXRState,
  getArWorldGroup,
  applyAlignmentMatrix,
} from './webxr-session.js';
import { nueToWebXR } from 'gps-plus-slam-js';
import { SCENE_NODE } from './scene-node-names.js';

const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('applyAlignmentMatrix (live arWorldGroup via initAR)', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);

    const mockSession = {
      addEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
    });

    await initAR(container, MINIMAL_ISOLATION);
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  /** Compose arWorldGroup.matrix × basisChangeNode.matrix for chain checks. */
  function fullChain(arWorldGroup: THREE.Group): THREE.Matrix4 {
    const basisChangeNode = arWorldGroup.getObjectByName(
      SCENE_NODE.BASIS_CHANGE
    )!;
    return new THREE.Matrix4().multiplyMatrices(
      arWorldGroup.matrix,
      basisChangeNode.matrix
    );
  }

  /**
   * Why this test matters:
   * applyAlignmentMatrix sets arWorldGroup.matrix to the alignment only
   * (no WEBXR_TO_NUE composition). WEBXR_TO_NUE lives permanently in
   * basisChangeNode. This confirms the simplified implementation.
   */
  it('sets arWorldGroup.matrix to alignment only (not composed with WEBXR_TO_NUE)', () => {
    const arWorldGroup = getArWorldGroup()!;

    applyAlignmentMatrix(IDENTITY);

    // arWorldGroup.matrix must be exact identity — no WEBXR_TO_NUE folded in
    const el = arWorldGroup.matrix.elements;
    expect(el[0]).toBeCloseTo(1, 10); // diagonal
    expect(el[5]).toBeCloseTo(1, 10);
    expect(el[10]).toBeCloseTo(1, 10);
    expect(el[15]).toBeCloseTo(1, 10);
    expect(el[1]).toBeCloseTo(0, 10); // off-diagonal
    expect(el[2]).toBeCloseTo(0, 10);
    expect(el[4]).toBeCloseTo(0, 10);
    expect(el[8]).toBeCloseTo(0, 10);
  });

  /**
   * Why this test matters:
   * The full chain arWorldGroup × basisChangeNode must still map a WebXR
   * north position (z=-10) to NUE north (x=10). This verifies that moving
   * WEBXR_TO_NUE into the scene graph preserves the correct camera mapping.
   */
  it('full chain (arWorldGroup × basisChangeNode) maps WebXR north to NUE north', () => {
    const arWorldGroup = getArWorldGroup()!;
    applyAlignmentMatrix(IDENTITY);

    // WebXR: x=0 (no east), y=0 (ground), z=-10 (north = -Z in WebXR)
    const webxrPos = new THREE.Vector4(0, 0, -10, 1);
    const result = webxrPos.applyMatrix4(fullChain(arWorldGroup));

    // Expected NUE: x=10 (north), y=0, z=0 (no east)
    expect(result.x).toBeCloseTo(10, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(0, 5);
  });

  /**
   * Why this test matters:
   * Walking east in WebXR (x increases) must still produce NUE Z increase
   * (east) through the full chain, confirming end-to-end correctness.
   */
  it('full chain (arWorldGroup × basisChangeNode) maps WebXR east to NUE Z-east', () => {
    const arWorldGroup = getArWorldGroup()!;
    applyAlignmentMatrix(IDENTITY);

    const webxrPos = new THREE.Vector4(5, 0, 0, 1);
    const result = webxrPos.applyMatrix4(fullChain(arWorldGroup));

    // WebXR x=5 (east) → NUE z=5 (east)
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(5, 5);
  });

  /**
   * Why this test matters:
   * Verifies that applying the composed arWorldGroup matrix to a round-tripped
   * WebXR position yields the same result as directly applying alignment to
   * NUE — the conversion replay relies on when writing recorded odom
   * positions (NUE) to its arpose node (WebXR-local, below basisChangeNode).
   */
  it('nueToWebXR composes correctly with applyAlignmentMatrix for replay', () => {
    const arWorldGroup = getArWorldGroup()!;
    applyAlignmentMatrix(IDENTITY);

    // odomPosition in NUE: north=10, up=0, east=5
    const odomNUE = [10, 0, 5] as const;
    // Convert to WebXR for arpose (arpose lives in WebXR space below basisChangeNode)
    const webxrPos = nueToWebXR(odomNUE);
    const v = new THREE.Vector4(webxrPos[0], webxrPos[1], webxrPos[2], 1);
    v.applyMatrix4(fullChain(arWorldGroup));

    // Should recover NUE position
    expect(v.x).toBeCloseTo(odomNUE[0], 5);
    expect(v.y).toBeCloseTo(odomNUE[1], 5);
    expect(v.z).toBeCloseTo(odomNUE[2], 5);
  });
});
