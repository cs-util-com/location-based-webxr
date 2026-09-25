/**
 * `getXrSession()` / `getXrReferenceSpace()` accessor tests.
 *
 * Why these exist: a host app that raycasts along a WebXR input source's
 * target ray needs both the live `XRSession` (to listen for `select`) and the
 * reference space poses are expressed in. Every other session handle
 * (`getScene`, `getCamera`, `getArWorldGroup`) was already reachable; these
 * two were not, so an app either could not implement WebXR tap-picking at all
 * or had to request its OWN `local-floor` space — which is not guaranteed to
 * agree with the one three.js installed on the renderer (it may be an offset
 * space), producing a subtly mis-aimed ray.
 *
 * The reference space is read through `renderer.xr.getReferenceSpace()` — the
 * same source `onXRFrame` uses for the viewer pose — so a caller's ray and the
 * framework's own pose math are always in one frame.
 *
 * Mirrors webxr-session.session-end.test.ts's isolation (mocked
 * THREE.WebGLRenderer + navigator.xr).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

const mockReferenceSpace = { __brand: 'reference-space' };

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
      getReferenceSpace: vi.fn().mockReturnValue(mockReferenceSpace),
    };
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import {
  initAR,
  endARSession,
  resetWebXRState,
  getXrSession,
  getXrReferenceSpace,
} from './webxr-session.js';

const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

describe('getXrSession / getXrReferenceSpace', () => {
  let container: HTMLDivElement;
  let capturedEndListener: (() => void) | null;
  let mockSession: { addEventListener: unknown; end: unknown };

  beforeEach(() => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedEndListener = null;

    mockSession = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'end') {
          capturedEndListener = listener;
        }
      }),
      end: vi.fn().mockImplementation(() => {
        capturedEndListener?.();
        return Promise.resolve();
      }),
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

  it('both return null before a session exists', () => {
    expect(getXrSession()).toBeNull();
    expect(getXrReferenceSpace()).toBeNull();
  });

  it('expose the live session and the renderer reference space during a session', async () => {
    await initAR(container, MINIMAL_ISOLATION, {}, {});

    expect(getXrSession()).toBe(mockSession);
    expect(getXrReferenceSpace()).toBe(mockReferenceSpace);
  });

  it('both return null again after the session ends', async () => {
    await initAR(container, MINIMAL_ISOLATION, {}, {});
    await endARSession();

    expect(getXrSession()).toBeNull();
    expect(getXrReferenceSpace()).toBeNull();
  });

  it('both return null after resetWebXRState()', async () => {
    await initAR(container, MINIMAL_ISOLATION, {}, {});
    resetWebXRState();

    expect(getXrSession()).toBeNull();
    expect(getXrReferenceSpace()).toBeNull();
  });
});
