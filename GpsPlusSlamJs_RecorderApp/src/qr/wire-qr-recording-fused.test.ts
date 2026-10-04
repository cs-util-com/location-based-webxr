/**
 * The recorder's level mode votes on the fused pose (QR near-frontal pose
 * plan §71-§72, b6a): the wiring seams.
 *
 * Why these tests matter: the fused-vote module is tested on its own
 * (`qr-fused-votes.test.ts`); what can still go wrong is the plumbing. The
 * old wiring gave the controller no `resolveStablePose` at all (it voted on
 * each lock's single-frame solve), never told anything the level's size,
 * evaluated nothing per detection, and kept no per-store trackers. Each of
 * those is pinned here through the real `wireQrRecording`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capturedConfig, fusedVotes, levelGeo } = vi.hoisted(() => ({
  capturedConfig: { current: null as Record<string, unknown> | null },
  /** Whether the fetched level carries geo (only then can it vote). */
  levelGeo: { current: true },
  fusedVotes: {
    noteLevelSize: vi.fn(),
    onRecorded: vi.fn(),
    resolveStablePose: vi.fn(() => null),
    resetForStore: vi.fn(),
  },
}));

vi.mock('gps-plus-slam-app-framework/ar/qr/qr-tracking-controller', () => ({
  createQrTrackingController: vi.fn((config: Record<string, unknown>) => {
    capturedConfig.current = config;
    return {
      offerFrame: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      isBusy: vi.fn(() => false),
      status: 'idle',
    };
  }),
}));
vi.mock('gps-plus-slam-app-framework/ar/qr/qr-frontend', () => ({
  createBarcodeDetectorFrontEnd: vi.fn(() => ({ detect: vi.fn() })),
}));
vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  startCameraFrameCapture: vi.fn(),
  stopCameraFrameCapture: vi.fn(),
}));
vi.mock('./qr-debug-controller', () => ({
  createQrDebugController: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
}));
vi.mock('./qr-level-source', () => ({
  createQrLevelSource: vi.fn(() => ({
    fetchLevel: vi.fn(() =>
      Promise.resolve({
        version: 1,
        qr: {
          physicalSizeM: 0.25,
          ...(levelGeo.current
            ? { geo: { lat: 50, lon: 8, alt: 100, rotation: [0, 0, 0, 1] } }
            : {}),
        },
      })
    ),
    shouldCacheLevel: vi.fn(() => true),
    dispose: vi.fn(),
  })),
}));
vi.mock('./qr-fused-votes', () => ({
  createQrFusedVotes: vi.fn(() => fusedVotes),
}));

import { wireQrRecording } from './wire-qr-recording';

function store(depth = true) {
  return {
    getState: () => ({
      recording: {
        latestDepthSample: depth
          ? { projectionMatrix: new Array(16).fill(0) }
          : null,
      },
      qrDetected: { maxHistory: 100, markers: {} },
      gpsData: null,
    }),
    dispatch: vi.fn(),
    subscribe: () => () => undefined,
  };
}

function wire(depth = true) {
  let current = store(depth);
  const swapListeners = new Set<(s: unknown) => void>();
  const ref = {
    get: () => current,
    set: (s: ReturnType<typeof store>) => {
      current = s;
      for (const l of [...swapListeners]) l(s);
    },
    subscribe: (l: (s: unknown) => void) => {
      swapListeners.add(l);
      return () => swapListeners.delete(l);
    },
  };
  wireQrRecording({
    storeRef: ref as never,
    getArWorldGroup: () => null,
    qr: {
      enabled: true,
      intervalMs: 125,
      captureSize: 1024,
      useLevels: true,
    },
    setProducer: vi.fn(),
    readAlignment: () => ({
      alignmentMatrix: null,
      zero: null,
      alignmentSampleCount: 0,
    }),
  });
  return {
    config: capturedConfig.current!,
    store: current,
    swap: () => ref.set(store()),
  };
}

/** A validated decode, as the controller hands it to `onRawDetection`. */
const RAW = {
  text: 'code-a',
  timestamp: 1,
  corners: [],
  cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  imageWidth: 1024,
  imageHeight: 768,
};

describe('wireQrRecording level mode votes on the fused pose (b6a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levelGeo.current = true;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  it('hands the controller the fused stable pose', () => {
    const { config } = wire();
    const resolve = config.resolveStablePose as
      ((t: string) => unknown) | undefined;
    expect(resolve).toBeTypeOf('function');
    resolve!('code-a');
    expect(fusedVotes.resolveStablePose).toHaveBeenCalledWith('code-a');
  });

  it("tells the fused votes each resolved level's printed size", async () => {
    const { config } = wire();
    await (config.fetchLevel as (t: string) => Promise<unknown>)('code-a');
    expect(fusedVotes.noteLevelSize).toHaveBeenCalledWith('code-a', 0.25);
  });

  // Plan §75 #2: a geo-less level (debug, trigger) never votes, so its code
  // must not be solved on every detection all session.
  it('passes no size for a level without geo', async () => {
    levelGeo.current = false;
    const { config } = wire();
    await (config.fetchLevel as (t: string) => Promise<unknown>)('code-a');
    expect(fusedVotes.noteLevelSize).toHaveBeenCalledWith('code-a', undefined);
  });

  it('evaluates after each recorded raw detection', () => {
    const { config, store } = wire();
    (config.onRawDetection as (r: unknown) => void)(RAW);
    expect(fusedVotes.onRecorded).toHaveBeenCalledWith('code-a');
    // After the record (plan §75 #3): evaluating first would read a window
    // without this detection.
    expect(store.dispatch.mock.invocationCallOrder[0]!).toBeLessThan(
      fusedVotes.onRecorded.mock.invocationCallOrder[0]!
    );
  });

  it('neither records nor evaluates without a projection', () => {
    const { config, store } = wire(false);
    (config.onRawDetection as (r: unknown) => void)(RAW);
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(fusedVotes.onRecorded).not.toHaveBeenCalled();
  });

  it('starts new trackers when the store swaps, not on the first attach', () => {
    const { swap } = wire();
    expect(fusedVotes.resetForStore).not.toHaveBeenCalled();
    swap();
    expect(fusedVotes.resetForStore).toHaveBeenCalledTimes(1);
  });
});
