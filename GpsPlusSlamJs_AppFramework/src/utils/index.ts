/**
 * Utils module — Logger, fused-path, failure tracker, concurrency, formatters,
 * persisted-options validation.
 */

export {
  createLogger,
  LogLevel,
  getLogBuffer,
  clearLogBuffer,
  getGlobalLogLevel,
  setGlobalLogLevel,
  subscribeToLogs,
  type Logger,
  type LogEntry,
} from './logger.js';
export {
  fusedGpsFromOdom,
  computeFusedPath,
  type FusedPathInput,
} from './fused-path.js';
export {
  createFailureTracker,
  type FailureTracker,
  type FailureTrackerConfig,
} from './failure-tracker.js';
export { mapWithConcurrencyLimit } from './concurrency.js';
export { geodesicAngleRad } from './geodesic-angle.js';
export { formatFileSize } from './format-file-size.js';
// Re-exported so this package's public surface names it, but consumers should
// DEEP-import `gps-plus-slam-app-framework/utils/escape-html`: reaching five
// lines of string replacement through this barrel pulls in the logger and
// everything else listed here.
export { escapeHtml } from './escape-html.js';
export { listFormatter } from './list-formatter.js';
export {
  validateOptionFields,
  type FieldSpec,
  type GroupSpec,
} from './validate-option-fields.js';
export { guardSliderAgainstScroll } from './slider-scroll-guard.js';
