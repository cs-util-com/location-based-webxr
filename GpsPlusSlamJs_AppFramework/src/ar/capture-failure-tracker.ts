/**
 * Capture Failure Tracker
 *
 * Tracks consecutive image capture failures and notifies users when
 * multiple frames fail to capture (e.g., low memory on mobile devices).
 *
 * Field Test Readiness Issue #11: Silent image capture failures
 *
 * This module is a NAMED PRESET of `utils/failure-tracker`, nothing more — it
 * supplies the four capture-specific config values and returns the generic
 * tracker unchanged. It deliberately does NOT re-declare the tracker interface
 * or forward its methods; that boilerplate was removed 2026-07-30 because it
 * duplicated `FailureTracker` exactly while adding a layer to keep in sync.
 */

import {
  createFailureTracker,
  type FailureTracker,
} from '../utils/failure-tracker';

/**
 * Options for the capture failure tracker.
 */
export interface CaptureFailureTrackerConfig {
  /** Callback invoked once when consecutive failures reach the threshold. */
  onWarning: (message: string) => void;

  /**
   * Override the consecutive-failure threshold.
   * Defaults to {@link DEFAULT_CAPTURE_TRACKER_CONFIG}`.failureThreshold`.
   */
  failureThreshold?: number;
}

/**
 * Default configuration values.
 *
 * The threshold is deliberately HIGHER than the write tracker's 3: a missed
 * frame degrades a capture, whereas a failed write loses data, so capture
 * tolerates a longer failure run before warning the user.
 */
export const DEFAULT_CAPTURE_TRACKER_CONFIG = {
  failureThreshold: 5,
} as const;

/**
 * User-facing warning message when threshold is exceeded.
 */
export const CAPTURE_FAILURE_WARNING =
  'Multiple image captures failed. Device may be low on memory.';

/**
 * Create a failure tracker preset for image capture.
 *
 * @param config - Warning callback and optional threshold override
 * @returns A {@link FailureTracker} — the same shape every preset returns
 */
export function createCaptureFailureTracker(
  config: CaptureFailureTrackerConfig
): FailureTracker {
  return createFailureTracker({
    label: 'CaptureFailure',
    warningMessage: CAPTURE_FAILURE_WARNING,
    defaultThreshold: DEFAULT_CAPTURE_TRACKER_CONFIG.failureThreshold,
    onWarning: config.onWarning,
    failureThreshold: config.failureThreshold,
    logLevel: 'warn',
  });
}
