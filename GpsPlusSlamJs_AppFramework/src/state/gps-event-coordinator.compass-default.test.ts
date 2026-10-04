/**
 * The compass cold start is on by default wherever GPS fixes are fed
 * (owner decision D30, 2026-10-02; plan
 * GpsPlusSlamJs_Docs/docs/2026-10-02-1830-compass-cold-start-default-plan.md).
 *
 * Why these tests matter:
 * The core's cold-start yaw override is on by default but abstains silently
 * on fixes without `rawAbsoluteOrientation`, and only the Recorder and
 * OsmDemo started the sensor. `createGpsPositionHandler` now starts it
 * itself, which reaches apps that never touched a sensor before (Tour
 * Viewer, MinimalExample, AnchorStarter). So these tests pin, through the
 * REAL watch with a fake `window.AbsoluteOrientationSensor` (the global is
 * the injection point the sensor module's own tests use; no production seam
 * was added):
 *  - the default is invisible where the sensor does not exist (iOS, Safari,
 *    Firefox, desktop, headless e2e): no permission query, no
 *    `DeviceOrientationEvent.requestPermission`, no throw, status
 *    `unavailable`;
 *  - nothing happens when the handler is CREATED (two apps create it at page
 *    load); the watch starts at the first fix that arrives while recording,
 *    i.e. inside the app's own AR/recording session;
 *  - a fix then carries the reading; `'off'` opts out; an app's own watch
 *    (the Recorder's HUD status callback) is never restarted underneath it.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReducersMapObject } from '@reduxjs/toolkit';
import { recordGpsEvent, type RecordGpsEventPayload } from 'gps-plus-slam-js';
import {
  createGpsPositionHandler,
  resetCoordinatorState,
} from './gps-event-coordinator';
import {
  startAbsoluteOrientationWatch,
  stopAbsoluteOrientationWatch,
  type AbsoluteOrientationStatus,
} from '../sensors/absolute-orientation';
import { createSlamAppStore, type SlamAppStore } from './create-slam-app-store';
import { startSession } from './recording-slice';
import { NullStorageBackend } from '../storage/null-storage-backend';
import type { ARPose } from '../ar/webxr-session';
import type { GpsPosition } from '../sensors/gps';

type Listener = (event?: unknown) => void;

class FakeSensor {
  static instances: FakeSensor[] = [];
  quaternion: number[] | null = null;
  started = false;
  stopped = false;
  private listeners = new Map<string, Listener[]>();
  constructor() {
    FakeSensor.instances.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
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

const win = window as unknown as Record<string, unknown>;

/** The prompt-capable APIs: every call to them is recorded. */
let permissionsQuery: ReturnType<typeof vi.fn>;
let requestOrientationPermission: ReturnType<typeof vi.fn>;

function installPlatform(opts: {
  sensor: boolean;
  secure: boolean;
  /** iOS 13+ exposes `DeviceOrientationEvent.requestPermission`. */
  iosRequestPermission: boolean;
}): void {
  if (opts.sensor) win.AbsoluteOrientationSensor = FakeSensor;
  else delete win.AbsoluteOrientationSensor;
  Object.defineProperty(window, 'isSecureContext', {
    value: opts.secure,
    configurable: true,
  });
  permissionsQuery = vi.fn().mockResolvedValue({ state: 'granted' });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: permissionsQuery },
    configurable: true,
  });
  requestOrientationPermission = vi.fn().mockResolvedValue('granted');
  win.DeviceOrientationEvent = opts.iosRequestPermission
    ? Object.assign(function DeviceOrientationEvent() {}, {
        requestPermission: requestOrientationPermission,
      })
    : function DeviceOrientationEvent() {};
}

const arPose: ARPose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

let fixCount = 0;
function fix(): GpsPosition {
  fixCount += 1;
  return {
    lat: 48.8566 + fixCount * 1e-5,
    lon: 2.3522,
    altitude: 35,
    accuracy: 5,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    timestamp: 1_000 * fixCount,
  };
}

/** Lets the watch's async permission gate settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function recordingStore(): SlamAppStore<ReducersMapObject> {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  store.dispatch(
    startSession({ scenarioName: 't', sessionName: 's', startTime: 0 })
  );
  return store;
}

function handlerFor(
  store: SlamAppStore<ReducersMapObject>,
  extra: Partial<Parameters<typeof createGpsPositionHandler>[0]> = {}
): { handle: (p: GpsPosition) => void; payloads: RecordGpsEventPayload[] } {
  const payloads: RecordGpsEventPayload[] = [];
  const handle = createGpsPositionHandler({
    store,
    getArPose: () => arPose,
    recordFix: (payload) => {
      payloads.push(payload);
      store.dispatch(recordGpsEvent(payload));
    },
    ...extra,
  });
  return { handle, payloads };
}

describe('createGpsPositionHandler: compass cold start by default', () => {
  beforeEach(() => {
    stopAbsoluteOrientationWatch();
    resetCoordinatorState();
    FakeSensor.instances = [];
    fixCount = 0;
  });

  afterEach(() => {
    stopAbsoluteOrientationWatch();
    delete win.AbsoluteOrientationSensor;
    delete win.DeviceOrientationEvent;
  });

  describe.each([
    {
      platform: 'iOS Safari (requestPermission exists, no sensor)',
      sensor: false,
      secure: true,
      iosRequestPermission: true,
    },
    {
      platform: 'desktop / Firefox / headless e2e (no sensor)',
      sensor: false,
      secure: true,
      iosRequestPermission: false,
    },
    {
      platform: 'insecure context with the sensor API present',
      sensor: true,
      secure: false,
      iosRequestPermission: false,
    },
  ])('on $platform', (platformOpts) => {
    it('does nothing observable: no permission request, no throw, status unavailable, fixes recorded without a reading', async () => {
      installPlatform(platformOpts);
      const statuses: AbsoluteOrientationStatus[] = [];
      const store = recordingStore();
      const { handle, payloads } = handlerFor(store, {
        onAbsoluteOrientationStatus: (s) => statuses.push(s),
      });

      expect(() => {
        handle(fix());
        handle(fix());
        handle(fix());
      }).not.toThrow();
      await settle();

      expect(permissionsQuery).not.toHaveBeenCalled();
      expect(requestOrientationPermission).not.toHaveBeenCalled();
      expect(FakeSensor.instances).toHaveLength(0);
      expect(statuses).toEqual([
        expect.objectContaining({ state: 'unavailable' }),
      ]);
      expect(payloads).toHaveLength(3);
      for (const p of payloads)
        expect(p.rawAbsoluteOrientation).toBeUndefined();
    });
  });

  describe('on an Android-like platform (sensor present, secure context)', () => {
    beforeEach(() => {
      installPlatform({
        sensor: true,
        secure: true,
        iosRequestPermission: true,
      });
    });

    it('creating the handler touches no sensor and no permission (apps create it at page load)', async () => {
      handlerFor(recordingStore());
      await settle();
      expect(permissionsQuery).not.toHaveBeenCalled();
      expect(FakeSensor.instances).toHaveLength(0);
    });

    it('a fix while NOT recording starts nothing', async () => {
      const store = createSlamAppStore({
        storageBackend: new NullStorageBackend(),
      });
      const { handle } = handlerFor(store);
      handle(fix());
      await settle();
      expect(permissionsQuery).not.toHaveBeenCalled();
      expect(FakeSensor.instances).toHaveLength(0);
    });

    it('starts the sensor once at the first recording fix; later fixes carry its reading; never asks DeviceOrientationEvent', async () => {
      const statuses: AbsoluteOrientationStatus[] = [];
      const { handle, payloads } = handlerFor(recordingStore(), {
        onAbsoluteOrientationStatus: (s) => statuses.push(s),
      });

      handle(fix());
      await settle();
      expect(FakeSensor.instances).toHaveLength(1);
      const sensor = FakeSensor.instances[0]!;
      expect(sensor.started).toBe(true);
      // The first fix precedes any reading (the sensor starts asynchronously).
      expect(payloads[0]!.rawAbsoluteOrientation).toBeUndefined();

      sensor.emit('activate');
      sensor.quaternion = [0.1, 0.2, 0.3, 0.9];
      sensor.emit('reading');
      handle(fix());
      handle(fix());
      await settle();

      expect(FakeSensor.instances).toHaveLength(1);
      expect(permissionsQuery).toHaveBeenCalledTimes(3); // one start
      expect(requestOrientationPermission).not.toHaveBeenCalled();
      expect(statuses).toEqual([{ state: 'active' }]);
      expect(payloads).toHaveLength(3);
      for (const p of payloads.slice(1)) {
        expect(p.rawAbsoluteOrientation?.quaternion).toEqual([
          0.1, 0.2, 0.3, 0.9,
        ]);
      }
    });

    it("absoluteOrientation: 'off' never starts the sensor", async () => {
      const { handle, payloads } = handlerFor(recordingStore(), {
        absoluteOrientation: 'off',
      });
      handle(fix());
      handle(fix());
      await settle();
      expect(permissionsQuery).not.toHaveBeenCalled();
      expect(FakeSensor.instances).toHaveLength(0);
      expect(payloads).toHaveLength(2);
      for (const p of payloads)
        expect(p.rawAbsoluteOrientation).toBeUndefined();
    });

    it('rejects an unknown absoluteOrientation value instead of starting the sensor', () => {
      expect(() =>
        handlerFor(recordingStore(), {
          absoluteOrientation: 'Off' as unknown as 'off',
        })
      ).toThrow(TypeError);
      expect(FakeSensor.instances).toHaveLength(0);
    });

    it("keeps a watch the app started itself (the Recorder's HUD callback is not replaced)", async () => {
      const appStatus = vi.fn();
      const handlerStatus = vi.fn();
      const { handle } = handlerFor(recordingStore(), {
        onAbsoluteOrientationStatus: handlerStatus,
      });
      await startAbsoluteOrientationWatch(appStatus);
      const appSensor = FakeSensor.instances[0]!;

      handle(fix());
      await settle();

      expect(FakeSensor.instances).toEqual([appSensor]);
      expect(appSensor.stopped).toBe(false);
      appSensor.emit('activate');
      expect(appStatus).toHaveBeenCalledWith({ state: 'active' });
      expect(handlerStatus).not.toHaveBeenCalled();
    });

    it('a sensor constructor that throws leaves the handler recording, status error', async () => {
      win.AbsoluteOrientationSensor = class {
        constructor() {
          throw new DOMException('blocked', 'SecurityError');
        }
      };
      const statuses: AbsoluteOrientationStatus[] = [];
      const { handle, payloads } = handlerFor(recordingStore(), {
        onAbsoluteOrientationStatus: (s) => statuses.push(s),
      });
      expect(() => handle(fix())).not.toThrow();
      await settle();
      handle(fix());
      expect(payloads).toHaveLength(2);
      expect(statuses).toEqual([{ state: 'error', reason: 'SecurityError' }]);
    });
  });
});
