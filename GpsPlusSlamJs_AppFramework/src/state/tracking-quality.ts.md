# tracking-quality.ts

## Purpose

Phase A of the tracking-quality / GPS↔SLAM convergence reporter described in
[docs/2026-05-16-tracking-quality-metrics-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-16-tracking-quality-metrics-plan.md).
Computes a single `TrackingQualityReport` from already-public Redux state
(`gpsData`, `tracking`, `recording`) plus a small auxiliary slice
(`trackingQuality`) that buffers the last N alignment matrices.

Four sub-scores, each in `[0, 1]`, gate a single overall `confidence` value
(`min(...)`):

- **convergence** (§4.1) — how stable consecutive alignment matrices are.
  Aggregated by **sum** (not max) across the last `matrixHistorySize - 1`
  pairs in the ring buffer (Finding 6, 2026-05-23). The raw sums are
  exposed on `diagnostics.recentSumRotationDeltaDeg` /
  `recentSumTranslationDeltaM` and surfaced in the recorder HUD as
  `ΣΔrot:` / `ΣΔpos:`.
- **residualConsensus** (§4.2) — agreement between odometry-projected pose and
  GPS fixes, normalised by `latLongAccuracy`.
- **gpsAccuracy** (§4.4) — median reported `latLongAccuracy` over the recent
  K samples.
- **coverage** (§4.5) — combination of walked distance and direction spread.

> The legacy §4.3 compass cross-check (`computeCompassAgreement`) and its
> first-agreement detector were removed (2026-06-28): the sub-score returned
> `null` whenever `absolute !== true` and was excluded from the aggregate, so
> on the devices that mattered it was inert dead code. The live odometry-restart
> compass path (in `tracking-slice` / `gps-plus-slam-js`) is unrelated and
> untouched.

Each sub-score is exposed alongside human-readable diagnostics. A coarse
state machine collapses the score to `'warming-up' | 'ar-lost' | 'degraded' |
'ok'`.

## Public API

- **Functions**
  - `computeTrackingQualityReport(state, options?)` — pure aggregator over the
    base `SlamAppRootState` (extended with `trackingQuality`).
  - `computeConvergence(snapshots, options?)` / `matrixDelta(a, b)` — §4.1.
  - `computeResidualConsensus(matrix, gps, odom, zeroRef, options?)` — §4.2.
  - `computeGpsAccuracy(gpsPoints, options?)` — §4.4.
  - `computeCoverage(odomPositions, options?)` — §4.5.
  - `computeGpsVsFusedDivergence(...)` — §4.6 diagnostic only.
  - `createTrackingQualityListenerMiddleware(options?)` — Redux listener that
    buffers alignment matrices and recomputes the report on relevant actions.
- **Reducer / actions**
  - `trackingQualityReducer`.
  - `snapshotPushed(AlignmentSnapshot)`, `snapshotsTrimmed({size})`,
    `reportUpdated(report | null)`, `degradedCountUpdated(count)`,
    `resetTrackingQuality()`.
    (`smoothedConvergenceUpdated` is module-private — dispatched only by the
    listener middleware; not part of the public action surface.)
- **Selectors**
  - `selectTrackingQuality(state)`, `selectRecentAlignments(state)`.
- **Constants / types**
  - `DEFAULT_TRACKING_QUALITY_OPTIONS` (corpus-derived values from the §6.1
    parameter sweep — see plan §11 (c)/(d); locked by a regression test).
  - `TrackingQualityState`, `TrackingQualityReport`, `TrackingQualityOptions`,
    `AlignmentSnapshot`, `TrackingQualitySliceState`,
    `ConvergenceResult`, `ResidualConsensusResult`, `GpsAccuracyResult`,
    `CoverageResult`.

All inputs are treated as **readonly**. Helpers never mutate arrays they
receive — copies are taken before sorting or sliding-window operations.

## Invariants & assumptions

- `Matrix4` is column-major (per `fusedGpsFromOdom` in `gps-plus-slam-js`).
- `Vector3` uses the library's NUE convention: `[north, up, east]` (metres).
  Coverage / bearing math reads `[0]` as north and `[2]` as east; up is
  ignored.
- The reported AR-forward axis is the GL-camera convention `(0, 0, -1)`. This
  matches the camera-quaternion rotation produced by WebXR and by
  `recordGpsEvent`'s synthetic pose.
- Listener middleware **defends against missing slice state** (`state.trackingQuality?`)
  so it stays usable in tests/stores that only mount a subset of slices.
- Listener middleware uses **shallow change detection** — `reportUpdated` is
  only dispatched when the freshly-computed report differs from the previously
  cached one (using `reportsEqual`).
- `reportsEqual` compares float fields with **per-field tolerances**, not
  strict `!==`: scores/confidence `1e-3`, angle diagnostics `0.01°`, metre
  diagnostics `1 mm`. `tracking/poseReceived` fires every XR frame and the
  per-frame recompute reuses unchanged GPS/odometry windows, so without
  tolerances imperceptible per-frame float jitter would dispatch
  `reportUpdated` (and re-render the HUD) at frame rate. The gate compares
  against the last _dispatched_ report, so slow real drift still triggers an
  update once it crosses a tolerance — it cannot accumulate indefinitely.
- **Pose-action phase gate (quality-review E-1, 2026-07-10):** on
  `tracking/poseReceived`/`poseLost` the listener skips the whole O(history)
  recompute (incl. `computeCoverage`'s walk + sort) when the tracking phase
  is unchanged since the last pose-action recompute AND a report already
  exists — the phase is the only report input pose actions carry. Phase
  transitions and the first pose after a reset always recompute (pinned by
  tests). This also makes the §4.8 holdoff genuinely per-observation (below).
- Reset triggers (`recording/startSession`, `tracking/resetTracking`) clear
  both the matrix buffer, the cached report, and the `degradedConsecutiveCount`.
- §4.8 hysteresis: the `ok → degraded` transition is held off for
  `degradedHoldoff` (default 3) consecutive sub-threshold observations.
  `degraded → ok` is immediate. `ar-lost` bypasses holdoff entirely.
  (Before E-1 the counter actually advanced per FRAME, collapsing the
  holdoff to ~50 ms; the pose-action phase gate restored the documented
  per-observation cadence.)
- §4.8b EMA-smoothed convergence (Finding 4): the convergence sub-score
  reported by `computeTrackingQualityReport` is blended with the previously
  persisted `smoothedConvergence` using `α = convergenceEmaAlpha`
  (default `0.25` — re-tuned from `0.3` with E-1, since the EMA now advances
  per observation instead of per frame; the F4 indoor-corpus range < 0.2
  acceptance still holds). On the first observation (`smoothedConvergence === null`)
  the filter is seeded with the raw value. The listener middleware
  dispatches `smoothedConvergenceUpdated` after every aggregator pass so
  the next pass can blend against the latest value. `α = 1.0` disables
  smoothing; `α → 0` makes the score effectively constant. The smoothed
  value is the one surfaced on the report (and to the HUD); the raw value
  is no longer exposed.
- All sub-scores are clamped to `[0, 1]`; never `NaN` for empty input.
- **All helper thresholds are forwarded from the aggregator.** Every seed
  threshold in `TrackingQualityOptions` is passed through by
  `computeTrackingQualityReport` to the matching `compute*` helper, so
  overriding the store / aggregator options actually takes effect. In
  particular `convergenceRotationWarnDeg` / `convergenceTranslationWarnM`
  (§4.1) reach `computeConvergence`. The helpers' own single-arg defaults
  fall back to `DEFAULT_TRACKING_QUALITY_OPTIONS` so direct callers (e.g. the
  Investigation harness) get the same calibrated values.

## Defensive measures

- `matrixDelta` validates length-16 matrices and returns zero deltas otherwise. It also finite-guards both outputs: a NaN/Infinity-bearing matrix (degenerate alignment solve) would otherwise propagate `NaN` through `getRotation`/`vec3.distance` into `computeConvergence` and turn the whole score `NaN`. On non-finite output it falls back to `0` (no delta).
- `computeConvergence` treats a **corrupt** alignment matrix — non-finite OR wrong-length (`AlignmentSnapshot.matrix` is typed `number[]`, not a 16-tuple) — as evidence of instability, NOT stability. Its `isFiniteMatrix` guard rejects both cases, so such a pair is scored on the FAIL side (thresholds added) rather than slipping through to `matrixDelta`'s zero-delta length fallback, which reads as "perfectly stable" and would _inflate_ the score.
  Internally `matrixDelta` uses `mat4.getRotation` + the shared `geodesicAngleRad` kernel + `mat4.getTranslation`
  from gl-matrix — the same kernel the downstream corpus-analysis harness
  re-exports as `computeStabilityDelta`. Per the plan §11 (a), these two
  functions share one numeric definition so the §6.1 corpus sweep's
  correlations are computed against the same kernel the AppFramework
  reports at runtime. Numerical agreement is locked in by the
  "matches the gl-matrix quat-based reference kernel" tests.
- `computeResidualConsensus` returns score 0 (and `null` median) when alignment
  matrix or zero reference is missing.
- `computeGpsAccuracy` skips entries with non-finite `latLongAccuracy`.
- `computeCoverage` handles zero or one odom samples and pure stand-still loops.

## Examples

```ts
import {
  createTrackingQualityListenerMiddleware,
  trackingQualityReducer,
  selectTrackingQuality,
} from 'gps-plus-slam-app-framework';

const store = configureStore({
  reducer: { /* ... */, trackingQuality: trackingQualityReducer },
  middleware: (gdm) =>
    gdm({ serializableCheck: false }).prepend(
      createTrackingQualityListenerMiddleware()
    ),
});

store.subscribe(() => {
  const report = selectTrackingQuality(store.getState());
  if (report?.state === 'ok') console.log('confidence:', report.confidence);
});
```

## Tests

- Co-located unit tests: [tracking-quality.test.ts](tracking-quality.test.ts) —
  53 tests covering pure helpers, slice reducers, the aggregator
  state-machine, anti-validation cases from plan §6, the listener
  middleware contract, corpus-derived defaults regression (§11 (d)), and
  §4.8 hysteresis (§11 (f)).
- Field-recording integration:
  [tracking-quality.field-recordings.test.ts](tracking-quality.field-recordings.test.ts)
  replays two real recorded sessions (outdoor walking, indoor stationary)
  through a production-shaped store and asserts findings F1/F4/F6. It skips
  gracefully when the gitignored recordings are absent. **Its threshold
  assertions are derived from `DEFAULT_TRACKING_QUALITY_OPTIONS`, never
  hardcoded** (`TRANSLATION_FAIL_M`, `ROTATION_FAIL_DEG` = warn × 4) — a
  hardcoded literal there went stale once when the upstream alignment improved
  and the fixture's measured value moved; see the
  [F6 recalibration followup](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-27-2210-tracking-quality-f6-recalibration-followup.md).
- Corpus sweep (Phase A (c)): exercised in the downstream analysis
  harness — 5 tests replaying the full recording corpus (§6.1 sweep,
  compass perturbation, anti-validation).

## Related docs

- Plan: [2026-05-16-tracking-quality-metrics-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-16-tracking-quality-metrics-plan.md)
- Rotation conventions: [2026-04-08-rotation-convention-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-08-rotation-convention-plan.md)
- Tracking slice: [tracking-slice.ts.md](tracking-slice.ts.md)
