/**
 * QR's camera frames do not depend on any other consumer, whatever the
 * cadences, busy times and lost poses.
 *
 * Why this test matters: the unit test pins one scripted session. QR's
 * cadence, its busy veto and a second consumer's interact only through the
 * shared frame loop, and an ordering slip (the matcher captured first and
 * changed something QR reads) would show only for some timing mixes. Over
 * random mixes, QR's delivered frames (pose and time) must be identical with
 * and without a matcher registered.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
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
      width: 640,
      height: 480,
    })),
  };
});

vi.mock('./camera-blit-capture', async (importOriginal) => {
  const actual = await importOriginal<object>();
  class FakeBlit {
    resizeIfNeeded = vi.fn();
    dispose = vi.fn();
    captureToRgba() {
      return { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    }
  }
  return { ...actual, CameraBlitCapture: FakeBlit };
});

import {
  initAR,
  registerCameraFrameConsumer,
  resetWebXRState,
  startCameraFrameCapture,
  getCameraFrameCount,
} from './webxr-session.js';

type FrameLoop = (time: number, frame: unknown) => void;

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
                camera: { width: 640, height: 480 },
              },
            ],
          },
  };
}

interface Script {
  qrIntervalMs: number;
  qrBusyMs: number;
  matcherIntervalMs: number;
  matcherBusyMs: number;
  poseLossEvery: number;
  jitterMs: number;
}

async function run(script: Script, withMatcher: boolean) {
  resetWebXRState();
  hoisted.renderers.length = 0;
  vi.stubGlobal('navigator', {
    xr: {
      requestSession: vi.fn().mockResolvedValue({
        addEventListener: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
      }),
    },
  });
  const qr: [number, number][] = [];
  await initAR(
    document.body.appendChild(document.createElement('div')),
    {
      enableDomOverlay: false,
      enableCameraAccess: true,
      enableDepthSensingFeature: false,
      enableCss3dRenderer: false,
      enableCameraTextureAcquisition: true,
      applyChromiumProjectionLayerWorkaround: false,
    },
    {},
    {
      cameraFrame: {
        onFrame: (f) => qr.push([f.cameraPose.position[0], f.capturedAtMs]),
      },
    }
  );
  const loop = hoisted.renderers.at(-1)!.setAnimationLoop.mock
    .calls[0]![0] as FrameLoop;
  let now = 0;
  let qrBusyUntil = -Infinity;
  startCameraFrameCapture({
    intervalMs: script.qrIntervalMs,
    wantsFrame: () => now >= qrBusyUntil,
  });
  let matcherFrames = 0;
  if (withMatcher) {
    let busyUntil = -Infinity;
    registerCameraFrameConsumer({
      intervalMs: script.matcherIntervalMs,
      captureSize: 480,
      wantsFrame: () => now >= busyUntil,
      onFrame: () => {
        matcherFrames++;
        busyUntil = now + script.matcherBusyMs;
      },
    });
  }
  for (let i = 0; i < 240; i++) {
    now = i * 16.7 + ((i * 13) % 7) * (script.jitterMs / 7);
    const before = qr.length;
    loop(now, xrFrame(i % script.poseLossEvery === 3 ? null : i));
    if (qr.length > before) qrBusyUntil = now + script.qrBusyMs;
  }
  return { qr, captures: getCameraFrameCount(), matcherFrames };
}

describe('registerCameraFrameConsumer (property)', () => {
  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it("never changes QR's delivered frames", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          qrIntervalMs: fc.integer({ min: 50, max: 250 }),
          qrBusyMs: fc.integer({ min: 0, max: 400 }),
          matcherIntervalMs: fc.integer({ min: 100, max: 600 }),
          matcherBusyMs: fc.integer({ min: 0, max: 1000 }),
          poseLossEvery: fc.integer({ min: 5, max: 60 }),
          jitterMs: fc.integer({ min: 0, max: 6 }),
        }),
        async (script) => {
          const without = await run(script, false);
          const withM = await run(script, true);
          expect(withM.matcherFrames).toBeGreaterThan(0);
          expect(withM.captures).toBe(without.captures);
          expect(withM.qr).toEqual(without.qr);
        }
      ),
      { numRuns: 40, seed: 5 }
    );
  });
});
