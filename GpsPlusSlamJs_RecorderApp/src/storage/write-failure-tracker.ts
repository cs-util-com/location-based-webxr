/**
 * Write Failure Tracker
 *
 * Tracks consecutive file write failures and notifies users when
 * storage may be having issues (e.g., disk full, permission revoked).
 *
 * Field Test Readiness Issue #7: Silent image write failures
 *
 * This module is a NAMED PRESET of the framework's `utils/failure-tracker`,
 * nothing more — it supplies the four write-specific config values and returns
 * the generic tracker unchanged. It deliberately does NOT re-declare the
 * tracker interface or forward its methods; that boilerplate was removed
 * 2026-07-30 because it duplicated `FailureTracker` exactly (and duplicated the
 * framework's capture preset a second time) while adding a layer to keep in
 * sync.
 */

import {
  createFailureTracker,
  type FailureTracker,
} from 'gps-plus-slam-app-framework/utils/failure-tracker';

/**
 * Options for the write failure tracker.
 */
interface WriteFailureTrackerConfig {
  /** Callback invoked once when consecutive failures reach the threshold. */
  onWarning: (message: string) => void;

  /**
   * Override the consecutive-failure threshold.
   * Defaults to {@link DEFAULT_TRACKER_CONFIG}`.failureThreshold`.
   */
  failureThreshold?: number;
}

/**
 * Default configuration values.
 *
 * The threshold is deliberately LOWER than the capture tracker's 5: a failed
 * write loses data, whereas a missed capture only degrades one, so writes warn
 * sooner.
 */
export const DEFAULT_TRACKER_CONFIG = {
  failureThreshold: 3,
} as const;

/**
 * User-facing warning message when threshold is exceeded.
 */
export const WRITE_FAILURE_WARNING =
  'Multiple frame write failures. Storage may be full or unavailable.';

/**
 * Create a failure tracker preset for file writes.
 *
 * Callers should pass the causing error to `recordFailure(error)` — this preset
 * logs at `error` level and includes it. The parameter is optional on
 * {@link FailureTracker}, so it is a convention here, not a type constraint.
 *
 * @param config - Warning callback and optional threshold override
 * @returns A {@link FailureTracker} — the same shape every preset returns
 */
export function createWriteFailureTracker(
  config: WriteFailureTrackerConfig
): FailureTracker {
  return createFailureTracker({
    label: 'WriteFailure',
    warningMessage: WRITE_FAILURE_WARNING,
    defaultThreshold: DEFAULT_TRACKER_CONFIG.failureThreshold,
    onWarning: config.onWarning,
    failureThreshold: config.failureThreshold,
    logLevel: 'error',
  });
}
