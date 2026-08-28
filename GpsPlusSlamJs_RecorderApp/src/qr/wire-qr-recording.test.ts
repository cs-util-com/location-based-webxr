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

const { mockCreateQrTrackingController, capturedTrackingConfig } = vi.hoisted(
  () => {
    const capturedTrackingConfig: {
      current: Record<string, unknown> | null;
    } = { current: null };
    return {
      capturedTrackingConfig,
      mockCreateQrTrackingController: vi.fn(
        (config: Record<string, unknown>) => {
          capturedTrackingConfig.current = config;
          return { offerFrame: vi.fn(), reset: vi.fn(), status: 'idle' };
        }
      ),
    };
  }
);

vi.mock('gps-plus-slam-app-framework/ar/qr/qr-tracking-controller', () => ({
  createQrTrackingController: mockCreateQrTrackingController,
}));

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

import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { wireQrRecording } from './wire-qr-recording';

// `recordGpsEvent` is licence-gated. Creating a store is the documented
// activation path, and it is what production does at boot.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

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

const qr = {
  enabled: true,
  intervalMs: 125,
  captureSize: 1024,
  // These wiring tests cover the RAW-recording mode; the level-consuming
  // mode has its own suite around qr-level-source.
  useLevels: false,
};

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

// Added with the level-consuming mode (plan M-E, DEC-7). These assert the
// SWITCH, not the fetch — the level source has its own suite.
describe('wireQrRecording — level-consuming mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('keeps the thin RAW producer when the switch is off', () => {
    // The default, and what every corpus recording uses: detections recorded,
    // nothing fetched, no synthetic GPS added to the session.
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr,
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    expect(mockCreateQrDetectionController).toHaveBeenCalledTimes(1);
  });

  it('does NOT build the thin producer when the switch is on', () => {
    // Why this test matters: running both would decode every camera frame
    // TWICE on the AR frame path. The tracking controller's detection event
    // carries the raw corners and camera pose precisely so one decode can
    // feed both the vote path and the raw record.
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    expect(mockCreateQrDetectionController).not.toHaveBeenCalled();
  });

  it('still starts exactly one camera-frame source in either mode', () => {
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    expect(mockStartCapture).toHaveBeenCalledTimes(1);
  });
});

// The level-consuming pipeline's own callbacks — built by the wiring and
// invoked by the framework controller, so nothing else exercises them.
describe('wireQrRecording — the level-consuming callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTrackingConfig.current = null;
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  function wireWithLevels(latestDepthSample: unknown) {
    const store = makeStore(latestDepthSample);
    const { ref } = makeStoreRef(store);
    const dispose = wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    return { store, dispose, config: capturedTrackingConfig.current! };
  }

  const depthSample = {
    projectionMatrix: [1.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0],
  };

  it('still writes the RAW observation for every validated DECODE', () => {
    // Why this test matters: decision D-A says a recording stays
    // algorithm-agnostic whatever else the session is doing. Level mode must
    // not quietly stop recording what it saw - and it gets the raw facts from
    // the SAME decode that produced the pose, not a second one.
    const { store, config } = wireWithLevels(depthSample);
    const onRawDetection = config.onRawDetection as (e: unknown) => void;
    onRawDetection({
      text: 'code',
      timestamp: 1234,
      corners: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
      ],
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      imageWidth: 640,
      imageHeight: 480,
    });
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'qrDetected/recordQrDetection' })
    );
  });

  it('records nothing when there is no projection matrix to solve against', () => {
    // A raw observation without one cannot be re-solved later, so writing a
    // partial record would be worse than writing none.
    const { store, config } = wireWithLevels(null);
    const onRawDetection = config.onRawDetection as (e: unknown) => void;
    onRawDetection({
      text: 'code',
      timestamp: 1,
      corners: [],
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      imageWidth: 1,
      imageHeight: 1,
    });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches every vote of a batch into the current store', () => {
    const { store, config } = wireWithLevels(depthSample);
    const dispatchVotes = config.dispatchVotes as (v: unknown[]) => void;
    dispatchVotes([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(store.dispatch).toHaveBeenCalledTimes(3);
  });

  it('derives intrinsics from the depth sample, and refuses without one', () => {
    const withDepth = wireWithLevels(depthSample);
    const getIntrinsics = withDepth.config.getIntrinsics as (
      i: unknown
    ) => unknown;
    expect(getIntrinsics({ width: 640, height: 480 })).not.toBeNull();

    const withoutDepth = wireWithLevels(null);
    const none = withoutDepth.config.getIntrinsics as (i: unknown) => unknown;
    expect(none({ width: 640, height: 480 })).toBeNull();
  });

  it('carries the vote shape the shipped viewer uses', () => {
    const { config } = wireWithLevels(depthSample);
    expect(config.syntheticAccuracyM).toBe(5);
    expect(config.voteBaselineM).toBe(2);
    expect(config.voteCount).toBe(4);
    expect(config.minIntervalMs).toBe(0);
  });
});

// The remaining level-mode seams: the pose solve, the level lookup, and the
// teardown that must stop network work when a session ends.
describe('wireQrRecording — level mode seams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTrackingConfig.current = null;
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('solves a pose through the pure-JS PnP backend', () => {
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const config = capturedTrackingConfig.current!;
    const solvePose = config.solvePose as (i: unknown) => unknown;
    // A degenerate quad has no pose; what matters is that a solver is wired
    // at all - without one the call throws rather than returning null.
    expect(() =>
      solvePose({
        imagePoints: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        sizeM: 0.16,
        intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
        cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      })
    ).not.toThrow();
  });

  it('routes level lookups through the guarded source', async () => {
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const config = capturedTrackingConfig.current!;
    const fetchLevel = config.fetchLevel as (t: string) => Promise<unknown>;
    // A foreign code must come back as the geo-less placeholder without any
    // network attempt — the guard lives in the source, and this proves the
    // wiring actually goes through it.
    await expect(
      fetchLevel('WIFI:S:CoffeeShop;T:WPA;P:hunter2;;')
    ).resolves.toEqual({ version: 1, qr: {} });
  });

  it('reads the camera pose live, not once at wiring time', () => {
    const { ref } = makeStoreRef(makeStore());
    wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer: vi.fn(),
      readAlignment: NO_ALIGNMENT,
    });
    const config = capturedTrackingConfig.current!;
    const getCameraPose = config.getCameraPose as () => unknown;
    expect(getCameraPose()).toEqual({
      position: [7, 8, 9],
      rotation: [0, 0, 0, 1],
    });
    mockGetCurrentArPose.mockReturnValueOnce(null);
    expect(getCameraPose()).toBeNull();
  });

  it('stops the frame source and the level source on dispose', () => {
    // The level source holds abortable network work; a session that ended
    // must not leave it running into the next one.
    const setProducer = vi.fn();
    const { ref } = makeStoreRef(makeStore());
    const dispose = wireQrRecording({
      storeRef: ref as never,
      getArWorldGroup: () => null,
      qr: { ...qr, useLevels: true },
      setProducer,
      readAlignment: NO_ALIGNMENT,
    });
    dispose();
    expect(mockStopCapture).toHaveBeenCalledTimes(1);
    expect(setProducer).toHaveBeenLastCalledWith(null);
  });
});
