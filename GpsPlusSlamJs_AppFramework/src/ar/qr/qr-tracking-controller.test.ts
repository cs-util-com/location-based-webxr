/**
 * QR tracking controller — unit tests.
 *
 * Why this test matters: this pins the async-UI state machine the demonstrator
 * relies on (idle→scanning→loading-level→tracking, error on failure), the level
 * cache (one fetch per URL), and that a lock actually dispatches the synthetic
 * votes. Every dependency is faked so the orchestration is tested without WASM,
 * a device, or a real store.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createQrTrackingController,
  type QrTrackingStatus,
  type QrSolvePoseInput,
  type QrDetectionEvent,
} from './qr-tracking-controller';
import { buildObjectPoints, type QrPoseSolution } from './qr-pose';
import type { QrLevel } from './qr-level';
import type { RgbaImage, QrDetection, QrFrontEnd } from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};
const corners: QrDetection['corners'] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const detection: QrDetection = { corners, text: 'https://lvl/1' };

const level: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  },
};

const solution: QrPoseSolution = {
  qrPoseWorld: { position: [1, 2, -3], rotation: [0, 0, 0, 1] },
  qrPoseInCamera: { position: [0, 0, -1.5], rotation: [0, 0, 0, 1] },
  reprojectionErrorPx: 0.5,
};

const cameraPose = {
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0, 1] as const,
};
const intrinsics = { fx: 600, fy: 600, cx: 320, cy: 240 };

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(
  overrides: Partial<Parameters<typeof createQrTrackingController>[0]> = {}
) {
  const statuses: QrTrackingStatus[] = [];
  const dispatched: unknown[] = [];
  const frontEnd: QrFrontEnd = {
    kind: 'barcode-detector',
    detect: vi.fn(() => Promise.resolve<QrDetection | null>(detection)),
  };
  const fetchLevel = vi.fn(() => Promise.resolve(level));
  const controller = createQrTrackingController({
    frontEnd,
    solvePose: () => solution,
    fetchLevel,
    dispatchVotes: (votes) => dispatched.push(...votes),
    getCameraPose: () => cameraPose,
    getIntrinsics: () => intrinsics,
    syntheticAccuracyM: 0.05,
    requiredLockCount: 2,
    minIntervalMs: 0,
    onStatus: (s) => statuses.push(s),
    ...overrides,
  });
  return { controller, statuses, dispatched, frontEnd, fetchLevel };
}

async function tick(controller: { offerFrame: (i: RgbaImage) => void }) {
  controller.offerFrame(image);
  await flush();
}

describe('createQrTrackingController', () => {
  it('progresses idle → scanning → loading-level → tracking and dispatches votes', async () => {
    const { controller, statuses, dispatched } = setup();
    expect(controller.status).toBe('idle');

    await tick(controller); // 1st detect: scanning, loading-level, 1 success
    await tick(controller); // 2nd detect: lock → tracking + votes

    expect(controller.status).toBe('tracking');
    expect(statuses).toEqual(['scanning', 'loading-level', 'tracking']);
    expect(dispatched).toHaveLength(4); // 4-corner multi-correspondence
  });

  // Why this test matters (M4 milestone review #10): the TourViewer's vote
  // budget keys each vote batch by the text `onDetection` delivered for the
  // SAME frame — the sidecar documents that ordering, but nothing asserted
  // it. A reorder here would silently charge the wrong code's budget.
  it('fires onDetection synchronously before the same frame’s dispatchVotes', async () => {
    const calls: string[] = [];
    const { controller } = setup({
      onDetection: () => calls.push('detection'),
      dispatchVotes: () => calls.push('votes'),
    });
    await tick(controller); // 1st success — no lock yet
    await tick(controller); // lock → detection then votes, same frame

    const beforeEachVote = calls
      .map((call, i) => (call === 'votes' ? calls[i - 1] : null))
      .filter((previous) => previous !== null);
    expect(beforeEachVote.length).toBeGreaterThan(0);
    expect(beforeEachVote).toEqual(beforeEachVote.map(() => 'detection'));
  });

  it('fetches the level only once per URL (cache)', async () => {
    const { controller, fetchLevel } = setup();
    await tick(controller);
    await tick(controller);
    await tick(controller);
    expect(fetchLevel).toHaveBeenCalledTimes(1);
  });

  it('goes to error and reports when the level fetch fails', async () => {
    const onError = vi.fn();
    const { controller, statuses } = setup({
      fetchLevel: vi.fn(() => Promise.reject(new Error('404'))),
      onError,
    });
    await tick(controller);
    expect(controller.status).toBe('error');
    expect(statuses).toContain('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stays scanning when no QR is detected', async () => {
    const { controller, dispatched } = setup({
      frontEnd: {
        kind: 'barcode-detector',
        detect: () => Promise.resolve(null),
      },
    });
    await tick(controller);
    expect(controller.status).toBe('scanning');
    expect(dispatched).toHaveLength(0);
  });

  it('does not lock when the plausibility gate rejects the pose', async () => {
    const { controller, dispatched } = setup({ isPlausible: () => false });
    await tick(controller);
    await tick(controller);
    expect(dispatched).toHaveLength(0);
    expect(controller.status).not.toBe('tracking');
  });

  it('emits a qrDetected event on every lock (independent of the vote)', async () => {
    const events: unknown[] = [];
    const { controller } = setup({ onDetection: (e) => events.push(e) });
    await tick(controller);
    await tick(controller); // lock
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      text: 'https://lvl/1',
      qrPoseWorld: solution.qrPoseWorld,
      qrPoseInCamera: solution.qrPoseInCamera,
      reprojectionErrorPx: 0.5,
    });
    expect((events[0] as { timestamp: number }).timestamp).toBeTypeOf('number');
  });

  it('skips the vote for a geo-less level but still emits the detection', async () => {
    const events: unknown[] = [];
    const { controller, dispatched } = setup({
      fetchLevel: vi.fn(() =>
        Promise.resolve({ version: 1, qr: { physicalSizeM: 0.2 } })
      ),
      onDetection: (e) => events.push(e),
    });
    await tick(controller);
    await tick(controller); // lock
    expect(controller.status).toBe('tracking');
    expect(dispatched).toHaveLength(0); // no geo → no vote
    expect(events).toHaveLength(1); // detection still emitted
  });

  it('blocks the solve when size is unknown and no resolver supplies it', async () => {
    const solvePose = vi.fn(() => solution);
    const { controller, dispatched } = setup({
      fetchLevel: vi.fn(() =>
        Promise.resolve({
          version: 1,
          qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 } },
        })
      ),
      solvePose,
    });
    await tick(controller);
    await tick(controller);
    expect(solvePose).not.toHaveBeenCalled(); // size gate blocks the solve
    expect(controller.status).toBe('scanning');
    expect(dispatched).toHaveLength(0);
  });

  // Why this test matters: `resolveSizeM` is an injected boundary returning
  // `number | null` — a depth/measurement resolver can legitimately yield a
  // degenerate value (0, NaN, Infinity, negative) before it converges. The real
  // `solvePose` feeds `sizeM` to `buildObjectPoints`, which throws a RangeError
  // on any non-positive/non-finite size. The controller's size gate only checked
  // `=== null`, so a degenerate measured size slipped through, crashed the solve,
  // and wedged the controller in the terminal `error` state instead of degrading
  // to `scanning` exactly like the `null` case. These prove the gate treats a
  // degenerate measured size identically to an absent one.
  it.each([0, -0.1, NaN, Infinity])(
    'stays scanning (not error) when resolveSizeM returns degenerate %p',
    async (badSize) => {
      const onError = vi.fn();
      const { controller, statuses } = setup({
        fetchLevel: vi.fn(() =>
          Promise.resolve({
            version: 1,
            qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 } },
          })
        ),
        // Mirror the production wiring: the real solvePose derives object points
        // via buildObjectPoints, which rejects a non-positive/non-finite size.
        solvePose: (input: QrSolvePoseInput) => {
          buildObjectPoints(input.sizeM);
          return solution;
        },
        resolveSizeM: () => badSize,
        onError,
      });
      await tick(controller);
      await tick(controller);
      expect(controller.status).toBe('scanning');
      expect(statuses).not.toContain('error');
      expect(onError).not.toHaveBeenCalled();
    }
  );

  it('uses a resolved (e.g. depth-measured) size when the level omits it', async () => {
    const solvePose = vi.fn((_input: QrSolvePoseInput) => solution);
    const dispatched: unknown[] = [];
    const controller = createQrTrackingController({
      frontEnd: {
        kind: 'barcode-detector',
        detect: () => Promise.resolve<QrDetection | null>(detection),
      },
      solvePose,
      fetchLevel: vi.fn(() =>
        Promise.resolve({
          version: 1,
          qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 } },
        })
      ),
      dispatchVotes: (v) => dispatched.push(...v),
      resolveSizeM: () => 0.18,
      getCameraPose: () => cameraPose,
      getIntrinsics: () => intrinsics,
      syntheticAccuracyM: 0.05,
      requiredLockCount: 2,
      minIntervalMs: 0,
    });
    await tick(controller);
    await tick(controller);
    expect(solvePose).toHaveBeenCalled();
    expect(solvePose.mock.calls[0]?.[0]).toMatchObject({ sizeM: 0.18 });
    expect(dispatched).toHaveLength(4); // geo present + size resolved → vote
  });

  it('votes on the STABLE pose when a resolveStablePose bridge is wired', async () => {
    const stablePose = {
      position: [10, 20, -30] as const,
      rotation: [0, 0, 0, 1] as const,
    };
    const resolveStablePose = vi.fn(() => stablePose);
    const { controller, dispatched } = setup({ resolveStablePose });
    await tick(controller);
    await tick(controller); // lock
    expect(resolveStablePose).toHaveBeenCalledWith('https://lvl/1');
    expect(dispatched).toHaveLength(4);
    // The 4 corner votes are built around the STABLE pose ([10,20,-30]), NOT the
    // raw solve pose ([1,2,-3]). Their odom centroid must be the stable center.
    const centroid = (dispatched as { odomPosition: number[] }[]).reduce(
      (acc, v) => [
        acc[0] + v.odomPosition[0]! / 4,
        acc[1] + v.odomPosition[1]! / 4,
        acc[2] + v.odomPosition[2]! / 4,
      ],
      [0, 0, 0]
    );
    expect(centroid[0]).toBeCloseTo(10, 5);
    expect(centroid[1]).toBeCloseTo(20, 5);
    expect(centroid[2]).toBeCloseTo(-30, 5);
  });

  it('skips the vote (but still emits the detection) until the pose is stable', async () => {
    const events: unknown[] = [];
    const { controller, dispatched } = setup({
      resolveStablePose: () => null, // not converged yet
      onDetection: (e) => events.push(e),
    });
    await tick(controller);
    await tick(controller); // lock
    expect(controller.status).toBe('tracking');
    expect(dispatched).toHaveLength(0); // vote gated on stability
    expect(events).toHaveLength(1); // detection still emitted (unconditional)
  });

  it('reset() clears the cache and returns to idle', async () => {
    const { controller, fetchLevel } = setup();
    await tick(controller);
    controller.reset();
    expect(controller.status).toBe('idle');
    await tick(controller);
    await tick(controller);
    expect(fetchLevel).toHaveBeenCalledTimes(2); // cache cleared → refetched
  });
});

// Added for the recorder's level-consuming mode (plan M-E): an app that needs
// BOTH a solved pose and a raw record must get them from ONE decode. Running
// the thin producer alongside this controller would decode every frame twice,
// on the AR frame path.
describe('createQrTrackingController — the raw facts of the solve', () => {
  it('reports corners, camera pose and image size with each locked detection', async () => {
    const events: QrDetectionEvent[] = [];
    const corners: QrDetection['corners'] = [
      { x: 10, y: 10 },
      { x: 90, y: 12 },
      { x: 88, y: 88 },
      { x: 12, y: 86 },
    ];
    const cameraPose = {
      position: [1, 2, 3] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const controller = createQrTrackingController({
      frontEnd: {
        kind: 'barcode-detector',
        detect: () => Promise.resolve({ corners, text: 'code' }),
      },
      solvePose: () => ({
        qrPoseWorld: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        qrPoseInCamera: { position: [0, 0, 1], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 1,
      }),
      fetchLevel: () =>
        Promise.resolve({ version: 1, qr: { physicalSizeM: 0.2 } }),
      dispatchVotes: () => undefined,
      onDetection: (event) => events.push(event),
      getCameraPose: () => cameraPose,
      getIntrinsics: () => ({ fx: 500, fy: 500, cx: 320, cy: 240 }),
      syntheticAccuracyM: 5,
      minIntervalMs: 0,
      requiredLockCount: 1,
    });

    const frame = {
      data: new Uint8ClampedArray(4),
      width: 640,
      height: 480,
    };
    // Two frames: the first resolves the level, the second locks.
    controller.offerFrame(frame);
    await flush();
    controller.offerFrame(frame);
    await flush();

    // EVERY locked detection carries them, not just the first — the recorder
    // records one raw observation per detection.
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.corners).toEqual(corners);
      expect(event.cameraPose).toEqual(cameraPose);
      expect(event.imageWidth).toBe(640);
      expect(event.imageHeight).toBe(480);
    }
  });
});
