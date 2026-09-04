/**
 * Live yaw churn for the debug wheel's readout (2026-09-02, owner request at
 * the stage-2 interview): the median |Δyaw| per GPS fix over the last N steps,
 * the same per-fix step magnitude the rotation-first search ranked its grid
 * on (private repo, `rotation-walk-metric.ts`: `collectStepMagnitudes` over
 * the steady-state window), computed on the phone so a preset switch shows
 * up as a number within a minute rather than only as a feeling.
 *
 * One sample per fix: the tracker records a yaw only when the fix count grew
 * since its last sample, so the store's many non-GPS updates (frames, compass
 * ticks) do not dilute the median with zero-length steps. A non-finite yaw
 * (no alignment yet, or a solve that did not converge) is skipped without
 * breaking the chain, as the offline metric does.
 *
 * See `yaw-churn.ts.md`.
 */

import { bearingDeltaDeg } from 'gps-plus-slam-app-framework/utils/bearing-degrees';
import { interpolatingMedian } from 'gps-plus-slam-app-framework/utils/median';

export interface YawChurnSummary {
  /** Median |Δyaw| per fix over the window, degrees; `null` until two samples. */
  readonly medianStepDeg: number | null;
  /** Steps in the window (≤ the window length). */
  readonly steps: number;
}

export interface YawChurnTracker {
  /** Feed the current fix count and solved yaw; ignored unless the count grew. */
  observe(fixCount: number, yawDeg: number): void;
  summary(): YawChurnSummary;
}

/** The offline steady-state window is ordinals 35..90; 30 steps is a minute of 2 s fixes. */
export const YAW_CHURN_WINDOW = 30;

export function createYawChurnTracker(
  window: number = YAW_CHURN_WINDOW
): YawChurnTracker {
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError(
      `yaw churn window must be an integer ≥ 1, got ${window}`
    );
  }
  let lastFixCount = -Infinity;
  let lastYaw: number | null = null;
  const steps: number[] = [];
  return {
    observe(fixCount, yawDeg) {
      if (!(fixCount > lastFixCount)) return;
      lastFixCount = fixCount;
      if (!Number.isFinite(yawDeg)) return;
      if (lastYaw !== null) {
        steps.push(Math.abs(bearingDeltaDeg(yawDeg, lastYaw)));
        if (steps.length > window) steps.shift();
      }
      lastYaw = yawDeg;
    },
    summary() {
      if (steps.length === 0) return { medianStepDeg: null, steps: 0 };
      return { medianStepDeg: interpolatingMedian(steps), steps: steps.length };
    },
  };
}
