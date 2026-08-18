# Elevation-Offset Estimator

## Purpose

Production estimator of the **baseline-free** elevation offset between the AR floor and the terrain surface, over a stream of per-tick delta samples (e.g. `floor-estimator` hits paired with a terrain height at each hit's ENU position). It answers "how far above/below the terrain model does the AR floor sit here?" with a damped, robust value plus a freeze layer that keeps the answer from following the user up man-made structure. Pure over the tick stream — no clocks, no I/O, no THREE, no Redux.

## Public API

- **`createElevationOffsetEstimator(options?) → ElevationOffsetEstimator`**
  - Returns `{ update(tick) → ElevationOffsetState }`. One instance per session; all state is per-instance.
  - Throws `RangeError` for malformed **options** (non-positive/non-finite window, cap, novelty reference or slew rate; negative drift or small-extent bound; `lowConfidence` outside [0, 1]) — a bad configuration is an upstream bug, not a data condition.
- **`ElevationOffsetSample`** — `{ sampleM, confidence, posE, posN }`. `sampleM` is the baseline-free delta (AR floor height − terrain height) of ONE hit at its OWN ENU position. `confidence` in [0, 1]; zero/NaN/missing values are **down-weighted (floored), never rejected and never divided by**.
- **`ElevationOffsetTick`** — `{ tMs, posE, posN, cameraYar, samples }`. `posE/posN` is the CAMERA ENU position (drives novelty weighting and window eviction). `cameraYar` is the camera's raw-AR height; it is not used by the estimate math (the samples are baseline-free) but participates in the glitch guard — any non-finite tick field skips the whole tick, publishing the previous state.
- **`ElevationOffsetState`** — `{ offsetM, confidence, frozen }`. `offsetM` is `null` until the window has minimal sample mass (cold start only; an established output degrades via `confidence`, it does not flap back to null). `confidence` grows with accumulated effective (novelty × confidence) weight and saturates; `frozen` is true while the freeze layer holds the output at its snapshot.
- **`ElevationOffsetOptions` / `ElevationOffsetFreezeOptions` / `DEFAULT_ELEVATION_OFFSET_OPTIONS`** — window 45 s AND 20 m distance cap; novelty reference 1 m; slew 0.5 m/s; freeze: drift allowance 0.2 m/tick, CUSUM threshold 3 m, extent window 20 s, small-extent bound 3 m, unfreeze band ±1.5 m, confidence collapse below mean 0.2 over 5 s of coverage.

## The baseline-decomposition contract

The returned `offsetM` deliberately does **not** contain the live fused vertical baseline. Callers compose the published world offset at read time as `baseline(t) + offsetM`. The reason: a baseline jump (e.g. a GPS altitude re-fix) must move the camera and the anchored content **together, instantly** — if the baseline were folded into this slow, damped estimate, every baseline jump would replay through the slew limiter as a multi-second world slide. The baseline term feeds through even while the estimator is frozen, by design; this module owns only the sample-space half.

## Why this configuration (corpus-measured)

This module implements the winning configuration of a variant A/B measured across 90 real recordings (~3000 estimator ticks), not a tunable harness:

- The **slew-rate-limited weighted median** won same-place revisit consistency with a **0.47 m** median revisit error — the metric that matters for content placed, left, and returned to.
- Its window medians stayed **≤ 0.7 m IQR** on the indoor/outdoor stress recordings, where the low-lag variants (time-decayed median, linear fit) blew up **3–5×** (1.8–2.0 m IQR). Damping is what buys stability exactly where the sample stream is most treacherous.
- The shared window machinery is mandatory, not stylistic: the window is bounded in **time AND space** (an unbounded history "never forgets" a stale spatial field), novelty weighting is **per tick** and shared by all of a tick's hits (a standstill fills the window with maximally correlated samples at near-zero weight instead of inflating confidence), and confidence **multiplies** weights with a floor (never divides — a zero confidence must not become infinite weight).

## Freeze semantics

Defined entirely in sample space: on a hillside the terrain model mirrors the climb, so the baseline-free sample stays flat; only man-made structure (tower, stairwell, bridge, underpass) makes it ramp. That is the whole discriminant — no odometry, no classifier.

- **Detector:** two-sided CUSUM on the per-TICK aggregate (lower median of the tick's samples — per-hit accumulation would count intra-tick-correlated hits N× too fast) against the estimator's own slew-limited output as the slow reference. Each tick's innovation carries a drift allowance; either side exceeding the threshold freezes. Detection runs BEFORE the tick is fed, so the trigger tick never biases the window.
- **On freeze** the current output is snapshotted as the frozen value and the window stops being fed — if it kept filling during a climb, the frozen reference would migrate to the tower-top value within one window length.
- **Unfreeze is STATE-based only — never a timer.** The estimator resumes only when the per-tick aggregate re-enters `±unfreezeBandM` around the frozen value (the user came back down). A timer cannot be correct here: a long dwell on a tower must not sink the world, and no window length survives a 10-minute dwell. On unfreeze the output resumes FROM the frozen value, rate-limited from that tick on.
- **Extent corroborates, never vetoes.** Horizontal spatial extent = max distance from the extent window's FIRST position over the last ~20 s (extent, never cumulative path length). Small extent (< 3 m) is the stationary-climb signature (stairs and towers are climbed on the spot) and HALVES the CUSUM threshold. It is corroboration only: a bridge is walked at **full** extent and must freeze on the samples alone — extent must never be allowed to veto a freeze.
- **Confidence collapse** (mean tick confidence below the floor over ~5 s of full coverage) also freezes, so a degrading sample source parks the offset instead of dragging it; a single early low-confidence tick cannot freeze a fresh session (coverage requirement), and nothing can freeze before a first output exists.

## Invariants & assumptions

- `offsetM`, when non-null, is finite and never leaves the range of admitted sample values (property-tested): the output starts at a window median, slews toward window medians, and freeze snapshots such an output.
- `confidence ∈ [0, 1]`; `offsetM === null` implies `confidence === 0` and `frozen === false`.
- Non-finite tick fields skip the whole tick (previous state republished); non-finite `sampleM`/`posE`/`posN` drop that sample; non-finite confidence is floored. Arbitrary junk on a monotone-time stream never throws (property-tested).
- The estimator is intended to be called at the ~1 Hz floor-estimate cadence; the slew limit is wall-clock-based (`tMs` deltas), so irregular cadences stay correctly rate-limited.

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

- `elevation-offset-estimator.test.ts` — one test per named scenario intent (deterministic seeded streams from `../test-utils/elevation-offset-scenarios.ts`): flat-walk convergence without freezing; standstill confidence stays deflated vs the same duration walked; tower dwell freezes inside the ramp, holds through a 150-tick dwell (state-based, not timer), unfreezes on return; bridge crossing freezes at full walking extent (extent never vetoes); stairwell freezes via the strengthened small-extent path (behavioral A/B against `smallExtentM: 0`); hillside walk never freezes; zero/NaN-confidence garbage cannot dominate; confidence collapse freezes; slew bound on a hard step; non-finite-tick skipping; strict option validation.
- `elevation-offset-estimator.property.test.ts` — fast-check invariants: non-null output finite and within the admitted sample range; monotone-time junk streams never throw nor poison the state; freeze+unfreeze round trip leaves the estimator functional.

Related: [floor-estimator.ts.md](floor-estimator.ts.md) (the producer of the per-hit floor samples), [../test-utils/elevation-offset-scenarios.ts.md](../test-utils/elevation-offset-scenarios.ts.md).
