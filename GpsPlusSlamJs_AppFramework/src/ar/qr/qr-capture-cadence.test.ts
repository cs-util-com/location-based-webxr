import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QR_CAPTURE_INTERVAL_MS,
  QR_CAPTURE_INTERVAL_CONSTRAINTS,
} from './qr-capture-cadence';

describe('QR capture cadence bounds', () => {
  // Why this test matters: the Recorder's settings slider and the QR demo's
  // `?interval=` parser both read these bounds; a default outside them, or off
  // the slider's step grid, would be clamped to a different value the moment a
  // user touched the slider, silently changing the cadence they never chose.
  it('keeps the default inside the bounds and on the step grid', () => {
    const { min, max, step } = QR_CAPTURE_INTERVAL_CONSTRAINTS;
    expect(DEFAULT_QR_CAPTURE_INTERVAL_MS).toBeGreaterThanOrEqual(min);
    expect(DEFAULT_QR_CAPTURE_INTERVAL_MS).toBeLessThanOrEqual(max);
    expect((DEFAULT_QR_CAPTURE_INTERVAL_MS - min) % step).toBe(0);
  });

  // Why this test matters: the numbers carry the reasoning in the sidecar
  // (detector throughput below 50 ms, dead-feeling tracking above 1 s); a
  // change to them is a behaviour change for every app, not a refactor.
  it('pins the documented values', () => {
    expect(QR_CAPTURE_INTERVAL_CONSTRAINTS).toEqual({
      min: 50,
      max: 1000,
      step: 25,
    });
    expect(DEFAULT_QR_CAPTURE_INTERVAL_MS).toBe(125);
  });
});
