/**
 * Camera-frame delivery through the real `initAR` frame loop (QR perf plan
 * 2026-09-23, M4 review finding 1).
 *
 * Why these tests matter: M4's whole claim is that a delivered
 * `CapturedCameraFrame` carries the camera pose of the SAME XR frame whose
 * camera image was blitted. The controllers only pass that pose through, so
 * the session is the one place the pairing can go wrong - and before this file
 * nothing drove it: a change that let the capture read an older pose (the
 * session keeps a "latest non-null pose" for other consumers) would have
 * paired pixels with the wrong moment silently.
 *
 * Isolated like webxr-session.callbacks.test.ts: WebGLRenderer, the camera
 * texture acquisition and the blit are mocked; `onXRFrame` is taken from the
 * mocked `renderer.setAnimationLoop` and driven with hand-made XR frames.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

const hoisted = vi.hoisted(() => ({
  referenceSpace: { kind: 'local-floor' },
  renderers: [] as { setAnimationLoop: { mock: { calls: unknown[][] } } }[],
}));

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
      getReferenceSpace: vi.fn(() => hoisted.referenceSpace),
    };
    constructor() {
      hoisted.renderers.push(this);
    }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

vi.mock('./xr-camera-texture', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    acquireCameraTexture: vi.fn(() => ({
      texture: { isTexture: true },
      width: 4,
      height: 4,
    })),
  };
});

vi.mock('./camera-blit-capture', async (importOriginal) => {
  const actual = await importOriginal<object>();
  class FakeBlit {
    resizeIfNeeded = vi.fn();
    dispose = vi.fn();
    captureToRgba(
      _renderer: unknown,
      _texture: unknown,
      onTiming?: (t: { blitReadbackMs: number }) => void
    ) {
      onTiming?.({ blitReadbackMs: 1 });
      return { data: new Uint8ClampedArray(4 * 3 * 4), width: 4, height: 3 };
    }
  }
  return { ...actual, CameraBlitCapture: FakeBlit };
});

import {
  initAR,
  resetWebXRState,
  startCameraFrameCapture,
} from './webxr-session.js';
import type { CapturedCameraFrame } from './captured-camera-frame.js';

type FrameLoop = (time: number, frame: unknown) => void;

/** An XR frame whose single view sits at x = `x` (null = no viewer pose). */
function xrFrame(x: number | null) {
  return {
    getViewerPose: () =>
      x === null
        ? null
        : {
            views: [
              {
                transform: {
                  position: { x, y: 1.5, z: -2 },
                  orientation: { x: 0, y: 0, z: 0, w: 1 },
                },
                camera: { width: 4, height: 4 },
              },
            ],
          },
  };
}

describe('initAR camera-frame delivery', () => {
  let container: HTMLDivElement;
  let loop: FrameLoop;
  let delivered: CapturedCameraFrame[];

  beforeEach(async () => {
    resetWebXRState();
    hoisted.renderers.length = 0;
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
    delivered = [];
    await initAR(
      container,
      {
        enableDomOverlay: false,
        enableCameraAccess: true,
        enableDepthSensingFeature: false,
        enableCss3dRenderer: false,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: false,
      },
      {},
      { cameraFrame: { onFrame: (frame) => delivered.push(frame) } }
    );
    const renderer = hoisted.renderers.at(-1);
    loop = renderer?.setAnimationLoop.mock.calls[0]?.[0] as FrameLoop;
    startCameraFrameCapture({ intervalMs: 100 });
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  it('pairs each delivered frame with the pose and time of the XR frame it was captured in', () => {
    expect(typeof loop).toBe('function');
    loop(1000, xrFrame(1));
    loop(1050, xrFrame(2)); // inside the interval: no capture
    loop(1200, xrFrame(3));
    expect(delivered.map((f) => f.cameraPose.position[0])).toEqual([1, 3]);
    expect(delivered[0]!.capturedAtMs).toBe(performance.timeOrigin + 1000);
    expect(delivered[1]!.capturedAtMs).toBe(performance.timeOrigin + 1200);
  });

  it('delivers nothing for a tick without a viewer pose, even though an older pose exists', () => {
    loop(1000, xrFrame(1)); // captured, and leaves a "latest pose" behind
    loop(1200, xrFrame(null)); // due, but this tick has no pose
    expect(delivered.map((f) => f.cameraPose.position[0])).toEqual([1]);
  });

  /**
   * Why this test matters (summary follow-up 6): the consumer hooks travel
   * through `startCameraFrameCapture` into the source and the blit. Dropping
   * one in that plumbing would pass every unit test of the parts, and a hook
   * that outlived its capture run would veto or time the next consumer's frames.
   */
  it('applies wantsFrame and onCaptureTiming per start, and resets both on the next start', () => {
    const timings: unknown[] = [];
    let wanted = false;
    startCameraFrameCapture({
      intervalMs: 100,
      wantsFrame: () => wanted,
      onCaptureTiming: (t) => timings.push(t),
    });
    loop(1000, xrFrame(1)); // vetoed: no blit, no frame, no timing
    expect(delivered).toEqual([]);
    expect(timings).toEqual([]);
    wanted = true;
    loop(1016, xrFrame(2)); // veto lifted: captured at once, timed
    expect(delivered.map((f) => f.cameraPose.position[0])).toEqual([2]);
    expect(timings).toHaveLength(1);

    startCameraFrameCapture({ intervalMs: 100 }); // no hooks this time
    wanted = false; // the old veto must no longer apply
    loop(2000, xrFrame(3));
    expect(delivered.map((f) => f.cameraPose.position[0])).toEqual([2, 3]);
    expect(timings).toHaveLength(1); // the old timing hook is gone too
  });
});
