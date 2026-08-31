/**
 * Elevation-Offset Estimator
 *
 * Production estimator of the BASELINE-FREE elevation offset between the
 * AR floor and the terrain surface, over a stream of per-tick delta
 * samples (e.g. floor-estimator hits paired with a terrain height at each
 * hit's ENU position). Pure over the tick stream — no clocks, no I/O, no
 * THREE, no Redux.
 *
 * This is the corpus-winning configuration ONLY (measured on 90 real
 * recordings): a confidence-weighted lower median over a window bounded in
 * TIME and SPACE, per-tick spatial novelty weighting, and a SLEW-RATE-
 * LIMITED output — the damped output won same-place revisit consistency
 * (0.47 m median) while low-lag variants went unstable at indoor/outdoor
 * transitions. A CUSUM-based freeze layer is folded in so the offset never
 * follows the user up man-made structure (towers, stairs, bridges).
 *
 * BASELINE DECOMPOSITION CONTRACT: the returned `offsetM` is baseline-free
 * — it deliberately does NOT contain the live fused vertical baseline.
 * Callers compose the published offset at read time as
 * `baseline(t) + offsetM`. The reason: a baseline jump (e.g. a GPS
 * altitude re-fix) must move the camera and the anchored content together
 * INSTANTLY, so the slow, damped estimate must not contain the baseline —
 * otherwise every baseline jump would replay through the slew limiter as a
 * multi-second world slide.
 *
 * @see elevation-offset-estimator.ts.md for detailed documentation
 */

// Two imports, and neither costs the purity stated above: both modules import
// nothing themselves. Each is here because it carries a CONTRACT, not because
// it saves a line - which of the two middles an even-length window returns,
// and whether a non-finite confidence reads as 0 or propagates, are exactly
// the silent disagreements those consolidations were paid for.
import { clamp01 } from '../utils/clamp01.js';
import { lowerMedian, weightedMedian } from '../utils/median.js';

/** One baseline-free floor-vs-terrain delta hit at its own ENU position. */
export interface ElevationOffsetSample {
  /** Baseline-free delta (AR floor height − terrain height), metres. */
  readonly sampleM: number;
  /** [0, 1]; zero/NaN/missing values are down-weighted, never rejected. */
  readonly confidence: number;
  /** Horizontal ENU position of the hit, metres east. */
  readonly posE: number;
  /** Horizontal ENU position of the hit, metres north. */
  readonly posN: number;
}

/** One estimator tick: the camera's state plus that tick's delta hits. */
export interface ElevationOffsetTick {
  /** Tick timestamp, milliseconds (monotone in normal operation). */
  readonly tMs: number;
  /** Camera ENU east, metres — drives novelty weighting and eviction. */
  readonly posE: number;
  /** Camera ENU north, metres. */
  readonly posN: number;
  /**
   * Camera height in the raw AR frame, metres. Not used by the estimate
   * math (the samples are baseline-free); it participates in the tick's
   * glitch guard — a non-finite camera height marks a tracking glitch and
   * the whole tick is skipped.
   */
  readonly cameraYar: number;
  readonly samples: readonly ElevationOffsetSample[];
}

export interface ElevationOffsetFreezeOptions {
  /**
   * CUSUM innovation allowance subtracted per tick, metres. Default 1.5.
   * Innovation is measured against the LEADING reference (median of the
   * last {@link CUSUM_REFERENCE_TICKS} tick aggregates), whose ~3-tick lag
   * amplifies a coherent ramp of r m/tick into a steady innovation of
   * ≈ 3·r — so this allowance tolerates legitimate slow ramps (DEM error
   * gradients, ≲ 0.5 m/tick) while structure climbs (≥ ~0.8 m/tick) still
   * accumulate to the threshold within a few ticks.
   */
  readonly driftPerTickM?: number;
  /**
   * CUSUM trigger threshold (cumulative metres beyond the allowance).
   * Default 3.
   */
  readonly thresholdM?: number;
  /** Horizontal-extent corroboration window, seconds. Default 20. */
  readonly extentWindowSeconds?: number;
  /**
   * Extent below this counts as "climbed on the spot" and HALVES the CUSUM
   * threshold — corroboration only; extent never vetoes. Default 3.
   */
  readonly smallExtentM?: number;
  /**
   * Unfreeze when the per-tick aggregate re-enters this band around the
   * frozen value, metres. Default 1.5.
   */
  readonly unfreezeBandM?: number;
  /** Mean tick confidence below this freezes. Default 0.2. */
  readonly lowConfidence?: number;
  /**
   * Coverage required before the confidence-collapse check may fire,
   * seconds. Default 5.
   */
  readonly lowConfidenceSeconds?: number;
}

export interface ElevationOffsetOptions {
  /** Samples older than this fall out of the window, seconds. Default 45. */
  readonly windowSeconds?: number;
  /**
   * Samples farther than this from the current camera position fall out of
   * the window, metres. Default 20.
   */
  readonly distanceCapM?: number;
  /** Camera movement per tick that earns full novelty weight, metres. Default 1. */
  readonly noveltyRefM?: number;
  /** Output rate limit, metres per second. Default 0.5. */
  readonly slewRatePerSecondM?: number;
  readonly freeze?: ElevationOffsetFreezeOptions;
}

export interface ElevationOffsetState {
  /**
   * The BASELINE-FREE robust offset, or null until the window has minimal
   * sample mass. Callers add the live fused baseline at read time (see the
   * module docstring for why the baseline must not be folded in here).
   */
  readonly offsetM: number | null;
  /**
   * [0, 1]; grows with the window's PER-TICK-NORMALIZED mass — each tick
   * contributes novelty × mean hit quality, at most 1 regardless of hit
   * count (F6: intra-tick hits are correlated, so a denser depth grid must
   * not inflate confidence).
   */
  readonly confidence: number;
  /** True while the freeze layer holds the offset at its snapshot value. */
  readonly frozen: boolean;
}

export interface ElevationOffsetEstimator {
  update(tick: ElevationOffsetTick): ElevationOffsetState;
}

/**
 * Corpus/synthetic-calibrated defaults. Exposed so callers and tests can
 * reference the production configuration without restating numbers.
 */
export const DEFAULT_ELEVATION_OFFSET_OPTIONS = {
  windowSeconds: 45,
  distanceCapM: 20,
  noveltyRefM: 1,
  slewRatePerSecondM: 0.5,
  freeze: {
    driftPerTickM: 1.5,
    thresholdM: 3,
    extentWindowSeconds: 20,
    smallExtentM: 3,
    unfreezeBandM: 1.5,
    lowConfidence: 0.2,
    lowConfidenceSeconds: 5,
  },
} as const;

/**
 * Upper bound on the slew clock's `dt`, seconds — a GAP MUST NEVER BUY STEP
 * BUDGET, IT MAY ONLY DELAY PROGRESS.
 *
 * The step budget is `slewRatePerSecondM × dt` with `dt` measured in wall
 * clock, so any stretch without a tick accumulates budget the estimator never
 * spent: a consumer that withholds `update` while the pose is lost (the AR
 * demo's `holdThroughGap` does exactly that) would hand back a 20 s dt and
 * license a 10 m single-tick move of the whole world — against a window that
 * has meanwhile evicted and holds only the first post-gap tick's samples.
 * Enforcing the bound HERE rather than asking callers to tick faithfully is
 * deliberate: no consumer can opt out of it, and every consumer benefits.
 *
 * 2 s is ~2 ticks at the intended ~1 Hz cadence — generous enough that a
 * merely irregular cadence still catches up in one step, small enough that the
 * worst single step stays at the default 1 m.
 */
export const MAX_SLEW_DT_S = 2;

/** Floor for the confidence factor of a sample's weight (never 0 → no ∞/NaN). */
const MIN_CONFIDENCE_WEIGHT = 0.01;
/** Floor for the per-tick novelty factor (a standstill still updates, slowly). */
const NOVELTY_FLOOR = 0.02;
/**
 * Per-tick-normalized window mass at which output confidence saturates at 1
 * (cold-review F6 recalibration, corpus-measured 2026-08-18). Each window
 * tick contributes its NOVELTY × MEAN hit-confidence-weight — at most 1 per
 * tick regardless of hit count, because a tick's hits are intra-tick
 * correlated (one floor patch, one shared estimate confidence) and thirty
 * of them are not five times the evidence of six.
 *
 * The predecessor was a per-HIT mass (`CONFIDENCE_SATURATION_WEIGHT = 50`)
 * sized against "~6 hits/tick"; the production floor estimator actually
 * delivers a median 28 hits/tick (p90 72) over the 88-recording corpus
 * (`elevation-offset-production-corpus`), so the published confidence
 * saturated at ~1.0 on 72% of recordings and carried no signal. In tick
 * units the DISTANCE cap (20 m) holds a walking window to ~14 ticks (at
 * 1.4 m/s) of ~0.8 quality ≈ 11 → saturates, while a standstill window
 * (novelty-floored: 45 ticks × 0.02 × 0.8 ≈ 0.7) stays below 0.1 — the
 * same qualitative split the old sizing intended, now hit-count-invariant.
 */
const CONFIDENCE_SATURATION_TICK_MASS = 10;
/**
 * Minimal effective window weight before a COLD START may publish: one
 * full-confidence moving tick (~6 hits × 0.8 ≈ 4.8) clears it, a lone
 * floored-confidence hit does not. Applies to cold start only — an
 * established output holds through an emptied window with decaying
 * confidence (see the hold branch in `feed`), it does not flap to null.
 */
const MIN_OUTPUT_WEIGHT = 2;
/** Threshold multiplier while the horizontal extent is small (DEC: halves). */
const SMALL_EXTENT_THRESHOLD_FACTOR = 0.5;
/**
 * Leading-reference length for the CUSUM baseline, ticks. The median of
 * the last 5 aggregates lags the stream by ~3 ticks, which turns a step
 * into a full-height innovation for several ticks while a slow coherent
 * ramp contributes only ≈ 3 × rampRate per tick (absorbed by the drift
 * allowance).
 */
const CUSUM_REFERENCE_TICKS = 5;
/**
 * Consecutive in-band ticks required to unfreeze. One lucky in-band
 * aggregate in an out-of-band stream must not unfreeze mid-climb (and let
 * the next tick re-freeze a corrupted snapshot); three consecutive ticks
 * make the unfreeze a state decision instead of a coin flip.
 */
const UNFREEZE_STREAK_TICKS = 3;
/**
 * Confidence-collapse evidence gate: at least this many retained
 * sample-bearing ticks, spanning at least this long among themselves. An
 * absolute count deliberately replaces the old "span ≥ 90% of the window"
 * fraction, which could NEVER fire at degraded tick rates (at 0.5 Hz a
 * 5 s window retains ticks spanning at most 4 s).
 */
const MIN_COLLAPSE_TICKS = 3;
const MIN_COLLAPSE_SPAN_MS = 2500;
/**
 * e-folding time of the frozen-state confidence decay toward the live
 * tick stream's mean confidence, seconds: a frozen offset must not keep
 * advertising its healthy freeze-time confidence.
 */
const FROZEN_CONFIDENCE_TAU_S = 5;
/**
 * e-folding time of the hold-state confidence decay while the window is
 * empty (estimate-less gap), seconds — slower than the frozen decay
 * because a data gap is absence of evidence, not evidence of a problem.
 */
const HOLD_CONFIDENCE_TAU_S = 10;

type ResolvedFreeze = Readonly<Required<ElevationOffsetFreezeOptions>>;
type Resolved = Readonly<
  Required<Omit<ElevationOffsetOptions, 'freeze'>> & {
    freeze: ResolvedFreeze;
  }
>;

/**
 * Create the production elevation-offset estimator. Malformed OPTIONS
 * throw `RangeError` (a bad configuration is an upstream bug, not a data
 * condition); malformed tick DATA is handled defensively per `update`.
 */
export function createElevationOffsetEstimator(
  options?: ElevationOffsetOptions
): ElevationOffsetEstimator {
  return new SlewLimitedFrozenMedianEstimator(resolveOptions(options));
}

/** Boundary validation: malformed options are upstream bugs → RangeError. */
function resolveOptions(options: ElevationOffsetOptions = {}): Resolved {
  const d = DEFAULT_ELEVATION_OFFSET_OPTIONS;
  const resolved: Resolved = {
    windowSeconds: options.windowSeconds ?? d.windowSeconds,
    distanceCapM: options.distanceCapM ?? d.distanceCapM,
    noveltyRefM: options.noveltyRefM ?? d.noveltyRefM,
    slewRatePerSecondM: options.slewRatePerSecondM ?? d.slewRatePerSecondM,
    freeze: resolveFreezeOptions(options.freeze ?? {}),
  };
  validateOptions(resolved);
  return resolved;
}

function resolveFreezeOptions(f: ElevationOffsetFreezeOptions): ResolvedFreeze {
  const d = DEFAULT_ELEVATION_OFFSET_OPTIONS.freeze;
  return {
    driftPerTickM: f.driftPerTickM ?? d.driftPerTickM,
    thresholdM: f.thresholdM ?? d.thresholdM,
    extentWindowSeconds: f.extentWindowSeconds ?? d.extentWindowSeconds,
    smallExtentM: f.smallExtentM ?? d.smallExtentM,
    unfreezeBandM: f.unfreezeBandM ?? d.unfreezeBandM,
    lowConfidence: f.lowConfidence ?? d.lowConfidence,
    lowConfidenceSeconds: f.lowConfidenceSeconds ?? d.lowConfidenceSeconds,
  };
}

function validateOptions(r: Resolved): void {
  requireFiniteAbove('windowSeconds', r.windowSeconds, 0);
  requireFiniteAbove('distanceCapM', r.distanceCapM, 0);
  requireFiniteAbove('noveltyRefM', r.noveltyRefM, 0);
  requireFiniteAbove('slewRatePerSecondM', r.slewRatePerSecondM, 0);
  requireFiniteAtLeast('freeze.driftPerTickM', r.freeze.driftPerTickM, 0);
  requireFiniteAbove('freeze.thresholdM', r.freeze.thresholdM, 0);
  requireFiniteAbove(
    'freeze.extentWindowSeconds',
    r.freeze.extentWindowSeconds,
    0
  );
  requireFiniteAtLeast('freeze.smallExtentM', r.freeze.smallExtentM, 0);
  requireFiniteAbove('freeze.unfreezeBandM', r.freeze.unfreezeBandM, 0);
  requireUnitInterval('freeze.lowConfidence', r.freeze.lowConfidence);
  requireFiniteAbove(
    'freeze.lowConfidenceSeconds',
    r.freeze.lowConfidenceSeconds,
    0
  );
}

function requireFiniteAbove(
  name: string,
  v: number,
  exclusiveMin: number
): void {
  if (!Number.isFinite(v) || v <= exclusiveMin) {
    throw new RangeError(
      `${name} must be a finite number > ${exclusiveMin}, got ${v}`
    );
  }
}

function requireFiniteAtLeast(name: string, v: number, min: number): void {
  if (!Number.isFinite(v) || v < min) {
    throw new RangeError(`${name} must be a finite number >= ${min}, got ${v}`);
  }
}

function requireUnitInterval(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new RangeError(`${name} must be a finite number in [0, 1], got ${v}`);
  }
}

interface StoredSample {
  readonly tMs: number;
  readonly sampleM: number;
  readonly weight: number;
  readonly posE: number;
  readonly posN: number;
}

function confidenceWeight(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return MIN_CONFIDENCE_WEIGHT;
  }
  return Math.min(1, Math.max(MIN_CONFIDENCE_WEIGHT, confidence));
}

function isFiniteTick(tick: ElevationOffsetTick): boolean {
  return (
    Number.isFinite(tick.tMs) &&
    Number.isFinite(tick.posE) &&
    Number.isFinite(tick.posN) &&
    Number.isFinite(tick.cameraYar)
  );
}

/**
 * Per-tick aggregate for the freeze detector: the CONFIDENCE-WEIGHTED
 * lower median of the tick's finite sample values, using the same floored
 * weights as the window median — so a tick whose zero-confidence garbage
 * hits form the numeric majority still aggregates to the good hits' value
 * instead of handing the detector an outlier. A per-HIT detector would
 * accumulate N× too fast on intra-tick-correlated hits.
 *
 * `null` for a tick with no finite sample. That empty case is the only
 * reason this wraps {@link weightedMedian} rather than being it: the
 * shared helper returns NaN there, and every caller here branches on null.
 */
function tickAggregate(
  samples: readonly ElevationOffsetSample[]
): number | null {
  const finite = samples.filter((s) => Number.isFinite(s.sampleM));
  if (finite.length === 0) {
    return null;
  }
  // `confidenceWeight` floors strictly above 0 and is always finite, so
  // `weightedMedian` drops nothing and never reaches its own fallback.
  return weightedMedian(
    finite.map((s) => s.sampleM),
    finite.map((s) => confidenceWeight(s.confidence))
  );
}

/** Mean of the tick's sample confidences (0 for a sample-less tick). */
function meanTickConfidence(samples: readonly ElevationOffsetSample[]): number {
  if (samples.length === 0) {
    return 0;
  }
  return (
    samples.reduce((a, s) => a + clamp01(s.confidence), 0) / samples.length
  );
}

/**
 * The production configuration: slew-limited confidence-weighted median
 * over a time+distance-bounded novelty-weighted window, wrapped by the
 * CUSUM freeze layer. Private — constructed via
 * {@link createElevationOffsetEstimator}.
 */
class SlewLimitedFrozenMedianEstimator implements ElevationOffsetEstimator {
  private readonly entries: StoredSample[] = [];
  private prevFeedPos: { readonly e: number; readonly n: number } | null = null;
  /** The slew-limited output (the freeze layer snapshots it on trigger). */
  private outputM: number | null = null;
  private outputTMs = 0;
  /** Timestamp of the last real (finite) tick — anchors the unfreeze slew. */
  private lastTMs = 0;
  private lastConfidence = 0;
  private posSum = 0;
  private negSum = 0;
  /**
   * The CUSUM's LEADING reference: the last few tick aggregates (frozen
   * ticks included, so the reference is current at unfreeze time). Using
   * the slew-limited output as the reference instead would open an
   * ever-growing innovation on a legitimate slow ramp — the output lags by
   * design — and freeze the estimator on real data.
   */
  private readonly recentAggregates: number[] = [];
  /** Frozen-sample-value snapshot; non-null means frozen. */
  private frozenM: number | null = null;
  /** Consecutive in-band ticks observed while frozen. */
  private inBandStreak = 0;
  private readonly extentWindow: { tMs: number; e: number; n: number }[] = [];
  private readonly confWindow: { tMs: number; c: number }[] = [];

  constructor(private readonly opts: Resolved) {}

  update(tick: ElevationOffsetTick): ElevationOffsetState {
    if (!isFiniteTick(tick)) {
      // Tracking glitch: skip the whole tick, publish the previous state.
      return this.currentState();
    }
    const aggregateM = tickAggregate(tick.samples);
    const state = this.step(tick, aggregateM);
    // The leading reference sees every real tick's aggregate AFTER the
    // tick was handled — detection always compares against PREVIOUS ticks.
    if (aggregateM != null) {
      this.recentAggregates.push(aggregateM);
      if (this.recentAggregates.length > CUSUM_REFERENCE_TICKS) {
        this.recentAggregates.shift();
      }
    }
    this.lastTMs = tick.tMs;
    return state;
  }

  private step(
    tick: ElevationOffsetTick,
    aggregateM: number | null
  ): ElevationOffsetState {
    const extentM = this.trackExtent(tick);
    const collapsed = this.trackLowConfidence(tick);
    const thresholdM = this.effectiveThreshold(extentM);
    if (this.frozenM != null) {
      return this.frozenTick(tick, aggregateM, collapsed);
    }
    // Detection runs BEFORE feeding: the trigger tick must not reach the
    // window, or the climb's first samples would already bias the median.
    if (this.stepDetected(aggregateM, thresholdM)) {
      return this.freeze();
    }
    if (collapsed && this.outputM != null) {
      return this.freeze();
    }
    return this.feed(tick);
  }

  private currentState(): ElevationOffsetState {
    if (this.frozenM != null) {
      return {
        offsetM: this.frozenM,
        confidence: this.lastConfidence,
        frozen: true,
      };
    }
    return {
      offsetM: this.outputM,
      confidence: this.outputM == null ? 0 : this.lastConfidence,
      frozen: false,
    };
  }

  /** While extent is small the trigger is STRENGTHENED — never vetoed. */
  private effectiveThreshold(extentM: number): number {
    const f = this.opts.freeze;
    return extentM < f.smallExtentM
      ? f.thresholdM * SMALL_EXTENT_THRESHOLD_FACTOR
      : f.thresholdM;
  }

  /**
   * While frozen: STATE-based unfreeze check only — never a timer. The
   * unfreeze requires {@link UNFREEZE_STREAK_TICKS} CONSECUTIVE in-band
   * ticks, and the published confidence decays toward the live tick
   * stream's mean confidence (so a frozen offset stops advertising its
   * healthy freeze-time confidence while its inputs degrade).
   */
  private frozenTick(
    tick: ElevationOffsetTick,
    aggregateM: number | null,
    collapsed: boolean
  ): ElevationOffsetState {
    const dtS = Math.max(0, (tick.tMs - this.lastTMs) / 1000);
    const blend = 1 - Math.exp(-dtS / FROZEN_CONFIDENCE_TAU_S);
    this.lastConfidence +=
      (meanTickConfidence(tick.samples) - this.lastConfidence) * blend;
    const inBand =
      aggregateM != null &&
      this.frozenM != null &&
      Math.abs(aggregateM - this.frozenM) <= this.opts.freeze.unfreezeBandM;
    if (!inBand || collapsed) {
      this.inBandStreak = 0;
      return this.currentState();
    }
    this.inBandStreak++;
    if (this.inBandStreak < UNFREEZE_STREAK_TICKS) {
      return this.currentState();
    }
    // Resume FROM the frozen value. The slew clock re-anchors to the
    // PREVIOUS tick's time: no retroactive slew credit for the dwell, but
    // a normal one-tick step budget on this very tick (anchoring to the
    // tick itself would make dt = 0 and wedge the resume).
    this.outputM = this.frozenM;
    this.outputTMs = this.lastTMs;
    this.frozenM = null;
    this.inBandStreak = 0;
    this.posSum = 0;
    this.negSum = 0;
    return this.feed(tick);
  }

  private freeze(): ElevationOffsetState {
    // Both call sites guarantee outputM non-null: stepDetected requires it
    // as the snapshot source, and the collapse branch checks it explicitly.
    this.frozenM = this.outputM;
    this.inBandStreak = 0;
    return this.currentState();
  }

  /**
   * Two-sided CUSUM with drift allowance against the LEADING reference
   * (median of the last few tick aggregates); accumulates only on real
   * ticks. See {@link CUSUM_REFERENCE_TICKS} and the driftPerTickM option
   * doc for why the reference must lead, not lag: a slow coherent ramp
   * (DEM error gradient on a hill) must read as small bounded innovation,
   * while a structure step opens a full-height gap for several ticks.
   * `outputM` must exist before anything may freeze (it is the snapshot).
   */
  private stepDetected(aggregateM: number | null, thresholdM: number): boolean {
    if (aggregateM == null || this.outputM == null) {
      return false;
    }
    if (this.recentAggregates.length === 0) {
      return false;
    }
    const referenceM = lowerMedian(this.recentAggregates);
    const innovation = aggregateM - referenceM;
    const drift = this.opts.freeze.driftPerTickM;
    this.posSum = Math.max(0, this.posSum + innovation - drift);
    this.negSum = Math.max(0, this.negSum - innovation - drift);
    return this.posSum > thresholdM || this.negSum > thresholdM;
  }

  private feed(tick: ElevationOffsetTick): ElevationOffsetState {
    this.admit(tick);
    const { medianM, totalWeight, tickMassSum } = this.windowMedian();
    if (medianM == null) {
      if (this.outputM == null) {
        // True cold start with an empty window: nothing to publish.
        this.lastConfidence = 0;
        return this.currentState();
      }
      // Established output + emptied window (estimate-less gap, far move):
      // HOLD the output with exponentially decaying confidence instead of
      // flapping to null, and keep the slew clock current so recovery
      // SLEWS from here (a stale clock would grant the whole gap as one
      // giant step budget — a jump).
      const dtS = Math.max(0, (tick.tMs - this.outputTMs) / 1000);
      this.lastConfidence *= Math.exp(-dtS / HOLD_CONFIDENCE_TAU_S);
      this.outputTMs = tick.tMs;
      return this.currentState();
    }
    if (this.outputM == null) {
      if (totalWeight < MIN_OUTPUT_WEIGHT) {
        this.lastConfidence = 0;
        return this.currentState();
      }
      this.outputM = medianM;
    } else {
      // CLAMPED dt: see MAX_SLEW_DT_S — an unticked stretch must not be
      // cashed in as one giant step. The clock still advances to `tick.tMs`
      // below, so the gap delays the catch-up instead of licensing a jump.
      const dtS = Math.min(
        MAX_SLEW_DT_S,
        Math.max(0, (tick.tMs - this.outputTMs) / 1000)
      );
      const maxStepM = this.opts.slewRatePerSecondM * dtS;
      const delta = medianM - this.outputM;
      this.outputM += Math.min(maxStepM, Math.max(-maxStepM, delta));
    }
    this.outputTMs = tick.tMs;
    // PER-TICK-NORMALIZED confidence (F6): the window's mass in "effective
    // full-quality tick" units, so a denser depth grid cannot inflate it.
    // The MEDIAN above still weighs every hit — per-hit weights are what
    // make it robust; only the CONFIDENCE is normalized.
    this.lastConfidence = Math.min(
      1,
      tickMassSum / CONFIDENCE_SATURATION_TICK_MASS
    );
    return this.currentState();
  }

  /**
   * Admit the tick's finite samples at a shared per-tick novelty weight,
   * then evict by time AND by distance from the current camera position.
   */
  private admit(tick: ElevationOffsetTick): void {
    const novelty = this.noveltyWeight(tick);
    this.prevFeedPos = { e: tick.posE, n: tick.posN };
    for (const s of tick.samples) {
      if (
        !Number.isFinite(s.sampleM) ||
        !Number.isFinite(s.posE) ||
        !Number.isFinite(s.posN)
      ) {
        continue;
      }
      this.entries.push({
        tMs: tick.tMs,
        sampleM: s.sampleM,
        weight: novelty * confidenceWeight(s.confidence),
        posE: s.posE,
        posN: s.posN,
      });
    }
    this.evict(tick);
  }

  private noveltyWeight(tick: ElevationOffsetTick): number {
    if (this.prevFeedPos == null) {
      return 1;
    }
    const moved = Math.hypot(
      tick.posE - this.prevFeedPos.e,
      tick.posN - this.prevFeedPos.n
    );
    return Math.max(NOVELTY_FLOOR, Math.min(1, moved / this.opts.noveltyRefM));
  }

  private evict(tick: ElevationOffsetTick): void {
    const minTMs = tick.tMs - this.opts.windowSeconds * 1000;
    const capM = this.opts.distanceCapM;
    let write = 0;
    for (const e of this.entries) {
      const inTime = e.tMs >= minTMs;
      const inRange =
        Math.hypot(e.posE - tick.posE, e.posN - tick.posN) <= capM;
      if (inTime && inRange) {
        this.entries[write++] = e;
      }
    }
    this.entries.length = write;
  }

  /**
   * Lower weighted median of the window plus two mass readings: the total
   * per-HIT effective weight (the cold-start gate's unit) and the per-TICK-
   * normalized mass (the confidence unit, F6) — each retained tick
   * contributes the MEAN of its hits' weights, i.e. novelty × mean hit
   * quality, at most 1 however many hits the tick carried.
   */
  private windowMedian(): {
    medianM: number | null;
    totalWeight: number;
    tickMassSum: number;
  } {
    if (this.entries.length === 0) {
      return { medianM: null, totalWeight: 0, tickMassSum: 0 };
    }
    const sorted = [...this.entries].sort((a, b) => a.sampleM - b.sampleM);
    let totalWeight = 0;
    const perTick = new Map<number, { sum: number; count: number }>();
    for (const e of sorted) {
      totalWeight += e.weight;
      const t = perTick.get(e.tMs);
      if (t) {
        t.sum += e.weight;
        t.count += 1;
      } else {
        perTick.set(e.tMs, { sum: e.weight, count: 1 });
      }
    }
    let tickMassSum = 0;
    for (const t of perTick.values()) {
      tickMassSum += t.sum / t.count;
    }
    const half = totalWeight / 2;
    let medianM: number | null = null;
    let acc = 0;
    for (const e of sorted) {
      acc += e.weight;
      if (acc >= half) {
        medianM = e.sampleM;
        break;
      }
    }
    // Weights are floored strictly above 0, so the loop always assigns.
    return { medianM, totalWeight, tickMassSum };
  }

  /** Extent = max distance from the window's FIRST position (never path length). */
  private trackExtent(tick: ElevationOffsetTick): number {
    this.extentWindow.push({ tMs: tick.tMs, e: tick.posE, n: tick.posN });
    const minTMs = tick.tMs - this.opts.freeze.extentWindowSeconds * 1000;
    let head = this.extentWindow[0];
    while (head != null && head.tMs < minTMs) {
      this.extentWindow.shift();
      head = this.extentWindow[0];
    }
    const first = this.extentWindow[0];
    if (first == null) {
      return 0;
    }
    let extentM = 0;
    for (const p of this.extentWindow) {
      extentM = Math.max(extentM, Math.hypot(p.e - first.e, p.n - first.n));
    }
    return extentM;
  }

  /** True when mean tick confidence collapsed over enough real evidence. */
  private trackLowConfidence(tick: ElevationOffsetTick): boolean {
    // Sample-less ticks carry no confidence evidence: they are a data gap
    // (the hold path's territory), not a collapsing source — only
    // sample-bearing ticks enter the window. Eviction still runs per tick.
    if (tick.samples.length > 0) {
      this.confWindow.push({
        tMs: tick.tMs,
        c: meanTickConfidence(tick.samples),
      });
    }
    const windowMs = this.opts.freeze.lowConfidenceSeconds * 1000;
    const minTMs = tick.tMs - windowMs;
    let head = this.confWindow[0];
    while (head != null && head.tMs < minTMs) {
      this.confWindow.shift();
      head = this.confWindow[0];
    }
    const first = this.confWindow[0];
    const last = this.confWindow[this.confWindow.length - 1];
    if (first == null || last == null) {
      return false;
    }
    // Absolute evidence gate (works at degraded tick rates — see the
    // MIN_COLLAPSE_* constants): enough retained ticks, spanning enough
    // time among themselves. A single early low-confidence tick can still
    // never freeze a fresh session.
    const spanMs = last.tMs - first.tMs;
    if (
      this.confWindow.length < MIN_COLLAPSE_TICKS ||
      spanMs < MIN_COLLAPSE_SPAN_MS
    ) {
      return false;
    }
    const mean =
      this.confWindow.reduce((a, x) => a + x.c, 0) / this.confWindow.length;
    return mean < this.opts.freeze.lowConfidence;
  }
}
