/**
 * Tests for `qr-detection-controller.ts` — the thin RAW producer (D-X/D-A).
 *
 * Why this matters: this is the live record path. It must emit ONE raw
 * observation per accepted decode (after the N-consecutive lock), carrying the
 * raw corners + camera pose + projection + frame size + timestamp — and NOTHING
 * derived (no size, no solved pose). It must reject the same bad reads
 * `solveQrPose` would (mirrored / degenerate quads) and skip when pose/projection
 * are unavailable, so a recording never captures an unusable detection.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Matrix4 } from 'gps-plus-slam-js';
import type { QrDetection, RgbaImage } from './qr-frontend.js';
import type { Point2, Pose } from './qr-pose.js';
import {
  createQrDetectionController,
  type RawObservationSink,
} from './qr-detection-controller.js';
import type { RawQrObservation } from './qr-derived-pose.js';
import type { CapturedCameraFrame } from '../captured-camera-frame.js';

const IMG: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 640,
  height: 480,
};

const VALID_CORNERS: [Point2, Point2, Point2, Point2] = [
  { x: 10, y: 10 },
  { x: 110, y: 10 },
  { x: 110, y: 110 },
  { x: 10, y: 110 },
];

// Collinear → degenerate → validateQuad rejects.
const DEGENERATE_CORNERS: [Point2, Point2, Point2, Point2] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
];

const cameraPose: Pose = {
  position: [1, 2, 3],
  rotation: [0, 0, 0, 1],
};
const projectionMatrix = [
  1.875, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0,
] as unknown as Matrix4;

/** The frame every test offers: pixels + the pose/time of their capture. */
const FRAME: CapturedCameraFrame = {
  image: IMG,
  cameraPose,
  capturedAtMs: 42,
};

function makeController(
  detect: (image: RgbaImage) => Promise<QrDetection | null>,
  overrides: Partial<Parameters<typeof createQrDetectionController>[0]> = {}
): {
  controller: ReturnType<typeof createQrDetectionController>;
  recorded: RawQrObservation[];
} {
  const recorded: RawQrObservation[] = [];
  const recordDetection: RawObservationSink = (o) => recorded.push(o);
  const controller = createQrDetectionController({
    detect,
    getProjectionMatrix: () => projectionMatrix,
    recordDetection,
    requiredLockCount: 2,
    now: () => 42,
    ...overrides,
  });
  return { controller, recorded };
}

/**
 * Drain the controller's internal async detect chain (detect→then→catch→finally,
 * which clears `inFlight`). A macrotask boundary flushes the whole microtask
 * queue, so the next `offerFrame` is not coalesced away.
 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createQrDetectionController', () => {
  it('emits one RAW observation per accepted decode after the lock count', async () => {
    const detect = vi.fn(() =>
      Promise.resolve({ corners: VALID_CORNERS, text: 'https://x/y' })
    );
    const { controller, recorded } = makeController(detect);

    controller.offerFrame(FRAME);
    await flush();
    expect(recorded).toHaveLength(0); // 1 of 2 locks

    controller.offerFrame(FRAME);
    await flush();
    expect(recorded).toHaveLength(1);
    expect(controller.status).toBe('tracking');

    const obs = recorded[0]!;
    expect(obs).toEqual({
      text: 'https://x/y',
      corners: VALID_CORNERS,
      cameraPose,
      projectionMatrix,
      imageWidth: 640,
      imageHeight: 480,
      timestamp: 42,
    });
    // RAW only — no derived size/pose leaked into the recorded observation.
    expect(obs).not.toHaveProperty('qrPoseWorld');
    expect(obs).not.toHaveProperty('sizeM');
  });

  it('rejects a degenerate quad (never records, stays scanning)', async () => {
    const detect = vi.fn(() =>
      Promise.resolve({ corners: DEGENERATE_CORNERS, text: 'bad' })
    );
    const { controller, recorded } = makeController(detect);

    controller.offerFrame(FRAME);
    await flush();
    controller.offerFrame(FRAME);
    await flush();

    expect(recorded).toHaveLength(0);
    expect(controller.status).toBe('scanning');
  });

  it('skips recording when the projection is unavailable', async () => {
    const detect = vi.fn(() =>
      Promise.resolve({ corners: VALID_CORNERS, text: 'https://x/y' })
    );
    const { controller, recorded } = makeController(detect, {
      getProjectionMatrix: () => null,
    });

    controller.offerFrame(FRAME);
    await flush();
    controller.offerFrame(FRAME);
    await flush();

    expect(recorded).toHaveLength(0);
  });

  it('records the pose and time of the FRAME, not of the moment the decode resolved', async () => {
    // Why this test matters (QR perf plan 2026-09-23, M4): the raw record is
    // solved later against its corners; a pose sampled after the async decode
    // would describe a different moment than the pixels.
    const capturePose: Pose = { position: [4, 5, 6], rotation: [0, 0, 0, 1] };
    const detect = vi.fn(() =>
      Promise.resolve({ corners: VALID_CORNERS, text: 'https://x/y' })
    );
    const { controller, recorded } = makeController(detect);
    const captured: CapturedCameraFrame = {
      image: IMG,
      cameraPose: capturePose,
      capturedAtMs: 1234,
    };
    controller.offerFrame(captured);
    await flush();
    controller.offerFrame(captured);
    await flush();
    expect(recorded[0]).toMatchObject({
      cameraPose: capturePose,
      timestamp: 1234,
    });
  });

  it('records nothing and stays scanning when no QR is decoded', async () => {
    const detect = vi.fn(() => Promise.resolve(null));
    const { controller, recorded } = makeController(detect);

    controller.offerFrame(FRAME);
    await flush();
    controller.offerFrame(FRAME);
    await flush();

    expect(recorded).toHaveLength(0);
    expect(controller.status).toBe('scanning');
  });
});

/**
 * Why this test matters (QR perf plan 2026-09-23, M3): isBusy is the camera
 * source's wantsFrame veto - true exactly while a detect is in flight, so the
 * session skips the GPU readback of a frame the scheduler would drop anyway.
 */
describe('createQrDetectionController isBusy', () => {
  it('is busy exactly while a detect is in flight', async () => {
    let resolveDetect: (d: QrDetection | null) => void = () => {};
    const { controller } = makeController(
      () => new Promise((resolve) => (resolveDetect = resolve))
    );
    expect(controller.isBusy()).toBe(false);
    controller.offerFrame(FRAME);
    expect(controller.isBusy()).toBe(true);
    resolveDetect(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.isBusy()).toBe(false);
  });
});
