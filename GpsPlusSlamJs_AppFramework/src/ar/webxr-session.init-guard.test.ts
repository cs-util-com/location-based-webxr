/**
 * Re-entry guard tests for initAR().
 *
 * Why these tests matter:
 * initAR() creates a THREE.WebGLRenderer and inserts its canvas into the
 * host container, then overwrites the module-level renderer/scene/camera
 * references. Without a guard, a second call while a session is still
 * active would orphan the previous renderer's canvas in the DOM and leak
 * its GPU resources while silently clobbering the live references. These
 * tests prove the guard throws on re-entry and leaves the first session's
 * state intact.
 *
 * This file is isolated from webxr-session.test.ts because it mocks
 * THREE.WebGLRenderer and navigator.xr — the rest of the suite relies on
 * the real THREE classes and an absent navigator.xr.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

// Mock only WebGLRenderer (jsdom has no WebGL context). Spreading `...actual`
// keeps every other THREE export real so the scene hierarchy built by
// createSceneHierarchy() behaves normally.
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
  getScene,
  endARSession,
} from './webxr-session.js';

// Isolation options that avoid the CSS3D renderer / DOM overlay paths so the
// guard test exercises the minimal renderer+session setup.
const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

describe('initAR re-entry guard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
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
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  /**
   * Why this test matters: a second initAR() while the first session is
   * still active must be rejected rather than silently leaking the previous
   * renderer/canvas.
   */
  it('throws when called again before endARSession()', async () => {
    await initAR(container, MINIMAL_ISOLATION);

    await expect(initAR(container, MINIMAL_ISOLATION)).rejects.toThrow(
      /already initialized/i
    );
  });

  /**
   * Why this test matters: the guard must fire before any new renderer is
   * constructed, so the host container keeps exactly one canvas and the
   * first session's scene reference is untouched.
   */
  it('does not orphan a canvas or overwrite module state on re-entry', async () => {
    await initAR(container, MINIMAL_ISOLATION);
    const sceneAfterFirst = getScene();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);

    await expect(initAR(container, MINIMAL_ISOLATION)).rejects.toThrow();

    // No second canvas was inserted and the live scene is unchanged.
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(getScene()).toBe(sceneAfterFirst);
  });

  /**
   * Why this test matters: after a clean teardown the guard must release,
   * allowing a fresh session to start (the legacy
   * resetWebXRState()-then-initAR() cycle).
   */
  it('allows a new session after resetWebXRState()', async () => {
    await initAR(container, MINIMAL_ISOLATION);
    resetWebXRState();

    await expect(initAR(container, MINIMAL_ISOLATION)).resolves.toBeUndefined();
  });

  /**
   * Why this test matters: XRSession.end() can reject (e.g. the session is
   * already ended or in an invalid state). endARSession() wraps the
   * end()/teardown pair in try/finally so resetWebXRState() always runs.
   * Without the `finally`, a rejecting end() would leave renderer/xrSession
   * non-null and the initAR() re-entry guard would permanently reject every
   * subsequent session until a page reload. This proves a fresh session can
   * still be started after a failed teardown.
   */
  it('still tears down (allowing a new session) when xrSession.end() rejects', async () => {
    const failingSession = {
      addEventListener: vi.fn(),
      end: vi.fn().mockRejectedValue(new Error('session already ended')),
    };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue(failingSession),
      },
    });

    await initAR(container, MINIMAL_ISOLATION);

    // The teardown awaits the rejecting end(), so endARSession() rejects…
    await expect(endARSession()).rejects.toThrow(/already ended/i);

    // …but resetWebXRState() still ran in the `finally`, so the re-entry
    // guard has released and a new session can initialize.
    await expect(initAR(container, MINIMAL_ISOLATION)).resolves.toBeUndefined();
  });

  /**
   * Why this test matters: initAR() builds the renderer and inserts its
   * canvas BEFORE it asks for the XR session, and requestSession() rejects
   * whenever the user declines the AR/camera permission prompt. The
   * half-built session used to stay behind, so every retry hit the re-entry
   * guard ("AR session already initialized") until a page reload - the Tour
   * Viewer's "Try again" (owner report 2026-10-07), and earlier OsmDemo and
   * AnchorStarter, which each patched around it. A failed initAR() leaves
   * nothing behind: the retry starts cleanly, and no stray canvas remains.
   */
  it('leaves nothing behind when the session request is declined, so a retry starts cleanly', async () => {
    const declined = new Error('The user denied permission');
    const requestSession = vi
      .fn()
      .mockRejectedValueOnce(declined)
      .mockResolvedValue({
        addEventListener: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
      });
    vi.stubGlobal('navigator', { xr: { requestSession } });

    await expect(initAR(container, MINIMAL_ISOLATION)).rejects.toBe(declined);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);

    await expect(initAR(container, MINIMAL_ISOLATION)).resolves.toBeUndefined();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });
});

describe('initAR Chromium workaround wiring (quality-review G-7)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue({
          addEventListener: vi.fn(),
          end: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  /** Minimal XRWebGLBinding stand-in whose prototype carries the method the
   *  workaround deletes. */
  function stubBindingWithProjectionLayer(): { prototype: object } {
    class FakeXRWebGLBinding {
      createProjectionLayer(): void {}
    }
    vi.stubGlobal('XRWebGLBinding', FakeXRWebGLBinding);
    return FakeXRWebGLBinding;
  }

  it('applies the workaround by default (forgetting the manual call no longer crashes the tab)', async () => {
    // Why: every app entry point used to have to remember a manual
    // applyChromiumProjectionLayerWorkaround() bootstrap call — forgetting it
    // crashed the Chrome tab. initAR now applies it via the (default-true)
    // isolation option.
    const binding = stubBindingWithProjectionLayer();
    expect('createProjectionLayer' in binding.prototype).toBe(true);

    await initAR(container, {
      enableDomOverlay: false,
      enableCss3dRenderer: false,
      enableCameraTextureAcquisition: false,
    });

    expect('createProjectionLayer' in binding.prototype).toBe(false);
  });

  it('honors the opt-out for unaffected devices', async () => {
    const binding = stubBindingWithProjectionLayer();

    await initAR(container, MINIMAL_ISOLATION);

    // MINIMAL_ISOLATION sets applyChromiumProjectionLayerWorkaround: false —
    // the prototype must stay untouched (e.g. Quest devices where forcing
    // XRWebGLLayer could regress WebXR).
    expect('createProjectionLayer' in binding.prototype).toBe(true);
  });
});
