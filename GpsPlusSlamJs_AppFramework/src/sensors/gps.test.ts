/**
 * GPS Module Tests
 *
 * Tests for the GPS sensor module, covering:
 * - requestOrientationPermission() branching logic
 * - startGpsWatch() and stopGpsWatch() lifecycle
 * - startOrientationWatch() and stopOrientationWatch() lifecycle
 *
 * Why these tests matter:
 * - The permission request logic has 4 distinct code paths that need verification
 * - iOS 13+ requires explicit permission; other platforms auto-grant
 * - Error handling during permission request must not crash the app
 * - Watch lifecycle must properly handle start/stop sequences
 *
 * @vitest-environment jsdom
 */

import {
  describe,
  it,
  expect,
  expectTypeOf,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  requestOrientationPermission,
  startGpsWatch,
  stopGpsWatch,
  startOrientationWatch,
  stopOrientationWatch,
} from './gps';
import type { GpsPosition, RawDeviceOrientation } from './gps';
import type { DeviceOrientation } from '../state/tracking-slice';
import {
  createMockGeolocation,
  createMockGeoPosition,
} from '../test-utils/browser-mocks';

describe('GPS Module', () => {
  describe('requestOrientationPermission', () => {
    // Store original DeviceOrientationEvent to restore after tests
    const originalDeviceOrientationEvent = globalThis.DeviceOrientationEvent;

    beforeEach(() => {
      // Reset mocks before each test
      vi.resetAllMocks();
    });

    afterEach(() => {
      // Restore original DeviceOrientationEvent after each test
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = originalDeviceOrientationEvent;
    });

    it('should return true when requestPermission is not defined (non-iOS)', async () => {
      // Non-iOS browsers don't have requestPermission
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {};

      const result = await requestOrientationPermission();

      expect(result).toBe(true);
    });

    it('should return true when requestPermission grants permission', async () => {
      // Simulate iOS granting permission
      const mockRequestPermission = vi.fn().mockResolvedValue('granted');
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {
        requestPermission: mockRequestPermission,
      };

      const result = await requestOrientationPermission();

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(result).toBe(true);
    });

    it('should return false when requestPermission denies permission', async () => {
      // Simulate iOS denying permission
      const mockRequestPermission = vi.fn().mockResolvedValue('denied');
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {
        requestPermission: mockRequestPermission,
      };

      const result = await requestOrientationPermission();

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(result).toBe(false);
    });

    it('should return false when requestPermission returns unknown value', async () => {
      // Edge case: unexpected permission value
      const mockRequestPermission = vi.fn().mockResolvedValue('prompt');
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {
        requestPermission: mockRequestPermission,
      };

      const result = await requestOrientationPermission();

      expect(result).toBe(false);
    });

    it('should return false when requestPermission throws an error', async () => {
      // Simulate permission request failure (e.g., user gesture required)
      const mockRequestPermission = vi
        .fn()
        .mockRejectedValue(new Error('User gesture required'));
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {
        requestPermission: mockRequestPermission,
      };

      const result = await requestOrientationPermission();

      expect(mockRequestPermission).toHaveBeenCalledOnce();
      expect(result).toBe(false);
    });

    it('should not call requestPermission if it is not a function', async () => {
      // Edge case: requestPermission exists but is not a function
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = {
        requestPermission: 'not a function',
      };

      const result = await requestOrientationPermission();

      expect(result).toBe(true);
    });
  });

  describe('startGpsWatch and stopGpsWatch', () => {
    let mockGeolocation: ReturnType<typeof createMockGeolocation>;

    beforeEach(() => {
      mockGeolocation = createMockGeolocation();
      vi.stubGlobal('navigator', { geolocation: mockGeolocation });
    });

    // NOTE: afterEach is required because the gps module maintains internal state
    // (watchId). beforeEach only creates fresh mocks but doesn't reset module state.
    // Without cleanup, a stale watchId would leak between tests.
    afterEach(() => {
      // Stop first while mocks still exist (clearWatch needs navigator.geolocation)
      stopGpsWatch();
      vi.unstubAllGlobals();
    });

    /**
     * Why this test matters:
     * startGpsWatch must call navigator.geolocation.watchPosition with the
     * Android-tuned options documented in
     * docs/2026-05-20-android-altitude-accuracy-audit.md (R1). These values
     * are easy to silently regress, so we pin them here.
     */
    it('calls watchPosition with high accuracy options', () => {
      const onPosition = vi.fn();

      startGpsWatch(onPosition);

      expect(mockGeolocation.watchPosition).toHaveBeenCalledOnce();
      const [, , options] = mockGeolocation.watchPosition.mock.calls[0];
      expect(options).toEqual({
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      });
    });

    /**
     * Why this test matters:
     * Position updates should be properly mapped to our GpsPosition interface.
     */
    it('maps GeolocationPosition to GpsPosition', () => {
      const onPosition = vi.fn();

      startGpsWatch(onPosition);

      // Get the success callback that was passed to watchPosition
      const successCallback = mockGeolocation.watchPosition.mock.calls[0][0];

      // Simulate a position update
      const mockPosition = createMockGeoPosition(50.0, 8.27, 100, 5);
      successCallback(mockPosition);

      expect(onPosition).toHaveBeenCalledWith({
        lat: 50.0,
        lon: 8.27,
        altitude: 100,
        accuracy: 5,
        altitudeAccuracy: 5,
        heading: null,
        speed: null,

        timestamp: expect.any(Number),
      });
    });

    /**
     * Why this test matters:
     * Error callback should be invoked when geolocation fails.
     */
    it('calls error callback on geolocation error', () => {
      const onPosition = vi.fn();
      const onError = vi.fn();

      startGpsWatch(onPosition, onError);

      // Get the error callback that was passed to watchPosition
      const errorCallback = mockGeolocation.watchPosition.mock.calls[0][1] as (
        error: GeolocationPositionError
      ) => void;

      // Simulate an error
      const mockError = {
        code: 1,
        message: 'User denied Geolocation',
      } as GeolocationPositionError;
      errorCallback(mockError);

      expect(onError).toHaveBeenCalledWith(mockError);
    });

    /**
     * Why this test matters:
     * stopGpsWatch must call clearWatch with the correct watch ID.
     */
    it('clears watch when stopGpsWatch is called', () => {
      const onPosition = vi.fn();
      mockGeolocation.watchPosition.mockReturnValue(42);

      startGpsWatch(onPosition);
      stopGpsWatch();

      expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(42);
    });

    /**
     * Why this test matters:
     * Calling stopGpsWatch when not watching should not throw.
     */
    it('stopGpsWatch does not throw when not watching', () => {
      expect(() => stopGpsWatch()).not.toThrow();
    });

    /**
     * Why this test matters:
     * If geolocation is not available, startGpsWatch should not throw.
     */
    it('handles missing geolocation API gracefully', () => {
      vi.stubGlobal('navigator', {});
      const onPosition = vi.fn();

      expect(() => startGpsWatch(onPosition)).not.toThrow();
    });

    /**
     * Why this test matters (Issue 4, 2026-02-27 user feedback):
     * startGpsWatch must be idempotent — calling it a second time with a
     * new handler must clear the previous watch first. Without this,
     * the warm-up watch would leak (never cleared via clearWatch) when
     * the recording watch starts, causing two concurrent watchPosition
     * callbacks and doubling battery drain.
     */
    it('clears previous watch when called again (idempotency)', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      mockGeolocation.watchPosition.mockReturnValueOnce(10);
      mockGeolocation.watchPosition.mockReturnValueOnce(20);

      startGpsWatch(handler1);
      startGpsWatch(handler2);

      // EXPECTED: clearWatch(10) called before starting watch 20
      expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(10);
      // Two watches were started
      expect(mockGeolocation.watchPosition).toHaveBeenCalledTimes(2);
    });
  });

  describe('startOrientationWatch and stopOrientationWatch', () => {
    let addEventListenerSpy: ReturnType<typeof vi.fn>;
    let removeEventListenerSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      addEventListenerSpy = vi.fn();
      removeEventListenerSpy = vi.fn();
      vi.stubGlobal('window', {
        addEventListener: addEventListenerSpy,
        removeEventListener: removeEventListenerSpy,
      });
    });

    // NOTE: afterEach is required because the gps module maintains internal state
    // (orientationHandler). beforeEach only creates fresh mocks but doesn't reset
    // module state. Without cleanup, stale handlers would leak between tests.
    afterEach(() => {
      vi.unstubAllGlobals();
      stopOrientationWatch();
    });

    /**
     * Why this test matters:
     * startOrientationWatch must register a deviceorientation event listener.
     */
    it('adds deviceorientation event listener', () => {
      const onOrientation = vi.fn();

      startOrientationWatch(onOrientation);

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'deviceorientation',
        expect.any(Function)
      );
    });

    /**
     * Why this test matters:
     * Orientation events should be properly mapped to our RawDeviceOrientation interface.
     */
    it('maps DeviceOrientationEvent to RawDeviceOrientation', () => {
      const onOrientation = vi.fn();

      startOrientationWatch(onOrientation);

      // Get the handler that was registered
      const handler = addEventListenerSpy.mock.calls[0][1] as (
        event: DeviceOrientationEvent
      ) => void;

      // Simulate an orientation event
      const mockEvent = {
        alpha: 45,
        beta: 10,
        gamma: -5,
        absolute: true,
      } as DeviceOrientationEvent;
      handler(mockEvent);

      expect(onOrientation).toHaveBeenCalledWith({
        alpha: 45,
        beta: 10,
        gamma: -5,
        absolute: true,
      });
    });

    /**
     * Why this test matters:
     * stopOrientationWatch must remove the event listener.
     */
    it('removes event listener when stopOrientationWatch is called', () => {
      const onOrientation = vi.fn();

      startOrientationWatch(onOrientation);
      stopOrientationWatch();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'deviceorientation',
        expect.any(Function)
      );
    });

    /**
     * Why this test matters:
     * Calling stopOrientationWatch when not watching should not throw.
     */
    it('stopOrientationWatch does not throw when not watching', () => {
      expect(() => stopOrientationWatch()).not.toThrow();
    });

    /**
     * Why this test matters:
     * Calling startOrientationWatch twice without stopping must remove the
     * previous listener first (mirroring startGpsWatch idempotency).
     * Without this guard, the old handler leaks on window.
     * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 7 (P4).
     */
    it('calling startOrientationWatch twice removes the previous listener', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      startOrientationWatch(cb1);
      startOrientationWatch(cb2);

      // The first handler should have been removed
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'deviceorientation',
        expect.any(Function)
      );
      // Two addEventListener calls total
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('RawDeviceOrientation vs DeviceOrientation', () => {
    /**
     * Why this test matters:
     * Two types share the name "DeviceOrientation" but live in different
     * modules. Both are NULLABLE per axis, and that is the point.
     *
     * REWRITTEN 2026-08-31. These tests used to pin the opposite - that the
     * tracking-slice type "resolved" the browser's nullable fields into
     * non-nullable numbers "for AR math". That resolution was the bug: it
     * substituted 0, which is a legal reading meaning "facing north, flat and
     * level", so nothing downstream could tell a missing compass from a
     * device pointing north - and the value feeds the core library's
     * tracking-restart rotation correction.
     *
     * What must now hold is that NEITHER type fabricates. The old assertion
     * that the two are structurally distinct is gone because the distinction
     * itself was the defect.
     */
    it('RawDeviceOrientation has nullable fields and absolute flag', () => {
      const raw: RawDeviceOrientation = {
        alpha: null,
        beta: null,
        gamma: null,
        absolute: false,
      };
      // Nullable fields are allowed
      expect(raw.alpha).toBeNull();
      expect(raw).toHaveProperty('absolute');
    });

    it('DeviceOrientation (tracking-slice) accepts a real reading', () => {
      const resolved: DeviceOrientation = {
        alpha: 180,
        beta: 45,
        gamma: -30,
        absolute: true,
      };
      expect(typeof resolved.alpha).toBe('number');
      expect(typeof resolved.absolute).toBe('boolean');
    });

    it('DeviceOrientation carries absence per axis rather than zeroing it', () => {
      // THE INVARIANT THIS FILE NOW EXISTS FOR. A phone with no magnetometer
      // reports a null alpha beside real beta/gamma, and that shape has to
      // survive all the way to the library, which pairs the axes across a
      // restart's two snapshots and refuses a pair it cannot trust on both
      // sides.
      const noCompass: DeviceOrientation = {
        alpha: null,
        beta: 45,
        gamma: -30,
        absolute: false,
      };
      expect(noCompass.alpha).toBeNull();
      expect(noCompass.beta).toBe(45);
    });

    it('the raw and resolved shapes are now compatible, deliberately', () => {
      // They used to be pinned as structurally DISTINCT, on the reasoning that
      // resolved values must be non-nullable. That reasoning produced the
      // fabrication bug, so the assertion is inverted rather than deleted -
      // a future refactor that re-splits them would reintroduce it.
      expectTypeOf<RawDeviceOrientation>().toMatchTypeOf<DeviceOrientation>();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * GpsPosition is created once from GeolocationPosition and never mutated.
     * Readonly prevents accidental field reassignment.
     */
    it('GpsPosition ≡ Readonly<GpsPosition>', () => {
      expectTypeOf<GpsPosition>().toEqualTypeOf<Readonly<GpsPosition>>();
    });
  });
});
