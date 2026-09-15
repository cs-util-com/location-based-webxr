/**
 * The alignment-timing loop: how long one GPS fix costs, at a growing stored
 * history, under several configurations.
 *
 * Pure and transport-free by design. It knows nothing about the library, the
 * store, the DOM or the recording - it is handed a fix COUNT, a factory that
 * produces a fresh per-fix function for one pass, and a clock. That is what
 * makes it testable against a fake whose cost is known exactly, which matters
 * more here than usual: the quantity under measurement is the one thing a test
 * of the real path could never assert.
 *
 * The three method rules it encodes, each of which cost a correction when it
 * was missing from an earlier measurement of the same quantity:
 *
 * 1. **Warm-ups are discarded**, and still reported, so a reader can see how
 *    large the discard was.
 * 2. **Arms are interleaved within a pass.** Timing one arm's whole run before
 *    the next reads the device's load as if it were the configuration.
 * 3. **The reported cost is MARGINAL, not mean.** `total / fixes` is the mean
 *    over a history growing from 1 to N, roughly half what the live app pays
 *    for its next fix.
 */

/** Progress after a completed pass - one arm, one repeat. */
export interface AlignmentTimingProgress {
  readonly completedPasses: number;
  readonly totalPasses: number;
  readonly armId: string;
  /** True while the pass that just finished was a discarded warm-up. */
  readonly warmup: boolean;
}

export interface AlignmentTimingOptions {
  /** Distinct arm ids, run in this order within every pass. */
  readonly armIds: readonly string[];
  /** Fixes in the recording; every pass applies all of them. */
  readonly fixCount: number;
  /** Requested history rungs; see {@link resolveLadder}. */
  readonly ladder: readonly number[];
  /** Timed passes per arm. */
  readonly repeats: number;
  /** Discarded passes per arm, run before the timed ones. */
  readonly warmups: number;
  /**
   * Start one pass for `armId`: returns the function that applies fix
   * `fixIndex` to a FRESH, empty history. Called once per pass - a reused
   * history would make every repeat after the first dearer than the app pays.
   */
  readonly createPass: (armId: string) => (fixIndex: number) => void;
  /** Monotonic clock in milliseconds (`performance.now` in the page). */
  readonly now: () => number;
  readonly onProgress?: (progress: AlignmentTimingProgress) => void;
  /**
   * Hands the UI thread back between passes. Never called mid-pass: a yield
   * inside a timed pass would put the scheduler's latency into the figure.
   */
  readonly yieldControl?: () => Promise<void>;
}

/** One rung-to-rung span of stored history, and its per-fix cost. */
export interface AlignmentTimingSegment {
  /** Fixes already applied when the segment starts. */
  readonly fromHistory: number;
  /** Fixes applied when it ends. */
  readonly toHistory: number;
  /** Stored history the marginal cost is quoted at: the segment's midpoint. */
  readonly midHistory: number;
  /** Fixes charged to this segment. */
  readonly fixCount: number;
  readonly medianMsPerFix: number;
  readonly minMsPerFix: number;
  /** Every kept repeat, in run order, so the statistics can be re-derived. */
  readonly msPerFixPerRepeat: readonly number[];
}

export interface AlignmentTimingArmResult {
  readonly armId: string;
  readonly segments: readonly AlignmentTimingSegment[];
  readonly totalMedianMs: number;
  readonly totalMinMs: number;
  readonly totalMsPerRepeat: readonly number[];
  /** Whole-pass totals of the discarded warm-ups, in run order. */
  readonly warmupTotalMs: readonly number[];
}

export interface AlignmentTimingParameters {
  readonly fixCount: number;
  /** The ladder actually used, after {@link resolveLadder}. */
  readonly ladder: readonly number[];
  readonly repeats: number;
  readonly warmups: number;
}

export interface AlignmentTimingResult {
  readonly parameters: AlignmentTimingParameters;
  readonly arms: readonly AlignmentTimingArmResult[];
}

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${what} must be a positive integer, got ${value}`);
  }
}

/**
 * Turn the requested rungs into the rungs a recording of `fixCount` fixes can
 * actually carry: sorted, de-duplicated, every rung at or above the fix count
 * dropped, and the full history appended as the last rung.
 *
 * Rungs are dropped rather than clamped on purpose. A clamped rung would be
 * the same history length as the final one wearing a different label, and two
 * identical columns read as an agreement between two measurements.
 *
 * @throws RangeError if `fixCount` or any rung is not a positive integer.
 */
export function resolveLadder(
  ladder: readonly number[],
  fixCount: number
): number[] {
  assertPositiveInteger(fixCount, 'fixCount');
  for (const rung of ladder) assertPositiveInteger(rung, 'every ladder rung');
  const inside = [...new Set(ladder)].filter((r) => r < fixCount);
  inside.sort((a, b) => a - b);
  return [...inside, fixCount];
}

/** Median of a non-empty list; the mean of the two middle values when even. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Cumulative milliseconds at each ladder rung of one pass, plus the total. */
interface PassTiming {
  readonly cumulativeMs: readonly number[];
  readonly totalMs: number;
}

function runOnePass(
  applyFix: (fixIndex: number) => void,
  rungs: readonly number[],
  now: () => number
): PassTiming {
  const cumulativeMs: number[] = [];
  let nextRung = 0;
  const started = now();
  for (let i = 0; i < rungs[rungs.length - 1]!; i++) {
    applyFix(i);
    // A clock read only at a rung boundary: at most a handful per pass, and
    // never inside the span being charged to a single fix.
    while (nextRung < rungs.length && i + 1 === rungs[nextRung]) {
      cumulativeMs.push(now() - started);
      nextRung++;
    }
  }
  return { cumulativeMs, totalMs: cumulativeMs[cumulativeMs.length - 1]! };
}

/**
 * Refuse a malformed run before any pass is started. Separate from the loop so
 * the loop body stays one readable shape.
 */
function assertRunnable(options: AlignmentTimingOptions): void {
  assertPositiveInteger(options.repeats, 'repeats');
  if (!Number.isInteger(options.warmups) || options.warmups < 0) {
    throw new RangeError(
      `warmups must be a non-negative integer, got ${options.warmups}`
    );
  }
  if (options.armIds.length === 0) {
    throw new RangeError('at least one arm is required');
  }
  if (new Set(options.armIds).size !== options.armIds.length) {
    throw new RangeError(
      `arm ids must be distinct, got ${options.armIds.join(', ')}`
    );
  }
}

/**
 * Run the whole measurement: `warmups + repeats` passes per arm, arms
 * interleaved within each pass.
 *
 * @throws RangeError on a malformed parameter - a silent clamp would produce a
 *   report whose header does not describe the run that produced it.
 */
export async function runAlignmentTiming(
  options: AlignmentTimingOptions
): Promise<AlignmentTimingResult> {
  const {
    armIds,
    fixCount,
    ladder,
    repeats,
    warmups,
    createPass,
    now,
    onProgress,
    yieldControl,
  } = options;

  assertRunnable(options);
  const rungs = resolveLadder(ladder, fixCount);

  const warmupTotals = new Map<string, number[]>();
  const timedPasses = new Map<string, PassTiming[]>();
  for (const armId of armIds) {
    warmupTotals.set(armId, []);
    timedPasses.set(armId, []);
  }

  const totalPasses = (warmups + repeats) * armIds.length;
  let completedPasses = 0;

  for (let pass = 0; pass < warmups + repeats; pass++) {
    const warmup = pass < warmups;
    for (const armId of armIds) {
      const timing = runOnePass(createPass(armId), rungs, now);
      if (warmup) {
        warmupTotals.get(armId)!.push(timing.totalMs);
      } else {
        timedPasses.get(armId)!.push(timing);
      }
      completedPasses++;
      onProgress?.({ completedPasses, totalPasses, armId, warmup });
      if (yieldControl) await yieldControl();
    }
  }

  const arms = armIds.map((armId): AlignmentTimingArmResult => {
    const passes = timedPasses.get(armId)!;
    const segments = rungs.map((toHistory, index): AlignmentTimingSegment => {
      const fromHistory = index === 0 ? 0 : rungs[index - 1]!;
      const span = toHistory - fromHistory;
      const msPerFixPerRepeat = passes.map((p) => {
        const before = index === 0 ? 0 : p.cumulativeMs[index - 1]!;
        return (p.cumulativeMs[index]! - before) / span;
      });
      return {
        fromHistory,
        toHistory,
        midHistory: (fromHistory + toHistory) / 2,
        fixCount: span,
        medianMsPerFix: median(msPerFixPerRepeat),
        minMsPerFix: Math.min(...msPerFixPerRepeat),
        msPerFixPerRepeat,
      };
    });
    const totalMsPerRepeat = passes.map((p) => p.totalMs);
    return {
      armId,
      segments,
      totalMedianMs: median(totalMsPerRepeat),
      totalMinMs: Math.min(...totalMsPerRepeat),
      totalMsPerRepeat,
      warmupTotalMs: warmupTotals.get(armId)!,
    };
  });

  return {
    parameters: { fixCount, ladder: rungs, repeats, warmups },
    arms,
  };
}
