/**
 * Detection scheduler — unit tests.
 *
 * Why this test matters: these pin the three runtime behaviors that keep the
 * heavy detection off the render thread and reject one-off bad reads — throttle
 * (≤ one start per interval), coalesce (no overlapping detections), and the
 * N-consecutive-lock gate with miss/error reset. The clock and the async detect
 * are injected so the timing is deterministic. The final block proves the
 * scheduler is generic over the result type (Note 1), not QR-coupled.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDetectionScheduler,
  type DetectionScheduler,
} from './detection-scheduler';
import type { QrPoseSolution } from './qr-pose';
import type { RgbaImage } from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};

const solution: QrPoseSolution = {
  qrPoseWorld: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
  reprojectionErrorPx: 0,
};

/** A controllable async `detect` whose pending promises we resolve by hand. */
function controllableDetect() {
  type Deferred = {
    resolve: (v: QrPoseSolution | null) => void;
    reject: (e: unknown) => void;
  };
  const deferreds: Deferred[] = [];
  const detect = vi.fn(
    () =>
      new Promise<QrPoseSolution | null>((resolve, reject) => {
        deferreds.push({ resolve, reject });
      })
  );
  // Flush the .then/.catch/.finally microtask chain.
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  async function settle(value: QrPoseSolution | null): Promise<void> {
    deferreds.shift()?.resolve(value);
    await flush();
  }
  async function reject(err: unknown): Promise<void> {
    deferreds.shift()?.reject(err);
    await flush();
  }
  return { detect, settle, reject };
}

describe('createDetectionScheduler<QrPoseSolution> (the QR path)', () => {
  it('throttles detection starts to one per minIntervalMs', async () => {
    let t = 0;
    const { detect, settle } = controllableDetect();
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 100,
      now: () => t,
    });

    s.offerFrame(image); // t=0 → starts #1
    expect(detect).toHaveBeenCalledTimes(1);
    await settle(null); // clear in-flight

    t = 50;
    s.offerFrame(image); // throttled (50 < 100)
    expect(detect).toHaveBeenCalledTimes(1);

    t = 100;
    s.offerFrame(image); // allowed
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('coalesces: never starts a second detection while one is in flight', async () => {
    const t = 0;
    const { detect, settle } = controllableDetect();
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 0,
      now: () => t,
    });

    s.offerFrame(image); // starts #1 (pending)
    expect(s.inFlight).toBe(true);
    s.offerFrame(image); // coalesced
    s.offerFrame(image); // coalesced
    expect(detect).toHaveBeenCalledTimes(1);

    await settle(null);
    expect(s.inFlight).toBe(false);
    s.offerFrame(image); // now allowed
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('locks only after N consecutive successes and resets on a miss', async () => {
    let t = 0;
    const onLocked = vi.fn();
    const onMiss = vi.fn();
    const { detect, settle } = controllableDetect();
    const s: DetectionScheduler<RgbaImage> =
      createDetectionScheduler<QrPoseSolution>({
        detect,
        minIntervalMs: 0,
        requiredLockCount: 3,
        now: () => t,
        onLocked,
        onMiss,
      });

    const tick = async (value: QrPoseSolution | null) => {
      t += 1;
      s.offerFrame(image);
      await settle(value);
    };

    await tick(solution);
    expect(s.consecutiveLocks).toBe(1);
    expect(s.locked).toBe(false);
    await tick(solution);
    expect(s.locked).toBe(false);
    await tick(solution); // 3rd → lock
    expect(s.locked).toBe(true);
    expect(onLocked).toHaveBeenCalledTimes(1);

    await tick(solution); // stays locked, fires again, count capped
    expect(onLocked).toHaveBeenCalledTimes(2);
    expect(s.consecutiveLocks).toBe(3);

    await tick(null); // miss resets
    expect(s.consecutiveLocks).toBe(0);
    expect(s.locked).toBe(false);
    expect(onMiss).toHaveBeenCalledTimes(1);
  });

  it('recovers when detect throws SYNCHRONOUSLY (never wedges inFlight)', async () => {
    // A detector can throw synchronously — before it ever returns a promise —
    // e.g. a worker-transport wrapper that throws when the worker is dead, or a
    // synchronous precondition check on a malformed frame. The scheduler sets
    // inFlight=true *before* calling detect, so a synchronous throw that escapes
    // offerFrame would leave inFlight stuck true forever, silently and
    // permanently blocking ALL future detections. This pins that it instead
    // routes to onError, clears inFlight, and stays usable.
    let t = 0;
    const onError = vi.fn();
    let throwOnce = true;
    const detect = vi.fn((_img: RgbaImage): Promise<QrPoseSolution | null> => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('sync boom'); // synchronous throw, NOT a rejected promise
      }
      return Promise.resolve<QrPoseSolution | null>(solution);
    });
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 1,
      now: () => t,
      onError,
    });
    const flush = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };

    // offerFrame must NOT throw out to the caller (the XR frame loop).
    expect(() => s.offerFrame(image)).not.toThrow();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.inFlight).toBe(false); // not wedged

    // The scheduler is still usable after the synchronous throw.
    t = 1;
    s.offerFrame(image);
    await flush();
    expect(detect).toHaveBeenCalledTimes(2);
    expect(s.locked).toBe(true);
  });

  it('resets the counter and reports when detect rejects', async () => {
    let t = 0;
    const onError = vi.fn();
    const { detect, settle, reject } = controllableDetect();
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 2,
      now: () => t,
      onError,
    });

    t = 1;
    s.offerFrame(image);
    await settle(solution);
    expect(s.consecutiveLocks).toBe(1);

    t = 2;
    s.offerFrame(image);
    await reject(new Error('detector blew up'));
    expect(s.consecutiveLocks).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.inFlight).toBe(false);
  });

  // Why this test matters: onLocked/onMiss/onError are user-supplied application
  // code that can throw. The success and miss branches run inside the SAME
  // promise chain as the .catch, so a throwing onLocked would propagate to that
  // .catch — which resets consecutiveLocks to 0 AND calls onError, corrupting the
  // documented N-consecutive-lock state machine (the lock would flap) and
  // misreporting a callback bug as a detection failure. Callbacks must be isolated.
  it('isolates a throwing onLocked callback from the scheduler state machine', async () => {
    let t = 0;
    const onError = vi.fn();
    const onLocked = vi.fn(() => {
      throw new Error('onLocked blew up');
    });
    const { detect, settle } = controllableDetect();
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 1,
      now: () => t,
      onLocked,
      onError,
    });

    t = 1;
    s.offerFrame(image);
    await settle(solution); // success → locked → onLocked throws

    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(s.consecutiveLocks).toBe(1); // not reset by the callback throw
    expect(s.locked).toBe(true);
    expect(onError).not.toHaveBeenCalled(); // callback bug ≠ detection failure
    expect(s.inFlight).toBe(false);
  });

  it('isolates a throwing onMiss callback from the scheduler error path', async () => {
    let t = 0;
    const onError = vi.fn();
    const onMiss = vi.fn(() => {
      throw new Error('onMiss blew up');
    });
    const { detect, settle } = controllableDetect();
    const s = createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 2,
      now: () => t,
      onMiss,
      onError,
    });

    t = 1;
    s.offerFrame(image);
    await settle(null); // miss → onMiss throws

    expect(onMiss).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled(); // not re-reported as a detection error
    expect(s.inFlight).toBe(false);
  });
});

describe('createDetectionScheduler<T> generality (Note 1)', () => {
  it('works with a non-QR result type and a custom frame type', async () => {
    // A YOLO-shaped result + a custom frame — no QR types involved.
    interface Box {
      label: string;
      confidence: number;
    }
    let t = 0;
    const locked: Box[] = [];
    const detect = vi.fn((_frame: { id: number }) =>
      Promise.resolve<Box | null>({ label: 'chair', confidence: 0.9 })
    );
    const s = createDetectionScheduler<Box, { id: number }>({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 2,
      now: () => t++,
      onLocked: (box) => locked.push(box),
    });

    const flush = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };
    s.offerFrame({ id: 1 });
    await flush();
    s.offerFrame({ id: 2 });
    await flush();

    expect(locked).toEqual([{ label: 'chair', confidence: 0.9 }]);
  });
});
