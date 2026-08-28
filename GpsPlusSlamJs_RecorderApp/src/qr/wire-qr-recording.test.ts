/**
 * Tests for the QR recording wiring (WS-2 producer + WS-5 consumer composition).
 *
 * Why this matters: this module is where the load-bearing decisions land — the
 * producer's clock MUST be performance.now() (open topic A: epoch ms would
 * silently mis-pair the depth as-of join), the camera-frame source carries the
 * configured cadence + capture size, detections dispatch RAW into the current
 * store, and the debug viz follows the store. The framework producer/controller
 * are mocked (covered by their own tests); these tests isolate the wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockCreateQrDetectionController,
  mockCreateBarcodeDetectorFrontEnd,
  capturedProducerDeps,
  fakeProducer,
} = vi.hoisted(() => {
  const fakeProducer = { offerFrame: vi.fn(), reset: vi.fn(), status: 'idle' };
  const capturedProducerDeps: { current: Record<string, unknown> | null } = {
    current: null,
  };
  return {
    fakeProducer,
    capturedProducerDeps,
    mockCreateQrDetectionController: vi.fn((deps: Record<string, unknown>) => {
      capturedProducerDeps.current = deps;
      return fakeProducer;
    }),
    mockCreateBarcodeDetectorFrontEnd: vi.fn(() => ({
      detect: vi.fn().mockResolvedValue(null),
    })),
  };
});

const { mockStartCapture, mockStopCapture, mockGetCurrentArPose } = vi.hoisted(
  () => ({
    mockStartCapture: vi.fn(),
    mockStopCapture: vi.fn(),
    // ARPose shape ({position:{x,y,z}, orientation:{x,y,z,w}}); a known value
    // distinct from any depth-sample pose so tests can prove Option A. Return type
    // is the `… | null` union so a test can simulate "no pose yet".
    mockGetCurrentArPose: vi.fn(
      (): {
        position: { x: number; y: number; z: number };
        orientation: { x: number; y: number; z: number; w: number };
      } | null => ({
        position: { x: 7, y: 8, z: 9 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      })
    ),
  })
);

const { mockDebugController, mockCreateQrDebugController } = vi.hoisted(() => {
  const mockDebugController = { update: vi.fn(), dispose: vi.fn() };
  return {
    mockDebugController,
    mockCreateQrDebugController: vi.fn(() => mockDebugController),
  };
});

vi.mock('gps-plus-slam-app-framework/ar/qr/qr-detection-controller', () => ({
  createQrDetectionController: mockCreateQrDetectionController,
}));
vi.mock('gps-plus-slam-app-framework/ar/qr/qr-frontend', () => ({
  createBarcodeDetectorFrontEnd: mockCreateBarcodeDetectorFrontEnd,
}));
vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  startCameraFrameCapture: mockStartCapture,
  stopCameraFrameCapture: mockStopCapture,
  getCurrentArPose: mockGetCurrentArPose,
}));
vi.mock('./qr-debug-controller', () => ({
  createQrDebugController: mockCreateQrDebugController,
}));
vi.mock('../state/recorder-store', () => ({
  recordQrDetection: vi.fn((entry: unknown) => ({
    type: 'qrDetected/recordQrDetection',
    payload: entry,
  })),
}));

import { wireQrRecording } from './wire-qr-recording';

// --- A fake store + storeRef ------------------------------------------------

interface FakeStore {
  getState: () => {
    recording: { latestDepthSample: unknown };
    qrDetected: { maxHistory: number; markers: Record<string, unknown> };
  };
  dispatch: ReturnType<typeof vi.fn>;
  subscribe: (listener: () => void) => () => void;
  emit: () => void;
}

function makeStore(latestDepthSample: unknown = null): FakeStore {
  const listeners = new Set<() => void>();
  return {
    getState: () => ({
      recording: { latestDepthSample },
      qrDetected: { maxHistory: 100, markers: {} },
    }),
    dispatch: vi.fn(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => {
      for (const l of [...listeners]) l();
    },
  };
}

function makeStoreRef(store: FakeStore) {
  const swapListeners = new Set<(s: FakeStore) => void>();
  let current = store;
  return {
    ref: {
      get: () => current,
      set: (s: FakeStore) => {
        current = s;
        for (const l of [...swapListeners]) l(s);
      },
      subscribe: (l: (s: FakeStore) => void) => {
        swapListeners.add(l);
        return () => swapListeners.delete(l);
      },
    },
  };
}

const qr = { enabled: true, intervalMs: 125, captureSize: 1024 };

// Manual requestAnimationFrame so the F3 coalescing is deterministic in tests:
// callbacks queue and only run when flushRaf() is called.
let rafQueue: Array<() => void> = [];
function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb();
}

/** No GPS alignment yet — the state a session is in before its first fix,
 *  and the one these wiring tests care about (they assert plumbing, not
 *  minting). */
const NO_ALIGNMENT = () => ({
  alignmentMatrix: null,
  zero: null,
  alignmentSampleCount: 0,
});

describe('wireQrRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProducerDeps.current = null;
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the producer with an EPOCH-ms clock matching the depth stream (the as-of join)', () => {
    const store = makeStore();
    const { ref } = makeStoreRef(store);
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });

    const deps = capturedProducerDeps.current!;
    expect(deps).toBeTruthy();
    const now = deps.now as () => number;
    // `DepthSample.timestamp` is EPOCH ms (`performance.timeOrigin + frameTs`,
    // depth-sampler.ts). The as-of size join keys QR detections by the SAME
    // timestamp, so the producer MUST stamp epoch ms — `performance.now()`
    // (relative, ~1e5) would never satisfy `depth.ts <= detection.ts` and the
    // cube would never appear. Assert same domain as `timeOrigin + now()`.
    const epochApprox = performance.timeOrigin + performance.now();
    expect(now()).toBeGreaterThan(1e12); // epoch, not relative perf-now
    expect(Math.abs(now() - epochApprox)).toBeLessThan(2000);
    // The frame source is the single cadence owner.
    expect(deps.minIntervalMs).toBe(0);
  });

  it('starts camera-frame capture with the configured cadence + capture size', () => {
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    expect(mockStartCapture).toHaveBeenCalledWith({
      intervalMs: 125,
      captureSize: 1024,
    });
  });

  it('hands the created producer to setProducer (for the pre-initAR frame callback)', () => {
    const setProducer = vi.fn();
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer,
      readAlignment: NO_ALIGNMENT,
    });
    expect(setProducer).toHaveBeenCalledWith(fakeProducer);
  });

  it('reads camera pose from the CURRENT XR frame (Option A), not the depth sample', () => {
    // The depth sample carries a DIFFERENT pose; getCameraPose must ignore it and
    // return the fresh per-frame pose from getCurrentArPose() (converted to the
    // Pose tuple shape), so a 1 Hz-stale depth pose never lands in the recording.
    const sample = {
      timestamp: 5,
      cameraPos: [1, 2, 3],
      cameraRot: [0, 0, 0, 1],
      points: [],
      projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    const { ref } = makeStoreRef(makeStore(sample));
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const deps = capturedProducerDeps.current!;
    // From getCurrentArPose() = {position:{7,8,9}, orientation:{0,0,0,1}}.
    expect((deps.getCameraPose as () => unknown)()).toEqual({
      position: [7, 8, 9],
      rotation: [0, 0, 0, 1],
    });
    // Projection still comes from the depth sample (near-constant FOV).
    expect((deps.getProjectionMatrix as () => unknown)()).toBe(
      sample.projectionMatrix
    );
  });

  it('returns a null camera pose when no XR frame pose is available yet', () => {
    mockGetCurrentArPose.mockReturnValueOnce(null);
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const deps = capturedProducerDeps.current!;
    expect((deps.getCameraPose as () => unknown)()).toBeNull();
  });

  it('dispatches RAW recordQrDetection into the CURRENT store', () => {
    const store = makeStore();
    const { ref } = makeStoreRef(store);
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const deps = capturedProducerDeps.current!;
    const observation = { text: 'x', timestamp: 1 };
    (deps.recordDetection as (o: unknown) => void)(observation);
    expect(store.dispatch).toHaveBeenCalledWith({
      type: 'qrDetected/recordQrDetection',
      payload: observation,
    });
  });

  it('coalesces per-action updates to one per frame (F3) and re-attaches across a swap', () => {
    const store = makeStore();
    const { ref } = makeStoreRef(store);
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    // Initial update on wire is synchronous (reflect pre-existing markers).
    expect(mockDebugController.update).toHaveBeenCalledTimes(1);

    // A store change defers to the next frame (not synchronous).
    store.emit();
    expect(mockDebugController.update).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(mockDebugController.update).toHaveBeenCalledTimes(2);

    // Two changes in the SAME frame coalesce into a single update (the F3 win).
    store.emit();
    store.emit();
    flushRaf();
    expect(mockDebugController.update).toHaveBeenCalledTimes(3);

    // A store swap (Start Recording / replay) reflects immediately (synchronous).
    const store2 = makeStore();
    ref.set(store2);
    expect(mockDebugController.update).toHaveBeenCalledTimes(4);

    // The new store's changes drive the controller too (coalesced).
    store2.emit();
    flushRaf();
    expect(mockDebugController.update).toHaveBeenCalledTimes(5);
  });

  it('dispose() stops capture, resets the producer, clears it, and disposes the viz', () => {
    const setProducer = vi.fn();
    const { ref } = makeStoreRef(makeStore());
    const dispose = wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer,
      readAlignment: NO_ALIGNMENT,
    });

    dispose();
    expect(mockStopCapture).toHaveBeenCalledTimes(1);
    expect(fakeProducer.reset).toHaveBeenCalledTimes(1);
    expect(setProducer).toHaveBeenLastCalledWith(null);
    expect(mockDebugController.dispose).toHaveBeenCalledTimes(1);
  });
});
