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

const { capturedConfig, fusedVotes } = vi.hoisted(() => ({
  capturedConfig: { current: null as Record<string, unknown> | null },
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
      Promise.resolve({ version: 1, qr: { physicalSizeM: 0.25 } })
    ),
    shouldCacheLevel: vi.fn(() => true),
    dispose: vi.fn(),
  })),
}));
vi.mock('./qr-fused-votes', () => ({
  createQrFusedVotes: vi.fn(() => fusedVotes),
}));

import { wireQrRecording } from './wire-qr-recording';

function store() {
  return {
    getState: () => ({
      recording: {
        latestDepthSample: { projectionMatrix: new Array(16).fill(0) },
      },
      qrDetected: { maxHistory: 100, markers: {} },
      gpsData: null,
    }),
    dispatch: vi.fn(),
    subscribe: () => () => undefined,
  };
}

function wire() {
  let current = store();
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
  return { config: capturedConfig.current!, swap: () => ref.set(store()) };
}

describe('wireQrRecording level mode votes on the fused pose (b6a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('evaluates after each recorded raw detection', () => {
    const { config } = wire();
    const raw = {
      text: 'code-a',
      timestamp: 1,
      corners: [],
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      imageWidth: 1024,
      imageHeight: 768,
    };
    (config.onRawDetection as (r: unknown) => void)(raw);
    expect(fusedVotes.onRecorded).toHaveBeenCalledWith('code-a');
  });

  it('starts new trackers when the store swaps, not on the first attach', () => {
    const { swap } = wire();
    expect(fusedVotes.resetForStore).not.toHaveBeenCalled();
    swap();
    expect(fusedVotes.resetForStore).toHaveBeenCalledTimes(1);
  });
});
