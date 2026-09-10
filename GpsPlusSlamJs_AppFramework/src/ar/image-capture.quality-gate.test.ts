/**
 * Integration tests for the image-quality (blur/blackness) drop+retry gate
 * inside ImageCaptureManager.
 *
 * Why this matters: the pure metrics + verdict policy are unit-tested in
 * image-quality.test.ts; these pin the WIRING in the capture loop — that an
 * accepting verdict saves the blob, a rejecting verdict drops it and re-arms so
 * the NEXT frame fills the slot (no full-interval wait, no frame-index gap), the
 * never-good fallback eventually saves regardless, a hung analyzer fails open
 * (no deadlock), and the gate composes with the motion gate. See
 * 2026-06-24-1057-image-quality-gate-plan.md §6, §9.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ImageCaptureManager,
  type ImageCaptureCallbacks,
  type ImageCaptureConfig,
  type CapturedImage,
  type FrameQualityVerdict,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';
import { DEFAULT_MOTION_FILTER } from './capture-motion-gate';
import { DEFAULT_QUALITY_FILTER } from './image-quality';

function yQuat(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

describe('ImageCaptureManager — image-quality gate', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockCallbacks: ImageCaptureCallbacks;
  let manager: ImageCaptureManager;
  let currentPose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
  /** Scripted verdicts consumed in order; missing entries default to accept. */
  let verdicts: boolean[];
  let analyze: ReturnType<typeof vi.fn>;

  /** Drive one frame and let the readback macrotask + verdict microtasks settle. */
  async function step(
    t: number,
    angle = 0,
    pos = { x: 0, y: 0, z: 0 }
  ): Promise<void> {
    currentPose = { position: pos, orientation: yQuat(angle) };
    manager.onFrame(t);
    await new Promise((r) => setTimeout(r, 0));
  }

  function captured(): CapturedImage[] {
    return (
      mockCallbacks.onCaptured as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0] as CapturedImage);
  }

  /** Config with the motion gate OFF (isolating the quality gate) + quality ON. */
  function qualityOnlyConfig(
    overrides: Partial<ImageCaptureConfig['qualityFilter']> = {}
  ): ImageCaptureConfig {
    return {
      ...DEFAULT_CAPTURE_CONFIG,
      motionFilter: { ...DEFAULT_MOTION_FILTER, enabled: false },
      qualityFilter: {
        ...DEFAULT_QUALITY_FILTER,
        enabled: true,
        maxWaitMs: 4000,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    mockCanvas = {
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        const blob = new Blob(['fake image data'], {
          type: type || 'image/jpeg',
        });
        setTimeout(() => callback(blob), 0);
      }),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    currentPose = { position: { x: 0, y: 0, z: 0 }, orientation: yQuat(0) };
    verdicts = [];
    let vIdx = 0;
    analyze = vi.fn((): Promise<FrameQualityVerdict> =>
      Promise.resolve({ accept: verdicts[vIdx++] ?? true })
    );
    mockCallbacks = {
      getCurrentPose: vi.fn(() => currentPose),
      getScreenRotation: vi.fn(() => 0),
      onCaptured: vi.fn(),
      analyzeFrame: analyze as unknown as ImageCaptureCallbacks['analyzeFrame'],
    };
  });

  afterEach(() => {
    manager?.stop();
  });

  it('analyzes a captured frame and saves it when the verdict accepts', async () => {
    verdicts = [true];
    manager = new ImageCaptureManager(
      mockCanvas,
      mockCallbacks,
      qualityOnlyConfig()
    );
    manager.start();

    await step(1000);

    expect(analyze).toHaveBeenCalledTimes(1);
    // The analyzer receives the encoded blob (off-thread; manager never decodes).
    const firstArg = analyze.mock.calls[0]![0] as { blob: Blob };
    expect(firstArg.blob).toBeInstanceOf(Blob);
    expect(captured()).toHaveLength(1);
    expect(captured()[0]!.frameIndex).toBe(1);
  });

  it('drops a rejected frame and retries the NEXT frame (no full-interval wait, no index gap)', async () => {
    verdicts = [false, true];
    manager = new ImageCaptureManager(
      mockCanvas,
      mockCallbacks,
      qualityOnlyConfig()
    );
    manager.start();

    await step(1000); // due → captured+analyzed → REJECT → dropped + re-armed
    expect(captured()).toHaveLength(0);
    expect(analyze).toHaveBeenCalledTimes(1);

    // The retry happens ~one frame later (1016 ≪ interval 2000), not after a full
    // interval, and the saved frame keeps index 1 (the dropped frame burned none).
    await step(1016);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(captured()).toHaveLength(1);
    expect(captured()[0]!.frameIndex).toBe(1);
    expect(captured()[0]!.timestamp).toBe(performance.timeOrigin + 1016);
  });

  it('fires the never-good fallback after maxWaitMs, saving regardless of the verdict', async () => {
    verdicts = [false, false, false, false, false]; // always "blurry/black"
    manager = new ImageCaptureManager(
      mockCanvas,
      mockCallbacks,
      qualityOnlyConfig({ maxWaitMs: 4000 })
    );
    manager.start();

    // First attempt seeds the deadline base at t=1000.
    await step(1000); // analyze #1 → reject
    await step(2000); // msSinceBase 1000 < 4000 → analyze #2 → reject
    await step(3000); // msSinceBase 2000 < 4000 → analyze #3 → reject
    expect(captured()).toHaveLength(0);

    // msSinceBase = 4000 ≥ maxWaitMs → save WITHOUT analyzing (fallback).
    await step(5000);
    expect(analyze).toHaveBeenCalledTimes(3); // not 4 — the fallback skips analysis
    expect(captured()).toHaveLength(1);
    expect(captured()[0]!.timestamp).toBe(performance.timeOrigin + 5000);
  });

  it('fails open (saves) when the analyzer never settles, so it cannot deadlock', async () => {
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks, {
      ...qualityOnlyConfig(),
      captureTimeoutMs: 40, // short verdict safety timeout for the test
    });
    // Analyzer that never resolves.
    (mockCallbacks.analyzeFrame as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      () => new Promise<FrameQualityVerdict>(() => {})
    );
    manager.start();

    manager.onFrame(1000);
    // The verdict safety timeout (40ms) fires → fail-open save.
    await vi.waitFor(() =>
      expect(mockCallbacks.onCaptured).toHaveBeenCalledTimes(1)
    );
  });

  it('does not save a frame when the verdict resolves after stop()', async () => {
    // Reachable on every stop with the gate enabled: performStop() calls
    // imageQualityClient.dispose(), whose contract is to fail-open in-flight
    // analyses (resolve accept:true). Without a `!this.capturing` guard in
    // `finish`, that late resolution runs saveCapture → onCaptured AFTER the
    // session has stopped (and after endSession), writing a frame that is not
    // reflected in the already-recorded frameCount.
    let resolveVerdict!: (v: FrameQualityVerdict) => void;
    (mockCallbacks.analyzeFrame as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      () =>
        new Promise<FrameQualityVerdict>((r) => {
          resolveVerdict = r;
        })
    );
    manager = new ImageCaptureManager(
      mockCanvas,
      mockCallbacks,
      qualityOnlyConfig()
    );
    manager.start();

    await step(1000); // captured → analyze in flight (awaitingVerdict), no verdict
    expect(captured()).toHaveLength(0);

    manager.stop(); // session stops while the verdict is still in flight

    resolveVerdict({ accept: true }); // late fail-open resolution (e.g. from dispose)
    await new Promise((r) => setTimeout(r, 0));

    // The late verdict must NOT save a frame on the stopped session.
    expect(captured()).toHaveLength(0);
    expect(manager.getFrameCount()).toBe(0);
  });

  it('saves immediately (legacy path) when no analyzer is injected', async () => {
    const { analyzeFrame: _omit, ...noAnalyze } = mockCallbacks;
    manager = new ImageCaptureManager(
      mockCanvas,
      noAnalyze,
      qualityOnlyConfig()
    );
    manager.start();

    await step(1000);
    expect(captured()).toHaveLength(1);
  });

  it('saves immediately when the quality filter is disabled even if an analyzer exists', async () => {
    verdicts = [false]; // would reject — but the gate is OFF, so it never runs
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks, {
      ...qualityOnlyConfig(),
      qualityFilter: { ...DEFAULT_QUALITY_FILTER, enabled: false },
    });
    manager.start();

    await step(1000);
    expect(analyze).not.toHaveBeenCalled();
    expect(captured()).toHaveLength(1);
  });

  it('composes with the motion gate: a frame must pass BOTH gates', async () => {
    // Both gates ON. Poses stay calm so the motion gate always passes; the
    // quality gate rejects once then accepts. The retry still flows through the
    // motion gate (shouldCaptureNow runs on every dispatch, retries included).
    verdicts = [true, false, true];
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks, {
      ...DEFAULT_CAPTURE_CONFIG,
      motionFilter: { ...DEFAULT_MOTION_FILTER, enabled: true },
      qualityFilter: {
        ...DEFAULT_QUALITY_FILTER,
        enabled: true,
        maxWaitMs: 4000,
      },
    });
    manager.start();

    await step(1000, 0); // first capture (motion bypassed, no data) → accept
    expect(captured()).toHaveLength(1);

    // Next interval (due at 3000), calm pose → motion passes; quality rejects…
    await step(2968, 0);
    await step(2984, 0);
    await step(3000, 0); // due, calm → motion OK, quality REJECT → retry
    expect(captured()).toHaveLength(1);

    // …retry frame, still calm → motion OK, quality accepts.
    await step(3016, 0);
    expect(captured()).toHaveLength(2);
    expect(captured()[1]!.frameIndex).toBe(2);
  });
});
