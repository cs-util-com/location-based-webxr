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
// --- escape-html and toast-core are DELIBERATELY NOT re-exported here ---
//
// Both are reached as their own subpaths — `.../utils/escape-html` and
// `.../utils/toast-core` — which the package's `exports` map already serves via
// `./utils/*`, and both are listed as knip entries so `check:deadcode` treats
// them as the public entry points they are.
//
// Barrelling them would have put them in `src/index.ts`'s `export *` and so on
// the package's ROOT export surface, which is the largest possible version of
// the cost DEC-H2 accepted reluctantly — for helpers whose only consumers
// deep-import them anyway. A review caught that; the re-exports were removed.
// Importing them through this barrel would also drag in the logger and
// everything else listed above.
export { listFormatter } from './list-formatter.js';
export {
  validateOptionFields,
  type FieldSpec,
  type GroupSpec,
} from './validate-option-fields.js';
export { guardSliderAgainstScroll } from './slider-scroll-guard.js';
