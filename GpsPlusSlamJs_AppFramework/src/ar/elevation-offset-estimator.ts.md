# Elevation-Offset Estimator

## Purpose

Production estimator of the **baseline-free** elevation offset between the AR floor and the terrain surface, over a stream of per-tick delta samples (e.g. `floor-estimator` hits paired with a terrain height at each hit's ENU position). It answers "how far above/below the terrain model does the AR floor sit here?" with a damped, robust value plus a freeze layer that keeps the answer from following the user up man-made structure. Pure over the tick stream — no clocks, no I/O, no THREE, no Redux.

## Public API

- **`createElevationOffsetEstimator(options?) → ElevationOffsetEstimator`**
  - Returns `{ update(tick) → ElevationOffsetState }`. One instance per session; all state is per-instance.
  - Throws `RangeError` for malformed **options** (non-positive/non-finite window, cap, novelty reference or slew rate; negative drift or small-extent bound; `lowConfidence` outside [0, 1]) — a bad configuration is an upstream bug, not a data condition.
- **`ElevationOffsetSample`** — `{ sampleM, confidence, posE, posN }`. `sampleM` is the baseline-free delta (AR floor height − terrain height) of ONE hit at its OWN ENU position. `confidence` in [0, 1]; zero/NaN/missing values are **down-weighted (floored), never rejected and never divided by**.
- **`ElevationOffsetTick`** — `{ tMs, posE, posN, cameraYar, samples }`. `posE/posN` is the CAMERA ENU position (drives novelty weighting and window eviction). `cameraYar` is the camera's raw-AR height; it is not used by the estimate math (the samples are baseline-free) but participates in the glitch guard — any non-finite tick field skips the whole tick, publishing the previous state.
- **`ElevationOffsetState`** — `{ offsetM, confidence, frozen }`. `offsetM` is `null` until the window has minimal sample mass (cold start only; when the window later empties — an estimate-less gap, a far move — an established output is HELD with exponentially decaying confidence, it does not flap back to null, and recovery SLEWS toward the new median — at most `slewRatePerSecondM × MAX_SLEW_DT_S` per tick, see Freeze semantics). `confidence` grows with accumulated effective (novelty × confidence) weight and saturates; `frozen` is true while the freeze layer holds the output at its snapshot, and while frozen the published confidence decays toward the live tick stream's mean confidence.
- **`MAX_SLEW_DT_S`** — the clamp on the slew clock's `dt`, seconds (2). Exported so callers and tests can bound the worst single output step (`slewRatePerSecondM × MAX_SLEW_DT_S`) without restating the number. A constant, not an option: it is a safety bound, not a tuning knob.
- **`ElevationOffsetOptions` / `ElevationOffsetFreezeOptions` / `DEFAULT_ELEVATION_OFFSET_OPTIONS`** — window 45 s AND 20 m distance cap; novelty reference 1 m; slew 0.5 m/s; freeze: drift allowance 1.5 m/tick against the LEADING reference (see Freeze semantics), CUSUM threshold 3 m, extent window 20 s, small-extent bound 3 m, unfreeze band ±1.5 m (held for 3 consecutive ticks), confidence collapse below mean 0.2 with ≥3 sample-bearing ticks spanning ≥2.5 s.

## The baseline-decomposition contract

The returned `offsetM` deliberately does **not** contain the live fused vertical baseline. Callers compose the published world offset at read time as `baseline(t) + offsetM`. The reason: a baseline jump (e.g. a GPS altitude re-fix) must move the camera and the anchored content **together, instantly** — if the baseline were folded into this slow, damped estimate, every baseline jump would replay through the slew limiter as a multi-second world slide. The baseline term feeds through even while the estimator is frozen, by design; this module owns only the sample-space half.

## Why this configuration (corpus-measured)

This module implements the winning configuration of a variant A/B measured across 90 real recordings (~3000 estimator ticks), not a tunable harness:

- The **slew-rate-limited weighted median** won same-place revisit consistency with a **0.47 m** median revisit error — the metric that matters for content placed, left, and returned to.
- Its window medians stayed **≤ 0.7 m IQR** on the indoor/outdoor stress recordings, where the low-lag variants (time-decayed median, linear fit) blew up **3–5×** (1.8–2.0 m IQR). Damping is what buys stability exactly where the sample stream is most treacherous.
- The shared window machinery is mandatory, not stylistic: the window is bounded in **time AND space** (an unbounded history "never forgets" a stale spatial field), novelty weighting is **per tick** and shared by all of a tick's hits (a standstill fills the window with maximally correlated samples at near-zero weight instead of inflating confidence), and confidence **multiplies** weights with a floor (never divides — a zero confidence must not become infinite weight).
- **Published confidence is PER-TICK-NORMALIZED (F6 recalibration, corpus-measured 2026-08-18).** Each window tick contributes novelty × MEAN hit quality — at most 1 per tick, however many hits it carried — and confidence saturates at a window mass of 10 effective ticks (`CONFIDENCE_SATURATION_TICK_MASS`). The predecessor per-HIT mass (saturation 50) was sized against "~6 hits/tick"; the `elevation-offset-production-corpus` probe measured a median **28** FloorEstimate hits per production tick (p10 13, p90 72) and a median floor-estimate confidence of **1.0**, so the published confidence pegged at ~1.0 on **63/88 recordings (72%)** and carried no signal. Intra-tick hits are correlated (one floor patch, one shared estimate confidence): a denser depth grid is not more evidence. The window MEDIAN still weighs every hit; only the confidence unit changed.

## Freeze semantics

Defined entirely in sample space: on a hillside the terrain model mirrors the climb, so the baseline-free sample stays flat; only man-made structure (tower, stairwell, bridge, underpass) makes it ramp. That is the whole discriminant — no odometry, no classifier.

- **Detector:** two-sided CUSUM on the per-TICK aggregate (CONFIDENCE-WEIGHTED lower median of the tick's samples, with the same floored weights as the window median — per-hit accumulation would count intra-tick-correlated hits N× too fast, and an unweighted aggregate would let a numeric majority of zero-confidence garbage hits hand the detector an outlier) against a **LEADING reference**: the lower median of the last 5 tick aggregates. The reference must lead, not lag — measuring innovation against the slew-limited output (which lags by design) turned a legitimate slow coherent ramp (a DEM error gradient on a hill, ~0.4 m/tick at walk speed) into an ever-growing innovation and froze the estimator on real data, after which a one-way walk never re-entered the unfreeze band. Against the leading reference a ramp of r m/tick contributes only ≈ 3·r per tick (the median's lag), absorbed by the 1.5 m drift allowance up to ~0.5 m/tick, while a structure climb (tower ~2 m/tick, bridge/stairs ~0.8 m/tick) still accumulates to the threshold within a few ticks. Detection runs BEFORE the tick is fed, so the trigger tick never biases the window; nothing can freeze before a first output exists (the freeze snapshots it).
- **On freeze** the current output is snapshotted as the frozen value and the window stops being fed — if it kept filling during a climb, the frozen reference would migrate to the tower-top value within one window length. While frozen, the published confidence decays (5 s e-folding) toward the live tick stream's mean confidence, so a frozen offset stops advertising its healthy freeze-time confidence while its inputs degrade.
- **Unfreeze is STATE-based only — never a timer.** The estimator resumes only after **3 consecutive** ticks whose aggregate re-enters `±unfreezeBandM` around the frozen value (the user came back down) — a lone lucky in-band tick must not unfreeze mid-climb and let the next tick re-freeze a corrupted snapshot. A timer cannot be correct here: a long dwell on a tower must not sink the world, and no window length survives a 10-minute dwell. On unfreeze the output resumes FROM the frozen value; the slew clock re-anchors to the PREVIOUS tick's time, so the resume tick has a normal one-tick step budget (no retroactive credit for the dwell, but no dead zero-dt tick either).
- **Extent corroborates, never vetoes.** Horizontal spatial extent = max distance from the extent window's FIRST position over the last ~20 s (extent, never cumulative path length). Small extent (< 3 m) is the stationary-climb signature (stairs and towers are climbed on the spot) and HALVES the CUSUM threshold. It is corroboration only: a bridge is walked at **full** extent and must freeze on the samples alone — extent must never be allowed to veto a freeze.
- **Confidence collapse** (mean tick confidence below the floor over ≥3 sample-bearing ticks spanning ≥2.5 s) also freezes, so a degrading sample source parks the offset instead of dragging it. The gate is an ABSOLUTE evidence count on purpose: the old "retained ticks must span ≥90% of the 5 s window" fraction could never fire at degraded tick rates (at 0.5 Hz the retained ticks span at most 4 s). A single early low-confidence tick still cannot freeze a fresh session, nothing can freeze before a first output exists, and sample-less ticks carry no confidence evidence (they are a data gap — the hold path's territory — not a collapsing source).
- **Estimate-less gaps HOLD, they do not reset.** When the window empties under an established output (no samples for longer than the window, or a far move), the output is held with exponentially decaying confidence (10 s e-folding — slower than the frozen decay, because a data gap is absence of evidence, not evidence of a problem), `frozen` stays false, and the slew clock keeps advancing so the recovery SLEWS toward the new median instead of spending the whole gap as one giant step budget.
- **A gap in the TICKS themselves cannot buy step budget either.** Advancing the clock only helps when `update` is actually called; a caller that withholds ticks (a pose gap, a suspended tab, a consumer that skips `update` while tracking is lost) leaves the slew clock stale, and the first post-gap tick would otherwise get `slewRatePerSecondM × gap` of budget — 10 m after 20 s at the defaults, against a window that has meanwhile evicted. The slew `dt` is therefore clamped to `MAX_SLEW_DT_S` (2 s, ~2 ticks at the intended 1 Hz), so the worst single step is 1 m at the default rate. The bound lives in the estimator, not in a caller contract, precisely so no consumer can opt out of it by withholding ticks.

## Invariants & assumptions

- `offsetM`, when non-null, is finite and never leaves the range of admitted sample values (property-tested): the output starts at a window median, slews toward window medians, and freeze snapshots such an output.
- `confidence ∈ [0, 1]`; `offsetM === null` implies `confidence === 0` and `frozen === false`.
- Non-finite tick fields skip the whole tick (previous state republished); non-finite `sampleM`/`posE`/`posN` drop that sample; non-finite confidence is floored. Arbitrary junk on a monotone-time stream never throws (property-tested).
- The estimator is intended to be called at the ~1 Hz floor-estimate cadence; the slew limit is wall-clock-based (`tMs` deltas), so irregular cadences stay correctly rate-limited — and bounded by `MAX_SLEW_DT_S`, so a WITHHELD stretch of ticks cannot be cashed in as one large step.

## Examples

```ts
import {
  createElevationOffsetEstimator,
  type ElevationOffsetTick,
} from 'gps-plus-slam-app-framework/ar';

const estimator = createElevationOffsetEstimator(); // corpus defaults
// per ~1 Hz floor estimate: pair each FloorHit with a terrain height at
// its ENU position, then:
const state = estimator.update(tick satisfies ElevationOffsetTick);
if (state.offsetM != null && state.confidence >= 0.5) {
  // Compose at read time — the baseline is NOT inside offsetM:
  const worldOffsetY = liveFusedBaselineY + state.offsetM;
}
```

## Tests

- `elevation-offset-estimator.test.ts` — one test per named scenario intent (deterministic seeded streams from `../test-utils/elevation-offset-scenarios.ts`): flat-walk convergence without freezing; standstill confidence stays deflated vs the same duration walked; tower dwell freezes inside the ramp, holds through a 150-tick dwell (state-based, not timer), unfreezes on return; bridge crossing freezes at full walking extent (extent never vetoes); stairwell freezes via the strengthened small-extent path (behavioral A/B against `smallExtentM: 0`); a slow coherent ramp (0.4 m/tick walking) never freezes and is tracked within the slew bound; an underpass walk freezes via the NEGATIVE CUSUM branch and unfreezes on return; hillside walk never freezes; an alternating outlier/good stream keeps advancing (confidence-weighted aggregate); unfreeze requires 3 consecutive in-band ticks; the unfreeze tick has a full one-tick slew budget; an estimate-less 50 s gap holds the output (never null) and recovery slews; a 20 s gap in the TICKS THEMSELVES buys no extra step budget (`MAX_SLEW_DT_S` clamp); zero/NaN-confidence garbage cannot dominate; confidence collapse freezes (and its frozen confidence decays below 0.3), including at a degraded 0.5 Hz tick rate; slew bound on a hard step; non-finite-tick skipping; strict option validation.
- `elevation-offset-estimator.property.test.ts` — fast-check invariants: non-null output finite and within the admitted sample range; monotone-time junk streams never throw nor poison the state; freeze+unfreeze round trip leaves the estimator functional.

Related: [floor-estimator.ts.md](floor-estimator.ts.md) (the producer of the per-hit floor samples), [../test-utils/elevation-offset-scenarios.ts.md](../test-utils/elevation-offset-scenarios.ts.md).
