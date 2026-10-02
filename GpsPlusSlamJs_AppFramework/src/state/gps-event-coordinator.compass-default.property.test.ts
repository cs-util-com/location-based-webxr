/**
 * Property: the default compass start happens exactly when a fix arrives
 * while recording, and at most once per handler (D30, 2026-10-02).
 *
 * Why this test matters:
 * The example tests pin single sequences. The invariant that keeps the
 * default from prompting outside an app's session, and from restarting the
 * sensor on every fix, is about ALL interleavings of recording and
 * not-recording fixes: the permission gate (3 queries, one per underlying
 * sensor) is reached iff some fix arrived while recording, and only once.
 * The queries are issued synchronously by the start, so the count is exact
 * without awaiting the async gate.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type { ReducersMapObject } from '@reduxjs/toolkit';
import { createGpsPositionHandler } from './gps-event-coordinator';
import { stopAbsoluteOrientationWatch } from '../sensors/absolute-orientation';
import type { SlamAppStore } from './create-slam-app-store';
import type { GpsPosition } from '../sensors/gps';

class InertSensor {
  addEventListener(): void {}
  start(): void {}
  stop(): void {}
  quaternion = null;
}

const win = window as unknown as Record<string, unknown>;

const position: GpsPosition = {
  lat: 1,
  lon: 2,
  altitude: null,
  accuracy: 5,
  altitudeAccuracy: null,
  heading: null,
  speed: null,
  timestamp: 0,
};

describe('createGpsPositionHandler default compass start (property)', () => {
  afterEach(() => {
    stopAbsoluteOrientationWatch();
    delete win.AbsoluteOrientationSensor;
  });

  it('queries the sensor permissions once iff a fix arrived while recording', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 12 }),
        fc.constantFrom<'auto' | 'off' | undefined>('auto', 'off', undefined),
        (recordingPerFix, mode) => {
          stopAbsoluteOrientationWatch();
          win.AbsoluteOrientationSensor = InertSensor;
          Object.defineProperty(window, 'isSecureContext', {
            value: true,
            configurable: true,
          });
          const query = vi.fn().mockResolvedValue({ state: 'granted' });
          Object.defineProperty(navigator, 'permissions', {
            value: { query },
            configurable: true,
          });

          let isRecording = false;
          // Only `recording.isRecording` is read before the start decision;
          // a null AR pose then ends each call before any dispatch.
          const store = {
            getState: () => ({ recording: { isRecording } }),
            dispatch: vi.fn(),
          } as unknown as SlamAppStore<ReducersMapObject>;
          const handle = createGpsPositionHandler({
            store,
            getArPose: () => null,
            ...(mode === undefined ? {} : { absoluteOrientation: mode }),
          });

          for (const recording of recordingPerFix) {
            isRecording = recording;
            handle(position);
          }

          const expected =
            mode !== 'off' && recordingPerFix.some((r) => r) ? 3 : 0;
          expect(query).toHaveBeenCalledTimes(expected);
        }
      )
    );
  });
});
