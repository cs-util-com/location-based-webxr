/**
 * Write Failure Tracker Tests
 *
 * Tests for the write failure tracking mechanism that warns users
 * when multiple consecutive write failures occur.
 *
 * Why these tests matter:
 * - Ensures users are warned before silently losing data
 * - Validates that transient failures don't cause false alarms
 * - Confirms warning is shown only once to avoid spamming
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWriteFailureTracker,
  DEFAULT_TRACKER_CONFIG,
  WRITE_FAILURE_WARNING,
} from './write-failure-tracker';
import type { FailureTracker } from 'gps-plus-slam-app-framework/utils/failure-tracker';

describe('WriteFailureTracker', () => {
  let tracker: FailureTracker;
  let onWarning: (message: string) => void;

  beforeEach(() => {
    onWarning = vi.fn();
    tracker = createWriteFailureTracker({ onWarning });
  });

  describe('initial state', () => {
    it('starts with zero failure count', () => {
      expect(tracker.getFailureCount()).toBe(0);
    });

    it('starts with hasWarned false', () => {
      expect(tracker.hasWarned()).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count to zero', () => {
      tracker.recordFailure(new Error('fail 1'));
      tracker.recordFailure(new Error('fail 2'));
      expect(tracker.getFailureCount()).toBe(2);

      tracker.recordSuccess();
      expect(tracker.getFailureCount()).toBe(0);
    });

    it('does not reset hasWarned flag (avoid re-warning)', () => {
      // Exceed threshold to trigger warning
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }
      expect(tracker.hasWarned()).toBe(true);

      // Success should NOT reset the warning flag
      tracker.recordSuccess();
      expect(tracker.hasWarned()).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', () => {
      tracker.recordFailure(new Error('test'));
      expect(tracker.getFailureCount()).toBe(1);

      tracker.recordFailure(new Error('test'));
      expect(tracker.getFailureCount()).toBe(2);
    });

    it('does not warn below threshold', () => {
      // Default threshold is 3, so 2 failures should not warn
      tracker.recordFailure(new Error('fail 1'));
      tracker.recordFailure(new Error('fail 2'));

      expect(onWarning).not.toHaveBeenCalled();
      expect(tracker.hasWarned()).toBe(false);
    });

    it('warns when threshold is reached', () => {
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }

      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(WRITE_FAILURE_WARNING);
      expect(tracker.hasWarned()).toBe(true);
    });

    it('only warns once even with many failures', () => {
      // Exceed threshold multiple times
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold * 3; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }

      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom threshold', () => {
    it('respects custom failureThreshold', () => {
      const customTracker = createWriteFailureTracker({
        onWarning,
        failureThreshold: 5,
      });

      // 4 failures should not warn
      for (let i = 0; i < 4; i++) {
        customTracker.recordFailure(new Error(`fail ${i}`));
      }
      expect(onWarning).not.toHaveBeenCalled();

      // 5th failure should warn
      customTracker.recordFailure(new Error('fail 5'));
      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('resets failure count to zero', () => {
      tracker.recordFailure(new Error('fail'));
      tracker.reset();
      expect(tracker.getFailureCount()).toBe(0);
    });

    it('resets hasWarned flag', () => {
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }
      expect(tracker.hasWarned()).toBe(true);

      tracker.reset();
      expect(tracker.hasWarned()).toBe(false);
    });

    it('allows warning to be shown again after reset', () => {
      // First round of failures
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }
      expect(onWarning).toHaveBeenCalledTimes(1);

      // Reset for new session
      tracker.reset();

      // Second round of failures
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }
      expect(onWarning).toHaveBeenCalledTimes(2);
    });
  });

  describe('mixed success/failure sequences', () => {
    it('resets count after success interrupts failures', () => {
      tracker.recordFailure(new Error('fail 1'));
      tracker.recordFailure(new Error('fail 2'));
      tracker.recordSuccess(); // Reset
      tracker.recordFailure(new Error('fail 3'));

      expect(tracker.getFailureCount()).toBe(1);
      expect(onWarning).not.toHaveBeenCalled();
    });

    it('warns after threshold consecutive failures following success', () => {
      tracker.recordFailure(new Error('fail 1'));
      tracker.recordSuccess();

      // Now 3 consecutive failures
      for (let i = 0; i < DEFAULT_TRACKER_CONFIG.failureThreshold; i++) {
        tracker.recordFailure(new Error(`fail ${i}`));
      }

      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });
});
