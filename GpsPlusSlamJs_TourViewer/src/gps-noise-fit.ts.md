# gps-noise-fit.ts

## Purpose

Two measurement kernels for the D20 recalibration on real recordings
(Tour Viewer authoring plan 2026-09-28-0953 §3.6; results in
`GpsPlusSlamJs_Docs/docs/` of the primary repo): the first-order
Gauss-Markov model (per-axis sigma, time constant tau) that best describes a
real walk's GPS error, and the bearing an alignment gives the AR frame's
north axis, which is what the compass comparison subtracts. Pure.
MEASUREMENT ONLY: nothing in the viewer or the authoring flow reads it; the
opt-in sweep `code-displacement.recordings.test.ts` does.

## Public API

- `fitGaussMarkov(seriesList, { maxLagS = 300, binS = 1 })` -
  `GaussMarkovFit | null`:
  - `sigmaM`: RMS of the demeaned residuals per axis, north and east pooled
    (the M5a model's per-axis sigma; horizontal RMS is about 1.4 sigma);
  - `rho`: the autocorrelation per lag bin over every pair of samples of one
    series at most `maxLagS` apart (no resampling, so an irregular fix
    stream needs none), both axes pooled; NaN for an empty bin;
  - `tauS`: the first lag at which `rho` falls below 1/e, interpolated
    linearly between bins (for a Gauss-Markov process `rho = exp(-lag /
tau)`); null with `censored: true` when it never does within `maxLagS`;
  - `samples`: finite samples used.
    Several series are pooled into one fit, each demeaned on its own, so a
    corpus fit weights pairs, not sessions. Null for fewer than two finite
    samples or zero variance.
- `alignmentNorthBearingDeg(alignment)` - degrees clockwise from north in
  [0, 360) of the odometry's north axis (= AR -Z) through a column-major
  odometry-NUE to GPS-world NUE alignment: `atan2(m[2], m[0])`. Null for
  anything but 16 finite numbers or a (near) vertical axis. Comparable with
  the core's `arNorthBearingDeg` of the compass (pinned by a test).
- `type ResidualSample` = `{ tMs, n, e }`: GPS minus a reference path,
  metres north and east, at the fix's time.
- Errors: `RangeError` for a non-positive or non-finite `maxLagS` / `binS`
  and for a series out of time order (the pair window relies on order).
  Non-finite samples are skipped, never repaired.

## Invariants and caveats

- Demeaning removes a constant per-series bias; the cross-session bias is a
  different quantity (the sweep measures it with reference-point pairs).
- On a SHORT series of a SLOW process, demeaning removes much of the error,
  so both sigma and tau are biased low; a real walk is minutes long while
  the outdoor GPS correlation time is tens of seconds (Investigation census:
  median about 18 s), so the bias is small there but not zero.
- The reference path the sweep uses is each walk's final (hindsight)
  alignment of the odometry. Any reference fitted to the same fixes absorbs
  their low-frequency error, so the fitted sigma is a lower bound of the
  error against truth, and odometry wander enters the residuals (an upper
  bound on tau's GPS part) - the same definition the Investigation's
  correlation-time census used.
- Cost: O(N x pairs within `maxLagS`), about N x 300 at 1 Hz.

## Examples

```ts
const fit = fitGaussMarkov([residualsOfWalkA, residualsOfWalkB], {
  maxLagS: 300,
});
// fit?.sigmaM, fit?.tauS (null when censored)

const bearing = alignmentNorthBearingDeg(
  state.gpsData.gpsEvents.alignmentMatrix,
);
const compassError = bearingDeltaDeg(
  arNorthBearingDeg(qSensor, qArPose)!,
  bearing!,
);
```

## Tests

- `gps-noise-fit.test.ts`: recovers known sigma/tau (3/20, 5/60, 10/30) and
  tau from a 2 s stream; censoring; per-series demeaning; non-finite and
  out-of-order input; the bearing convention against the core's
  `arNorthBearingDeg` and `webxrToNUE` for one AR frame seen by a compass
  and by an alignment; malformed alignments.
- `gps-noise-fit.property.test.ts`: invariance under a rotation of the
  residuals, sigma scaling with the error, clock-shift invariance, the
  zero-lag rho.
