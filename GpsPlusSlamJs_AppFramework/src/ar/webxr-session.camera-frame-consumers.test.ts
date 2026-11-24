/**
 * Extra camera-frame consumers beside QR (`registerCameraFrameConsumer`).
 *
 * Why these tests matter: an image matcher needs camera frames at its own
 * cadence, its own size and with its own busy veto, while QR keeps running.
 * QR is tuned (cadence, veto, 1024 px) and recorded; a second consumer must
 * not move a single one of its captures, and must get its own buffer, since
 * a buffer transferred to a worker is detached for everyone holding it.
 *
 * Isolated like webxr-session.camera-frame.test.ts: WebGLRenderer, the camera
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
  blits: [] as {
    size: { width: number; height: number };
    disposed: number;
  }[],
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
    private readonly rec: (typeof hoisted.blits)[number];
    constructor(size: { width: number; height: number }) {
      this.rec = { size: { ...size }, disposed: 0 };
      hoisted.blits.push(this.rec);
    }
    resizeIfNeeded(width: number, height: number) {
      this.rec.size = { width, height };
    }
    dispose() {
      this.rec.disposed++;
    }
    captureToRgba() {
      const { width, height } = this.rec.size;
      return { data: new Uint8ClampedArray(4 * width * height), width, height };
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
                camera: { width: 640, height: 480 },
              },
            ],
          },
  };
}

async function startSession(qr: CapturedCameraFrame[]): Promise<FrameLoop> {
  resetWebXRState();
  hoisted.renderers.length = 0;
  hoisted.blits.length = 0;
  vi.stubGlobal('navigator', {
    xr: {
      requestSession: vi.fn().mockResolvedValue({
        addEventListener: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
      }),
    },
  });
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
    { cameraFrame: { onFrame: (frame) => qr.push(frame) } }
  );
  return hoisted.renderers.at(-1)!.setAnimationLoop.mock
    .calls[0]![0] as FrameLoop;
}

/**
 * A scripted session: 60 fps with jitter, a lost pose now and then, QR with a
 * detector that stays busy 180 ms per frame, and optionally a matcher at
 * 300 ms whose worker stays busy 270 ms per frame.
 */
async function scriptedSession(withMatcher: boolean) {
  const qr: CapturedCameraFrame[] = [];
  const loop = await startSession(qr);
  let now = 0;
  let qrBusyUntil = -Infinity;
  let qrDetects = 0;
  startCameraFrameCapture({
    intervalMs: 125,
    wantsFrame: () => now >= qrBusyUntil,
  });
  const matcher: CapturedCameraFrame[] = [];
  if (withMatcher) {
    let busyUntil = -Infinity;
    registerCameraFrameConsumer({
      intervalMs: 300,
      captureSize: 480,
      wantsFrame: () => now >= busyUntil,
      onFrame: (f) => {
        matcher.push(f);
        busyUntil = now + 270;
      },
    });
  }
  for (let i = 0; i < 600; i++) {
    now = i * 16.7 + ((i * 7) % 5);
    const before = qr.length;
    loop(now, xrFrame(i % 37 === 5 ? null : i));
    if (qr.length > before) {
      qrDetects++;
      qrBusyUntil = now + 180;
    }
  }
  return {
    qr: qr.map((f) => [f.cameraPose.position[0], f.capturedAtMs]),
    captures: getCameraFrameCount(),
    qrDetects,
    matcher,
  };
}

describe('registerCameraFrameConsumer', () => {
  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  // Why: the plan's acceptance test. QR's captures and detects must be the
  // same frames with or without the matcher, or QR tuning silently shifts.
  it('leaves QR capture and detect counts unchanged', async () => {
    const without = await scriptedSession(false);
    const withM = await scriptedSession(true);
    expect(withM.matcher.length).toBeGreaterThan(10); // the matcher did run
    expect(withM.captures).toBe(without.captures);
    expect(withM.qrDetects).toBe(without.qrDetects);
    expect(withM.qr).toEqual(without.qr);
  });

  describe('in a running session', () => {
    let loop: FrameLoop;
    let qr: CapturedCameraFrame[];

    beforeEach(async () => {
      qr = [];
      loop = await startSession(qr);
      startCameraFrameCapture({ intervalMs: 100 });
    });

    // Why: a worker detaches the buffer it is handed, so each consumer needs
    // its own blit; both read the same camera image and pose of the frame.
    it('gives the consumer its own blit at its own size, same frame and pose', () => {
      const matcher: CapturedCameraFrame[] = [];
      registerCameraFrameConsumer({
        captureSize: 480,
        onFrame: (f) => matcher.push(f),
      });
      loop(1000, xrFrame(1));
      expect(qr).toHaveLength(1);
      expect(matcher).toHaveLength(1);
      expect([qr[0]!.image.width, qr[0]!.image.height]).toEqual([1024, 768]);
      expect([matcher[0]!.image.width, matcher[0]!.image.height]).toEqual([
        480, 360,
      ]);
      expect(matcher[0]!.image.data).not.toBe(qr[0]!.image.data);
      expect(matcher[0]!.cameraPose).toEqual(qr[0]!.cameraPose);
      expect(matcher[0]!.capturedAtMs).toBe(qr[0]!.capturedAtMs);
      expect(hoisted.blits.map((b) => b.size.width).sort()).toEqual([
        1024, 480,
      ]);
    });

    // Why: the matcher's cadence and veto are its own; QR's are untouched.
    it('runs its own throttle and veto', () => {
      const matcher: number[] = [];
      let wanted = false;
      registerCameraFrameConsumer({
        intervalMs: 250,
        captureSize: 480,
        wantsFrame: () => wanted,
        onFrame: (f) => matcher.push(f.cameraPose.position[0]),
      });
      loop(1000, xrFrame(1)); // matcher vetoed, QR captures
      wanted = true;
      loop(1016, xrFrame(2)); // veto lifted: captured at once
      loop(1150, xrFrame(3)); // QR due, matcher not (250 ms)
      loop(1300, xrFrame(4)); // both due
      expect(qr.map((f) => f.cameraPose.position[0])).toEqual([1, 3, 4]);
      expect(matcher).toEqual([2, 4]);
    });

    // Why: unregistering must free the GPU target and stop deliveries at once.
    it('stops and frees its blit on unregister; a second call is harmless', () => {
      const matcher: number[] = [];
      const unregister = registerCameraFrameConsumer({
        captureSize: 480,
        onFrame: (f) => matcher.push(f.cameraPose.position[0]),
      });
      loop(1000, xrFrame(1));
      unregister();
      unregister();
      loop(2000, xrFrame(2));
      expect(matcher).toEqual([1]);
      const blit = hoisted.blits.find((b) => b.size.width === 480)!;
      expect(blit.disposed).toBe(1);
      expect(qr).toHaveLength(2);
    });

    // Why: a session teardown must free every consumer's GPU target, and an
    // unregister that arrives after it must not touch the next session.
    it('is torn down with the session', async () => {
      const unregister = registerCameraFrameConsumer({
        captureSize: 480,
        onFrame: () => {},
      });
      loop(1000, xrFrame(1));
      resetWebXRState();
      const blit = hoisted.blits.find((b) => b.size.width === 480)!;
      expect(blit.disposed).toBe(1);
      const next: CapturedCameraFrame[] = [];
      const nextLoop = await startSession(next);
      startCameraFrameCapture({ intervalMs: 100 });
      const matcher: number[] = [];
      registerCameraFrameConsumer({
        captureSize: 480,
        onFrame: (f) => matcher.push(f.cameraPose.position[0]),
      });
      unregister(); // the old session's: must not remove the new consumer
      nextLoop(1000, xrFrame(7));
      expect(matcher).toEqual([7]);
    });

    // Why: a failing matcher must never cost QR its frame or the XR loop.
    it('keeps QR and the loop running when a consumer throws', () => {
      registerCameraFrameConsumer({
        captureSize: 480,
        onFrame: () => {
          throw new Error('matcher failed');
        },
      });
      expect(() => loop(1000, xrFrame(1))).not.toThrow();
      expect(qr).toHaveLength(1);
    });

    // Why: a typo in the consumer's config should fail loudly at registration,
    // not as a blank or giant blit mid-session.
    it.each([0, -1, Number.NaN, Infinity])(
      'refuses the capture size %s',
      (captureSize) => {
        expect(() =>
          registerCameraFrameConsumer({ captureSize, onFrame: () => {} })
        ).toThrow(RangeError);
      }
    );

    it('refuses a missing onFrame', () => {
      expect(() =>
        registerCameraFrameConsumer({
          captureSize: 480,
          onFrame: undefined as unknown as () => void,
        })
      ).toThrow(TypeError);
    });
  });

  // Why: before initAR there is no renderer and no loop; a consumer
  // registered then would be dropped by initAR's fresh handle without notice.
  it('refuses to register before the session starts', () => {
    resetWebXRState();
    expect(() =>
      registerCameraFrameConsumer({ captureSize: 480, onFrame: () => {} })
    ).toThrow(Error);
  });
});
