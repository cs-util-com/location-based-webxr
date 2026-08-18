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
  /** CUSUM innovation allowance subtracted per tick, metres. Default 0.2. */
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
  /** [0, 1]; grows with accumulated effective (novelty × confidence) weight. */
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
    driftPerTickM: 0.2,
    thresholdM: 3,
    extentWindowSeconds: 20,
    smallExtentM: 3,
    unfreezeBandM: 1.5,
    lowConfidence: 0.2,
    lowConfidenceSeconds: 5,
  },
} as const;

/** Floor for the confidence factor of a sample's weight (never 0 → no ∞/NaN). */
const MIN_CONFIDENCE_WEIGHT = 0.01;
/** Floor for the per-tick novelty factor (a standstill still updates, slowly). */
const NOVELTY_FLOOR = 0.02;
/**
 * Total effective weight at which output confidence saturates at 1. Sized
 * so a moving window (~45 ticks × 6 hits × conf 0.8 ≈ 200) saturates while
 * a standstill window (novelty-floored, ≈ 10) stays clearly below 0.3.
 */
const CONFIDENCE_SATURATION_WEIGHT = 50;
/**
 * Minimal effective window weight before a COLD START may publish: one
 * full-confidence moving tick (~6 hits × 0.8 ≈ 4.8) clears it, a lone
 * floored-confidence hit does not. Applies to cold start only — an
 * established output degrades via confidence, it does not flap to null.
 */
const MIN_OUTPUT_WEIGHT = 2;
/** Threshold multiplier while the horizontal extent is small (DEC: halves). */
const SMALL_EXTENT_THRESHOLD_FACTOR = 0.5;
/**
 * Fraction of the confidence window that must have coverage before the
 * collapse check may fire — a single early low-confidence tick must not
 * freeze a fresh session.
 */
const CONFIDENCE_COVERAGE_FRACTION = 0.9;

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

function finiteConfidence(c: number): number {
  return Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
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
 * Per-tick aggregate for the freeze detector: the lower median of the
 * tick's finite sample values. A per-HIT detector would accumulate N×
 * too fast on intra-tick-correlated hits.
 */
function tickAggregate(
  samples: readonly ElevationOffsetSample[]
): number | null {
  const values = samples
    .map((s) => s.sampleM)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return null;
  }
  return values[(values.length - 1) >> 1] ?? null;
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
  /** The slew-limited output — also the CUSUM's slow reference. */
  private outputM: number | null = null;
  private outputTMs = 0;
  private lastConfidence = 0;
  private posSum = 0;
  private negSum = 0;
  /** Frozen-sample-value snapshot; non-null means frozen. */
  private frozenM: number | null = null;
  private readonly extentWindow: { tMs: number; e: number; n: number }[] = [];
  private readonly confWindow: { tMs: number; c: number }[] = [];

  constructor(private readonly opts: Resolved) {}

  update(tick: ElevationOffsetTick): ElevationOffsetState {
    if (!isFiniteTick(tick)) {
      // Tracking glitch: skip the whole tick, publish the previous state.
      return this.currentState();
    }
    const aggregateM = tickAggregate(tick.samples);
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

  /** While frozen: STATE-based unfreeze check only — never a timer. */
  private frozenTick(
    tick: ElevationOffsetTick,
    aggregateM: number | null,
    collapsed: boolean
  ): ElevationOffsetState {
    const inBand =
      aggregateM != null &&
      this.frozenM != null &&
      Math.abs(aggregateM - this.frozenM) <= this.opts.freeze.unfreezeBandM;
    if (!inBand || collapsed) {
      return this.currentState();
    }
    // Resume FROM the frozen value, rate-limited from this tick on (no
    // retroactive slew credit for the dwell time).
    this.outputM = this.frozenM;
    this.outputTMs = tick.tMs;
    this.frozenM = null;
    this.posSum = 0;
    this.negSum = 0;
    return this.feed(tick);
  }

  private freeze(): ElevationOffsetState {
    // Both call sites guarantee outputM non-null: stepDetected needs it as
    // the CUSUM reference, and the collapse branch checks it explicitly.
    this.frozenM = this.outputM;
    return this.currentState();
  }

  /** Two-sided CUSUM with drift allowance; accumulates only on real ticks. */
  private stepDetected(aggregateM: number | null, thresholdM: number): boolean {
    if (aggregateM == null || this.outputM == null) {
      return false;
    }
    const innovation = aggregateM - this.outputM;
    const drift = this.opts.freeze.driftPerTickM;
    this.posSum = Math.max(0, this.posSum + innovation - drift);
    this.negSum = Math.max(0, this.negSum - innovation - drift);
    return this.posSum > thresholdM || this.negSum > thresholdM;
  }

  private feed(tick: ElevationOffsetTick): ElevationOffsetState {
    this.admit(tick);
    const { medianM, totalWeight } = this.windowMedian();
    if (medianM == null) {
      // Window emptied (long gap / far move): reset to the cold-start state.
      this.outputM = null;
      this.lastConfidence = 0;
      return this.currentState();
    }
    if (this.outputM == null) {
      if (totalWeight < MIN_OUTPUT_WEIGHT) {
        this.lastConfidence = 0;
        return this.currentState();
      }
      this.outputM = medianM;
    } else {
      const dtS = Math.max(0, (tick.tMs - this.outputTMs) / 1000);
      const maxStepM = this.opts.slewRatePerSecondM * dtS;
      const delta = medianM - this.outputM;
      this.outputM += Math.min(maxStepM, Math.max(-maxStepM, delta));
    }
    this.outputTMs = tick.tMs;
    this.lastConfidence = Math.min(
      1,
      totalWeight / CONFIDENCE_SATURATION_WEIGHT
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

  /** Lower weighted median of the window plus its total effective weight. */
  private windowMedian(): { medianM: number | null; totalWeight: number } {
    if (this.entries.length === 0) {
      return { medianM: null, totalWeight: 0 };
    }
    const sorted = [...this.entries].sort((a, b) => a.sampleM - b.sampleM);
    let totalWeight = 0;
    for (const e of sorted) {
      totalWeight += e.weight;
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
    return { medianM, totalWeight };
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

  /** True when mean tick confidence collapsed over a full window of coverage. */
  private trackLowConfidence(tick: ElevationOffsetTick): boolean {
    const meanC =
      tick.samples.length > 0
        ? tick.samples.reduce((a, s) => a + finiteConfidence(s.confidence), 0) /
          tick.samples.length
        : 0;
    this.confWindow.push({ tMs: tick.tMs, c: meanC });
    const windowMs = this.opts.freeze.lowConfidenceSeconds * 1000;
    const minTMs = tick.tMs - windowMs;
    let head = this.confWindow[0];
    while (head != null && head.tMs < minTMs) {
      this.confWindow.shift();
      head = this.confWindow[0];
    }
    const first = this.confWindow[0];
    if (first == null) {
      return false;
    }
    const spanMs = tick.tMs - first.tMs;
    if (spanMs < windowMs * CONFIDENCE_COVERAGE_FRACTION) {
      return false;
    }
    const mean =
      this.confWindow.reduce((a, x) => a + x.c, 0) / this.confWindow.length;
    return mean < this.opts.freeze.lowConfidence;
  }
}
