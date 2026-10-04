/**
 * The seam between the globe lab's frame-hitch recorder and the framework's
 * statistics (globe zoom frame-hitch plan 2026-10-03-2017, PERF-0 and
 * PERF-1; DEC-H3: one implementation): the whole-run histogram, the
 * attribution join, the idle calibration, the target check, the on-screen
 * summary and the export all come from `/fw/utils/`.
 *
 * @see globe-perf-stats.js.md
 */
export {
  calibrateRefreshInterval,
  createFrameRun,
} from "/fw/utils/frame-run.js";
export {
  buildFrameExport,
  formatFrameRunSummary,
} from "/fw/utils/frame-run-report.js";
export { checkFrameTarget } from "/fw/utils/frame-target.js";
