/**
 * Tests for the AbsoluteOrientationSensor capture module (plan §5.1, §4c unit 5).
 *
 * Why these tests matter:
 * This is the device seam for the independent-north instrumentation. The real
 * sensor only exists on Chrome Android, so correctness is proven here against a
 * FAKE AbsoluteOrientationSensor: a `reading` must cache the quaternion + screen
 * angle; unavailable platforms and denied permissions must degrade to a clean,
 * reported no-op (iOS/Safari/desktop keep working); `stop` must be idempotent.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startAbsoluteOrientationWatch,
  ensureAbsoluteOrientationWatch,
  stopAbsoluteOrientationWatch,
  getLatestAbsoluteOrientation,
  isAbsoluteOrientationAvailable,
} from './absolute-orientation';

type Listener = (event?: unknown) => void;

class FakeAbsoluteOrientationSensor {
  static lastInstance: FakeAbsoluteOrientationSensor | null = null;
  quaternion: number[] | null = null;
  started = false;
  stopped = false;
  options: unknown;
  private listeners = new Map<string, Listener[]>();

  constructor(options?: unknown) {
    this.options = options;
    FakeAbsoluteOrientationSensor.lastInstance = this;
  }
  addEventListener(type: string, listener: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  emit(type: string, event?: unknown): void {
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

function installSensor(): void {
  (window as unknown as Record<string, unknown>).AbsoluteOrientationSensor =
    FakeAbsoluteOrientationSensor;
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  });
}

function setPermissions(state: PermissionState): void {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
  });
}

function setScreenAngle(angle: number): void {
  Object.defineProperty(screen, 'orientation', {
    value: { angle },
    configurable: true,
  });
}

describe('AbsoluteOrientationSensor capture', () => {
  beforeEach(() => {
    FakeAbsoluteOrientationSensor.lastInstance = null;
    stopAbsoluteOrientationWatch();
  });

  afterEach(() => {
    stopAbsoluteOrientationWatch();
    delete (window as unknown as Record<string, unknown>)
      .AbsoluteOrientationSensor;
  });

  describe('availability', () => {
    it('is unavailable without the API', () => {
      delete (window as unknown as Record<string, unknown>)
        .AbsoluteOrientationSensor;
      expect(isAbsoluteOrientationAvailable()).toBe(false);
    });

    it('is unavailable in an insecure context even if the API exists', () => {
      (window as unknown as Record<string, unknown>).AbsoluteOrientationSensor =
        FakeAbsoluteOrientationSensor;
      Object.defineProperty(window, 'isSecureContext', {
        value: false,
        configurable: true,
      });
      expect(isAbsoluteOrientationAvailable()).toBe(false);
    });

    it('reports unavailable via onStatus and stays a no-op (iOS/Safari/desktop path)', async () => {
      delete (window as unknown as Record<string, unknown>)
        .AbsoluteOrientationSensor;
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      expect(onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'unavailable' })
      );
      expect(getLatestAbsoluteOrientation()).toBeNull();
    });

    it('honours the documented never-throws contract even when the onStatus callback itself throws', async () => {
      // Why this test matters (PR #124 review): startAbsoluteOrientationWatch
      // documents "Never throws", but onStatus is caller-supplied — an
      // unguarded throw from it rejected the start promise (and would surface
      // as an uncaught error from the sensor event listeners). The status
      // reporter must isolate the consumer callback.
      delete (window as unknown as Record<string, unknown>)
        .AbsoluteOrientationSensor;
      await expect(
        startAbsoluteOrientationWatch(() => {
          throw new Error('consumer status handler boom');
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('capture', () => {
    beforeEach(() => {
      installSensor();
      setPermissions('granted');
      setScreenAngle(90);
    });

    it('caches the quaternion + screen angle on a reading', async () => {
      await startAbsoluteOrientationWatch();
      const inst = FakeAbsoluteOrientationSensor.lastInstance!;
      expect(inst.started).toBe(true);

      inst.quaternion = [0.1, 0.2, 0.3, 0.9];
      inst.emit('reading');

      const reading = getLatestAbsoluteOrientation();
      expect(reading).not.toBeNull();
      expect(reading!.quaternion).toEqual([0.1, 0.2, 0.3, 0.9]);
      expect(reading!.referenceFrame).toBe('device');
      expect(reading!.screenAngleDeg).toBe(90);
      expect(typeof reading!.timestamp).toBe('number');
    });

    it('constructs the sensor with the raw device frame and the tuned frequency', async () => {
      await startAbsoluteOrientationWatch();
      expect(FakeAbsoluteOrientationSensor.lastInstance!.options).toEqual({
        frequency: 20,
        referenceFrame: 'device',
      });
    });

    it('reports active on activate', async () => {
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      FakeAbsoluteOrientationSensor.lastInstance!.emit('activate');
      expect(onStatus).toHaveBeenCalledWith({ state: 'active' });
    });

    it('ignores a reading with a missing/short quaternion', async () => {
      await startAbsoluteOrientationWatch();
      const inst = FakeAbsoluteOrientationSensor.lastInstance!;
      inst.quaternion = null;
      inst.emit('reading');
      expect(getLatestAbsoluteOrientation()).toBeNull();
      inst.quaternion = [1, 2]; // too short
      inst.emit('reading');
      expect(getLatestAbsoluteOrientation()).toBeNull();
    });

    it('reports error and clears the cache on a sensor error', async () => {
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      const inst = FakeAbsoluteOrientationSensor.lastInstance!;
      inst.quaternion = [0, 0, 0, 1];
      inst.emit('reading');
      expect(getLatestAbsoluteOrientation()).not.toBeNull();

      inst.emit('error', { error: { name: 'NotReadableError' } });
      expect(onStatus).toHaveBeenCalledWith({
        state: 'error',
        reason: 'NotReadableError',
      });
      expect(getLatestAbsoluteOrientation()).toBeNull();
    });

    // Why this matters (PR #128 review): a real AbsoluteOrientationSensor can
    // still deliver a queued event after `stop()` returns (the spec does not
    // guarantee listener removal on stop). Without a current-instance guard,
    // such a late `reading`/`error`/`activate` from a SUPERSEDED instance writes
    // stale data into `latest` or emits a stale status from the previous session.
    it('ignores listener callbacks from a superseded sensor after stop()', async () => {
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      const inst = FakeAbsoluteOrientationSensor.lastInstance!;
      inst.quaternion = [0, 0, 0, 1];
      inst.emit('reading');
      expect(getLatestAbsoluteOrientation()).not.toBeNull();

      stopAbsoluteOrientationWatch();
      onStatus.mockClear();

      // The old instance's late/queued events must be dropped.
      inst.quaternion = [0.5, 0.5, 0.5, 0.5];
      inst.emit('reading');
      inst.emit('error', { error: { name: 'NotReadableError' } });
      inst.emit('activate');

      expect(getLatestAbsoluteOrientation()).toBeNull();
      expect(onStatus).not.toHaveBeenCalled();
    });
  });

  describe('permissions', () => {
    beforeEach(() => {
      installSensor();
      setScreenAngle(0);
    });

    it('reports unavailable when a required permission is denied', async () => {
      setPermissions('denied');
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      expect(onStatus).toHaveBeenCalledWith({
        state: 'unavailable',
        reason: 'sensor permission denied',
      });
      expect(FakeAbsoluteOrientationSensor.lastInstance).toBeNull();
    });

    it('proceeds when permissions are in the prompt state', async () => {
      setPermissions('prompt');
      await startAbsoluteOrientationWatch();
      expect(FakeAbsoluteOrientationSensor.lastInstance).not.toBeNull();
    });

    it('proceeds when the Permissions API itself is absent', async () => {
      Object.defineProperty(navigator, 'permissions', {
        value: undefined,
        configurable: true,
      });
      await startAbsoluteOrientationWatch();
      expect(FakeAbsoluteOrientationSensor.lastInstance).not.toBeNull();
    });

    // Why this matters (PR #129 review): some browsers/webviews throw a
    // SYNCHRONOUS TypeError from `permissions.query({name:'magnetometer'})`
    // because the permission name is unsupported, instead of returning a
    // rejected promise. A synchronous throw bypasses the per-query `.catch()`
    // best-effort 'granted' fallback, so the watch would abort with `error` and
    // never construct the sensor — even though the sensor itself may work fine.
    // It must be tolerated exactly like a rejected query (best-effort proceed).
    it('tolerates a synchronous throw from permissions.query (still constructs)', async () => {
      Object.defineProperty(navigator, 'permissions', {
        value: {
          query: vi.fn(() => {
            throw new TypeError(
              "'magnetometer' is not a valid permission name"
            );
          }),
        },
        configurable: true,
      });
      const onStatus = vi.fn();
      await startAbsoluteOrientationWatch(onStatus);
      expect(FakeAbsoluteOrientationSensor.lastInstance).not.toBeNull();
      expect(onStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ state: 'error' })
      );
    });
  });

  describe('construction failure', () => {
    it('reports error (never throws) when the sensor constructor throws', async () => {
      class ThrowingSensor {
        constructor() {
          throw new DOMException(
            'blocked by Permissions-Policy',
            'SecurityError'
          );
        }
      }
      (window as unknown as Record<string, unknown>).AbsoluteOrientationSensor =
        ThrowingSensor;
      Object.defineProperty(window, 'isSecureContext', {
        value: true,
        configurable: true,
      });
      setPermissions('granted');
      const onStatus = vi.fn();
      await expect(
        startAbsoluteOrientationWatch(onStatus)
      ).resolves.toBeUndefined();
      expect(onStatus).toHaveBeenCalledWith({
        state: 'error',
        reason: 'SecurityError',
      });
      expect(getLatestAbsoluteOrientation()).toBeNull();
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      installSensor();
      setPermissions('granted');
      setScreenAngle(0);
    });

    it('stop is idempotent and clears the latest reading', async () => {
      await startAbsoluteOrientationWatch();
      const inst = FakeAbsoluteOrientationSensor.lastInstance!;
      inst.quaternion = [0, 0, 0, 1];
      inst.emit('reading');
      expect(getLatestAbsoluteOrientation()).not.toBeNull();

      stopAbsoluteOrientationWatch();
      expect(inst.stopped).toBe(true);
      expect(getLatestAbsoluteOrientation()).toBeNull();
      // Second stop must not throw.
      expect(() => stopAbsoluteOrientationWatch()).not.toThrow();
    });

    it('restart stops the previous sensor first (no leak)', async () => {
      await startAbsoluteOrientationWatch();
      const first = FakeAbsoluteOrientationSensor.lastInstance!;
      await startAbsoluteOrientationWatch();
      const second = FakeAbsoluteOrientationSensor.lastInstance!;
      expect(first).not.toBe(second);
      expect(first.stopped).toBe(true);
    });

    it('does not install the sensor when stopped during the async permission check', async () => {
      // The recorder starts this watch fire-and-forget. The real work happens
      // only AFTER awaiting permission queries, so a stop()/restart that lands
      // during that await must invalidate the in-flight start — otherwise it
      // resumes and installs a live sensor/listener chain that teardown no
      // longer owns (stale compass updates leaking into the next session).
      let resolveQuery!: (value: { state: PermissionState }) => void;
      const queryPromise = new Promise<{ state: PermissionState }>((r) => {
        resolveQuery = r;
      });
      Object.defineProperty(navigator, 'permissions', {
        value: { query: vi.fn().mockReturnValue(queryPromise) },
        configurable: true,
      });

      const startP = startAbsoluteOrientationWatch(); // awaits the permission gate
      stopAbsoluteOrientationWatch(); // operator stops before it resolves
      resolveQuery({ state: 'granted' }); // permission now resolves granted
      await startP;

      // The stale start must not have installed a sensor.
      expect(FakeAbsoluteOrientationSensor.lastInstance).toBeNull();
      expect(getLatestAbsoluteOrientation()).toBeNull();
    });
  });

  // Why these tests matter (compass cold start default, D30, 2026-10-02):
  // `createGpsPositionHandler` now starts the watch on its own. An app that
  // already started it (the Recorder passes its HUD status callback) must NOT
  // be restarted underneath: a restart stops the live sensor, clears the
  // cached reading and silently swaps the app's `onStatus` for the
  // handler's. `ensure` is the start that leaves a requested watch alone.
  describe('ensureAbsoluteOrientationWatch', () => {
    beforeEach(() => {
      installSensor();
      setPermissions('granted');
      setScreenAngle(0);
    });

    it('starts the watch when none was requested', async () => {
      await ensureAbsoluteOrientationWatch();
      expect(FakeAbsoluteOrientationSensor.lastInstance?.started).toBe(true);
    });

    it('leaves a watch the app already started alone (sensor, reading and status callback kept)', async () => {
      const appStatus = vi.fn();
      await startAbsoluteOrientationWatch(appStatus);
      const appSensor = FakeAbsoluteOrientationSensor.lastInstance!;
      appSensor.quaternion = [0, 0, 0, 1];
      appSensor.emit('reading');

      const handlerStatus = vi.fn();
      await ensureAbsoluteOrientationWatch(handlerStatus);

      expect(FakeAbsoluteOrientationSensor.lastInstance).toBe(appSensor);
      expect(appSensor.stopped).toBe(false);
      expect(getLatestAbsoluteOrientation()).not.toBeNull();
      appSensor.emit('activate');
      expect(appStatus).toHaveBeenCalledWith({ state: 'active' });
      expect(handlerStatus).not.toHaveBeenCalled();
    });

    it('does not restart a start that is still awaiting its permission gate', async () => {
      const query = vi.fn().mockResolvedValue({ state: 'granted' });
      Object.defineProperty(navigator, 'permissions', {
        value: { query },
        configurable: true,
      });
      const pending = startAbsoluteOrientationWatch();
      await ensureAbsoluteOrientationWatch();
      await pending;
      // One start = one query per underlying sensor (3), and one sensor.
      expect(query).toHaveBeenCalledTimes(3);
      expect(FakeAbsoluteOrientationSensor.lastInstance?.started).toBe(true);
    });

    it('starts again after an explicit stop (an app teardown ends the request)', async () => {
      await startAbsoluteOrientationWatch();
      const first = FakeAbsoluteOrientationSensor.lastInstance!;
      stopAbsoluteOrientationWatch();
      await ensureAbsoluteOrientationWatch();
      expect(FakeAbsoluteOrientationSensor.lastInstance).not.toBe(first);
      expect(FakeAbsoluteOrientationSensor.lastInstance?.started).toBe(true);
    });

    it('does not retry an unavailable platform on every call', async () => {
      delete (window as unknown as Record<string, unknown>)
        .AbsoluteOrientationSensor;
      const onStatus = vi.fn();
      await ensureAbsoluteOrientationWatch(onStatus);
      await ensureAbsoluteOrientationWatch(onStatus);
      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'unavailable' })
      );
    });
  });
});
