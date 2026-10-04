/**
 * Generic Failure Tracker Factory
 *
 * Shared pattern extracted from capture-failure-tracker and write-failure-tracker.
 * Tracks consecutive failures, warns the user once when a threshold is exceeded,
 * and supports session-level reset.
 */

import { createLogger } from './logger';

/**
 * Configuration for creating a failure tracker.
 */
export interface FailureTrackerConfig {
  /** Human-readable label used for log messages (e.g., 'CaptureFailure'). */
  label: string;

  /** Message passed to `onWarning` when the threshold is reached. */
  warningMessage: string;

  /** Default threshold used when `failureThreshold` is not provided. */
  defaultThreshold: number;

  /** Callback invoked once when consecutive failures reach the threshold. */
  onWarning: (message: string) => void;

  /** Optional override for the failure threshold. */
  failureThreshold?: number | undefined;

  /** Log level for each failure: 'warn' (default) or 'error'. */
  logLevel?: 'warn' | 'error';
}

/**
 * A failure tracker instance returned by `createFailureTracker`.
 */
export interface FailureTracker {
  /** Record a success — resets the consecutive failure counter. */
  recordSuccess(): void;

  /** Record a failure (optionally with an error for logging). */
  recordFailure(error?: unknown): void;

  /** Current number of consecutive failures. */
  getFailureCount(): number;

  /** Whether the warning has already been shown this session. */
  hasWarned(): boolean;

  /** Reset all state (for new sessions). */
  reset(): void;
}

/**
 * Create a generic failure tracker.
 *
 * @param config - Tracker configuration
 * @returns A FailureTracker instance
 */
export function createFailureTracker(
  config: FailureTrackerConfig
): FailureTracker {
  const {
    label,
    warningMessage,
    defaultThreshold,
    onWarning,
    logLevel = 'warn',
  } = config;

  const threshold = config.failureThreshold ?? defaultThreshold;
  const log = createLogger(label);

  let consecutiveFailures = 0;
  let warningShown = false;

  return {
    recordSuccess(): void {
      consecutiveFailures = 0;
      // Don't reset warningShown - once warned, don't spam user
    },

    recordFailure(error?: unknown): void {
      consecutiveFailures++;

      if (logLevel === 'error') {
        log.error(`${label} failure #${consecutiveFailures}:`, error);
      } else {
        log.warn(`${label} failure #${consecutiveFailures}`);
      }

      if (consecutiveFailures >= threshold && !warningShown) {
        warningShown = true;
        onWarning(warningMessage);
      }
    },

    getFailureCount(): number {
      return consecutiveFailures;
    },

    hasWarned(): boolean {
      return warningShown;
    },

    reset(): void {
      consecutiveFailures = 0;
      warningShown = false;
    },
  };
}
