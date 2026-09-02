# yaw-churn.ts

## Purpose

The live "calm" number of the debug wheel's readout: the median absolute yaw step per GPS fix over the last 30 fixes, computed on the phone. It is the per-fix step magnitude the rotation-first search ranked its whole grid on (private repo, `GpsPlusSlamJs_Investigation/src/rotation-walk-metric.ts`, `collectStepMagnitudes` over the steady-state window), so a preset switched mid-walk shows up as a number within a minute instead of only as a feeling. 2026-09-02, owner request at the stage-2 interview.

## Public API

- `createYawChurnTracker(window = YAW_CHURN_WINDOW)` → `YawChurnTracker`:
  - `observe(fixCount, yawDeg)` — one sample per fix: ignored unless `fixCount` grew since the last accepted sample; a non-finite yaw advances the fix count but records no step and keeps the previous yaw as the chain's anchor.
  - `summary()` → `{ medianStepDeg, steps }`; `medianStepDeg` is `null` until two finite samples exist.
  - Throws `RangeError` for a window that is not an integer ≥ 1.
- `bearingDeltaDeg(a, b)` — signed shortest difference `a − b` in (−180, 180] (the step is its absolute value, so 359° → 1° is a 2° step, not 358°).
- `YAW_CHURN_WINDOW` = 30 (a minute of 2 s fixes; the offline steady-state window is ordinals 35..90).

## Invariants & assumptions

- The window holds the last `window` STEPS, so `steps ≤ window` and the first fix contributes no step.
- Every step is in [0, 180]; the median is the middle value of the sorted steps, the mean of the two middle values for an even count.
- One tracker per store: the recorder's fix count restarts with every store swap, so the wheel creates a tracker per attached store (`hud-debug-wheel.ts`), never one for the wheel's lifetime.
- Pure and allocation-light: the sorted copy is made only in `summary()`, which runs on readout refresh, not per store update.

## Example

```ts
const churn = createYawChurnTracker();
churn.observe(1, 10); // first sample, no step
churn.observe(2, 12); // step 2
churn.observe(3, 11); // step 1
churn.summary(); // { medianStepDeg: 1.5, steps: 2 }
```

## Tests

- `yaw-churn.test.ts` — one sample per fix (repeated fix counts ignored), wrap-around steps, non-finite yaw skipped without breaking the chain, the window keeps the last 30 steps, `null` before two samples, the window guard.
- `yaw-churn.property.test.ts` (fast-check) — every summary lies in [0, 180] with `steps ≤ window`; adding whole turns to every yaw leaves the summary unchanged; a constant yaw reads 0.

## Related

- `hud-debug-wheel.ts.md` — feeds the tracker from the store and prints the summary in the readout line.
