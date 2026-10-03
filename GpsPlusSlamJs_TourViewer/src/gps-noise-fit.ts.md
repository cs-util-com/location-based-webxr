# gps-noise-fit.ts

## Purpose

Two measurement kernels for the D20 recalibration on real recordings
(Tour Viewer authoring plan 2026-09-28-0953 §3.6; results in
`GpsPlusSlamJs_Docs/docs/` of the primary repo): the first-order
Gauss-Markov model (per-axis sigma, time constant tau) that best describes a
real walk's GPS error, and the bearing an alignment gives the AR frame's
north axis, which is what the compass comparison subtracts. Pure.
The noise fit is measurement only (the opt-in sweep
`code-displacement.recordings.test.ts` reads it); `alignmentNorthBearingDeg`
is also read by the viewer's moved-code turn check (`moved-code-rule.ts`
`compassTurnDeg`, D20 M5c).

## Public API

- `fitGaussMarkov(seriesList, { maxLagS = 300, binS = 1 })` returns
  `GaussMarkovFit | null`:
  - `sigmaM`: RMS of the demeaned residuals per axis, north and east pooled
    (the M5a model's per-axis sigma; horizontal RMS is about 1.4 sigma).
  - `rho`: the autocorrelation per lag bin over every pair of samples of one
    series at most `maxLagS` apart (no resampling, so an irregular fix
    stream needs none), both axes pooled. Each bin is normalised by its own
    pairs' energies, `sum(x_i . x_j) / sqrt(sum |x_i|^2 * sum |x_j|^2)`, so
    every value lies in [-1, 1]. NaN for an empty bin, and for a bin whose
    pairs carry less than 1e-9 of the variance per pair (all at the series
    mean: its sum is rounding noise, which the per-bin division would
    otherwise report anywhere in [-1, 1]).
  - `tauS`: the first lag at which `rho` falls below 1/e, interpolated
    linearly between bins (for a Gauss-Markov process rho is
    `exp(-lag / tau)`); null with `censored: true` when it never does within
    `maxLagS`.
  - `samples`: finite samples used.
  - Several series are pooled into one fit, each demeaned on its own, so a
    corpus fit weights pairs, not sessions, and its long-lag bins come from
    the longest series only.
  - Null for fewer than two finite samples or zero variance.
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
- **The limit on short walks.** Demeaning removes the part of the error
  slower than the series is long, so sigma and tau are biased LOW, and the
  bias grows with tau against the length. Measured (unit test and a one-off
  sweep, true sigma 5 m, 200 seeds, median read):
  - 170 s series: tau 10 reads 7.8 s, 30 reads 15, 60 reads 21, 120 reads
    23, 300 reads 25.5; sigma reads 4.6 / 4.0 / 3.4 / 2.7 / 1.8 m.
  - 340 s: tau 10 / 30 / 60 / 120 / 300 read 8.8 / 21 / 31 / 42 / 51 s.
  - 700 s: 9.4 / 26 / 43 / 63 / 89 s (censored from tau 60 on).
  - So a walk of 2.8 minutes (the corpus median) cannot tell a tau of one
    minute from one of five, a per-walk tau that is never censored is NO
    evidence of a short tau, and the per-walk sigma is a lower bound.
- The reference path the sweep uses is each walk's final published
  alignment of the odometry. Any reference fitted to the same fixes absorbs
  their low-frequency error (sigma is a lower bound of the error against
  truth), and odometry wander enters the residuals.
- Not the Investigation's estimator. Its correlation-time census
  (`GpsPlusSlamJs_Investigation/src/residual-autocorrelation.ts`, output
  `test-results/gps-correlation-time-census.json`) differs by definition, so
  the numbers are comparable in kind, not equal:
  - reference: the core's uniform whole-session batch fit (time weighting
    off), not the Tour Viewer's final recency-weighted alignment;
  - per axis, signed, and the slower of north and east, where this pools
    both axes into one curve;
  - normalised by the series' variance with a per-bin pair count (no
    per-bin energies), bins thinner than its pair minimum dropped;
  - bin width = the recording's median cadence (1-10 s) and the longest
    lag = half the recording (capped), not a fixed 1 s / `maxLagS`;
  - its corpus includes the eras the Recorder migrates; this sweep only
    reads era 4+.
  - It shares the short-walk bias: its own length split reads tau 11 s on
    the short half (median 120 s) and 31 s on the long half (246 s).
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
  tau from a 2 s stream; the measured short-walk bias at 170 samples (slow
  process read too fast and too quiet, tau 60 and 120 indistinguishable, a
  fast process read well); censoring; per-series demeaning; non-finite and
  out-of-order input; the bearing convention against the core's
  `arNorthBearingDeg` and `webxrToNUE` for one AR frame seen by a compass
  and by an alignment; malformed alignments.
- `gps-noise-fit.property.test.ts`: invariance under a rotation of the
  residuals, sigma scaling with the error, clock-shift invariance, the
  zero-lag rho and |rho| <= 1 for single series and for unequal pools.
