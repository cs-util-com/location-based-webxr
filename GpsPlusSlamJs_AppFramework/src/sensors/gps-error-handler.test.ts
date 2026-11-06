/**
 * GPS Error Handler Tests
 *
 * Tests for user-facing GPS error messages.
 *
 * Why these tests matter:
 * Field Test Readiness Issue #1 - GPS errors must be shown to the user
 * instead of only being logged to console. These tests verify that
 * proper error messages are generated for each GPS error type.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getGpsErrorMessage,
  createGpsErrorHandler,
  GPS_ERROR_CODES,
  GPS_ERROR_MESSAGES,
  GPS_ERROR_MESSAGE_UNKNOWN,
} from './gps-error-handler';

describe('GPS Error Handler', () => {
  describe('getGpsErrorMessage', () => {
    /**
     * Why this test matters:
     * When user denies GPS permission, they need clear guidance
     * on how to fix it (enable location in settings).
     */
    it('returns permission denied message for code 1', () => {
      const error = {
        code: GPS_ERROR_CODES.PERMISSION_DENIED,
        message: 'User denied',
      } as GeolocationPositionError;

      const message = getGpsErrorMessage(error);

      expect(message).toBe(
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.PERMISSION_DENIED]
      );
      expect(message).toContain('permission denied');
    });

    /**
     * Why this test matters:
     * Position unavailable (code 2) often means poor GPS signal.
     * Users should be told to move outdoors.
     */
    it('returns position unavailable message for code 2', () => {
      const error = {
        code: GPS_ERROR_CODES.POSITION_UNAVAILABLE,
        message: 'Position unavailable',
      } as GeolocationPositionError;

      const message = getGpsErrorMessage(error);

      expect(message).toBe(
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.POSITION_UNAVAILABLE]
      );
      expect(message).toContain('outdoors');
    });

    /**
     * Why this test matters:
     * Timeout errors (code 3) need guidance to check location services.
     */
    it('returns timeout message for code 3', () => {
      const error = {
        code: GPS_ERROR_CODES.TIMEOUT,
        message: 'Timeout',
      } as GeolocationPositionError;

      const message = getGpsErrorMessage(error);

      expect(message).toBe(GPS_ERROR_MESSAGES[GPS_ERROR_CODES.TIMEOUT]);
      expect(message).toContain('timeout');
    });

    /**
     * Why this test matters:
     * Unknown error codes should still return a sensible fallback message.
     */
    it('returns unknown message for unexpected error code', () => {
      const error = {
        code: 99,
        message: 'Unknown',
      } as GeolocationPositionError;

      const message = getGpsErrorMessage(error);

      expect(message).toBe(GPS_ERROR_MESSAGE_UNKNOWN);
    });
  });

  describe('createGpsErrorHandler', () => {
    /**
     * Why this test matters:
     * The handler must call showError with a user-friendly message.
     */
    it('calls showError with user-friendly message', () => {
      const mockShowError = vi.fn();
      const handler = createGpsErrorHandler(mockShowError);
      const error = {
        code: GPS_ERROR_CODES.PERMISSION_DENIED,
        message: 'User denied',
      } as GeolocationPositionError;

      handler(error);

      expect(mockShowError).toHaveBeenCalledExactlyOnceWith(
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.PERMISSION_DENIED]
      );
    });

    /**
     * Why this test matters:
     * Each error type should result in an appropriate message.
     */
    it('handles all GPS error codes correctly', () => {
      const mockShowError = vi.fn();
      const handler = createGpsErrorHandler(mockShowError);

      // Test all three error codes
      handler({
        code: GPS_ERROR_CODES.PERMISSION_DENIED,
        message: '',
      } as GeolocationPositionError);
      handler({
        code: GPS_ERROR_CODES.POSITION_UNAVAILABLE,
        message: '',
      } as GeolocationPositionError);
      handler({
        code: GPS_ERROR_CODES.TIMEOUT,
        message: '',
      } as GeolocationPositionError);

      expect(mockShowError).toHaveBeenCalledTimes(3);
      expect(mockShowError).toHaveBeenNthCalledWith(
        1,
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.PERMISSION_DENIED]
      );
      expect(mockShowError).toHaveBeenNthCalledWith(
        2,
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.POSITION_UNAVAILABLE]
      );
      expect(mockShowError).toHaveBeenNthCalledWith(
        3,
        GPS_ERROR_MESSAGES[GPS_ERROR_CODES.TIMEOUT]
      );
    });

    /**
     * Why this test matters:
     * Handler should not throw for any error type.
     */
    it('does not throw for any error code', () => {
      const mockShowError = vi.fn();
      const handler = createGpsErrorHandler(mockShowError);

      expect(() =>
        handler({
          code: GPS_ERROR_CODES.PERMISSION_DENIED,
          message: '',
        } as GeolocationPositionError)
      ).not.toThrow();
      expect(() =>
        handler({
          code: GPS_ERROR_CODES.POSITION_UNAVAILABLE,
          message: '',
        } as GeolocationPositionError)
      ).not.toThrow();
      expect(() =>
        handler({
          code: GPS_ERROR_CODES.TIMEOUT,
          message: '',
        } as GeolocationPositionError)
      ).not.toThrow();
      expect(() =>
        handler({ code: 99, message: '' } as GeolocationPositionError)
      ).not.toThrow();
    });
  });
});
