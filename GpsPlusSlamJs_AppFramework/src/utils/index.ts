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
export { listFormatter } from './list-formatter.js';
export {
  validateOptionFields,
  type FieldSpec,
  type GroupSpec,
} from './validate-option-fields.js';
export { guardSliderAgainstScroll } from './slider-scroll-guard.js';
export { QR_OPTIONS, generateQr, renderQrSvg } from './qr-render.js';
