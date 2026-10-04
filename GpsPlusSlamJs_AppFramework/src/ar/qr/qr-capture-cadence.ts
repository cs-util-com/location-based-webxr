/**
 * How often a QR consumer captures a camera frame for detection: the default
 * and the bounds every app validates against. See qr-capture-cadence.ts.md.
 */

/**
 * Bounds of the QR capture interval, in milliseconds. Below ~50 ms the
 * detector cannot keep up and frames only queue; above 1 s tracking feels
 * dead. `step` is the settings slider's grid.
 */
export const QR_CAPTURE_INTERVAL_CONSTRAINTS = {
  min: 50,
  max: 1000,
  step: 25,
} as const;

/** The default QR capture interval: ~8 captures per second. */
export const DEFAULT_QR_CAPTURE_INTERVAL_MS = 125;
