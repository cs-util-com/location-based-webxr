/**
 * The hitch attribution join: which events are over-represented in slow
 * frames (globe zoom performance plan 2026-10-03-2017, §4.1 "Attribution
 * rule", review Major 5; PERF-0).
 *
 * Streaming and constant-memory per event kind: a run of 26,000 frames
 * keeps only the last `max(lag)` frames' events and a table of counts, so
 * the join covers the whole run, not a ring.
 *
 * @see frame-attribution.ts.md
 */

import { FRAME_HITCH_THRESHOLDS_MS } from './frame-histogram.js';

/** The `k` values every verdict is swept over (plan §4.3). */
export const ATTRIBUTION_KS: readonly number[] = [3, 5, 10];
/** The lag windows, in frames after the event, swept (plan §4.3). */
export const ATTRIBUTION_LAGS: readonly number[] = [0, 1, 2];
/** A cause needs at least this many hitch frames: two coincidences never make a cause. */
export const ATTRIBUTION_MIN_HITCH_FRAMES = 5;

export interface HitchAttributionOptions {
  /** Hitch thresholds, ms ("strictly over"). Default 33 / 50 / 100. */
  readonly thresholdsMs?: readonly number[];
  /** Lag windows, frames (non-negative integers). Default 0 / 1 / 2. */
  readonly lags?: readonly number[];
}

/** One event kind's counts, indexed `[threshold][lag]` as in {@link AttributionCounts}. */
interface KindCounts {
  /** Hitch frames whose lag window contains the event. */
  readonly inHitch: readonly (readonly number[])[];
  /** Normal frames whose lag window contains the event. */
  readonly inNormal: readonly (readonly number[])[];
}

/**
 * The join's raw counts: plain data, so an export can carry them and a
 * reader can recompute any verdict.
 */
export interface AttributionCounts {
  /** Ascending. */
  readonly thresholdsMs: readonly number[];
  /** Ascending. */
  readonly lags: readonly number[];
  /** Accepted frames. */
  readonly frames: number;
  /** Frames refused for a non-finite or negative interval. */
  readonly rejected: number;
  /** Hitch frames per threshold; normal frames are `frames` minus these. */
  readonly hitchFrames: readonly number[];
  readonly kinds: Readonly<Record<string, KindCounts>>;
}

export interface AttributionVerdictOptions {
  /** Default {@link ATTRIBUTION_KS}. */
  readonly ks?: readonly number[];
  /** Default {@link ATTRIBUTION_MIN_HITCH_FRAMES}. */
  readonly minHitchFrames?: number;
}

/** One cell of the sweep for one event kind. */
interface CauseCell {
  readonly thresholdMs: number;
  readonly lag: number;
  readonly k: number;
  readonly inHitch: number;
  readonly inNormal: number;
  /**
   * Hitch-frame rate over normal-frame rate; `Infinity` when the event was
   * never in a normal frame; `null` when either side has no frames (the
   * comparison is undefined).
   */
  readonly ratio: number | null;
  readonly supported: boolean;
}

export interface CauseVerdict {
  readonly kind: string;
  /** `supported` at every cell, `provisional` at some, `unsupported` at none. */
  readonly status: 'supported' | 'provisional' | 'unsupported';
  readonly supportedCells: number;
  readonly totalCells: number;
  readonly cells: readonly CauseCell[];
}

function sortedUnique(
  name: string,
  values: readonly number[],
  valid: (v: number) => boolean
): number[] {
  if (values.length === 0) throw new RangeError(`${name} must not be empty`);
  for (const v of values) {
    if (!valid(v))
      throw new RangeError(`${name} has an invalid value ${String(v)}`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

const isThreshold = (v: number) => Number.isFinite(v) && v >= 0;
const isLag = (v: number) => Number.isInteger(v) && v >= 0;

/**
 * Creates the streaming join. Call `endFrame(intervalMs, events)` once per
 * frame, with the events that fell in that frame; an event name is counted
 * once per window however often it fired.
 *
 * A frame with a non-finite or negative interval is refused whole (its
 * events too) and counted in `rejected`.
 *
 * @throws RangeError for an empty, negative, non-finite or (for lags)
 *   non-integer option value.
 */
export function createHitchAttribution(options: HitchAttributionOptions = {}): {
  endFrame(intervalMs: number, events: readonly string[]): boolean;
  counts(): AttributionCounts;
} {
  const thresholds = sortedUnique(
    'thresholdsMs',
    options.thresholdsMs ?? FRAME_HITCH_THRESHOLDS_MS,
    isThreshold
  );
  const lags = sortedUnique('lags', options.lags ?? ATTRIBUTION_LAGS, isLag);
  const maxLag = lags[lags.length - 1]!;
  const table = (): number[][] =>
    thresholds.map(() => new Array<number>(lags.length).fill(0));

  /** Event sets of the previous `maxLag` frames, newest first. */
  const history: Set<string>[] = [];
  const kinds = new Map<
    string,
    { inHitch: number[][]; inNormal: number[][] }
  >();
  const hitchFrames = new Array<number>(thresholds.length).fill(0);
  let frames = 0;
  let rejected = 0;

  return {
    endFrame(intervalMs, events) {
      if (!(Number.isFinite(intervalMs) && intervalMs >= 0)) {
        rejected++;
        return false;
      }
      const current = new Set<string>();
      for (const e of events)
        if (typeof e === 'string' && e !== '') current.add(e);

      const isHitch = thresholds.map((t) => intervalMs > t);
      isHitch.forEach((hit, ti) => {
        if (hit) hitchFrames[ti]!++;
      });

      // The window of lag L is this frame plus the L frames before it;
      // grown one frame at a time across the ascending lags.
      const window = new Set(current);
      let reached = 0;
      lags.forEach((lag, li) => {
        for (; reached < lag && reached < history.length; reached++) {
          for (const e of history[reached]!) window.add(e);
        }
        for (const kind of window) {
          let k = kinds.get(kind);
          if (k === undefined) {
            k = { inHitch: table(), inNormal: table() };
            kinds.set(kind, k);
          }
          for (let ti = 0; ti < thresholds.length; ti++) {
            (isHitch[ti] ? k.inHitch : k.inNormal)[ti]![li]!++;
          }
        }
      });

      history.unshift(current);
      if (history.length > maxLag) history.length = maxLag;
      frames++;
      return true;
    },
    counts() {
      const copy: Record<string, KindCounts> = {};
      for (const [kind, k] of kinds) {
        copy[kind] = {
          inHitch: k.inHitch.map((row) => [...row]),
          inNormal: k.inNormal.map((row) => [...row]),
        };
      }
      return {
        thresholdsMs: [...thresholds],
        lags: [...lags],
        frames,
        rejected,
        hitchFrames: [...hitchFrames],
        kinds: copy,
      };
    },
  };
}

/**
 * The counts of several runs added together, for a verdict over all of
 * them: the three repeats of a sweep cell, or a whole sweep. A warm run
 * that meets the target has at most 5 frames over 33 ms, so one run alone
 * rarely reaches the minimum of hitch frames.
 *
 * Each run's lag windows stop at its own first frame, so the pool is the
 * sum, not a run over the concatenated frames (the two agree at lag 0).
 *
 * @throws RangeError for an empty list, or runs counted at different
 *   thresholds or lags.
 */
export function poolAttributionCounts(
  runs: readonly AttributionCounts[]
): AttributionCounts {
  const first = runs[0];
  if (first === undefined) throw new RangeError('nothing to pool');
  const same = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  for (const r of runs) {
    if (
      !same(r.thresholdsMs, first.thresholdsMs) ||
      !same(r.lags, first.lags)
    ) {
      throw new RangeError(
        'runs counted at different thresholds or lags cannot be pooled'
      );
    }
  }
  const zero = (): number[][] =>
    first.thresholdsMs.map(() => new Array<number>(first.lags.length).fill(0));
  const kinds: Record<string, { inHitch: number[][]; inNormal: number[][] }> =
    {};
  const hitchFrames = new Array<number>(first.thresholdsMs.length).fill(0);
  let frames = 0;
  let rejected = 0;
  for (const r of runs) {
    frames += r.frames;
    rejected += r.rejected;
    r.hitchFrames.forEach((n, ti) => {
      hitchFrames[ti]! += n;
    });
    for (const [kind, k] of Object.entries(r.kinds)) {
      const into = (kinds[kind] ??= { inHitch: zero(), inNormal: zero() });
      k.inHitch.forEach((row, ti) =>
        row.forEach((n, li) => {
          into.inHitch[ti]![li]! += n;
          into.inNormal[ti]![li]! += k.inNormal[ti]![li]!;
        })
      );
    }
  }
  return {
    thresholdsMs: [...first.thresholdsMs],
    lags: [...first.lags],
    frames,
    rejected,
    hitchFrames,
    kinds,
  };
}

/**
 * The verdict per event kind over every threshold x lag x k cell, strongest
 * first: by supported cells, then by hitch frames with the event at the
 * lowest threshold and widest lag, then by name (deterministic).
 *
 * A cell is supported when the event's rate among hitch frames is at least
 * `k` times its rate among normal frames AND it is in at least
 * `minHitchFrames` hitch frames.
 *
 * @throws RangeError for an empty `ks`, a `k` that is not finite and
 *   positive, or a negative or non-integer `minHitchFrames`.
 */
export function attributionVerdicts(
  counts: AttributionCounts,
  options: AttributionVerdictOptions = {}
): CauseVerdict[] {
  const ks = sortedUnique(
    'ks',
    options.ks ?? ATTRIBUTION_KS,
    (k) => Number.isFinite(k) && k > 0
  );
  const minHitch = options.minHitchFrames ?? ATTRIBUTION_MIN_HITCH_FRAMES;
  if (!(Number.isInteger(minHitch) && minHitch >= 0)) {
    throw new RangeError(
      `minHitchFrames must be a non-negative integer, got ${String(minHitch)}`
    );
  }

  const verdicts: CauseVerdict[] = [];
  for (const [kind, k] of Object.entries(counts.kinds)) {
    const cells: CauseCell[] = [];
    counts.thresholdsMs.forEach((thresholdMs, ti) => {
      const hitch = counts.hitchFrames[ti]!;
      const normal = counts.frames - hitch;
      counts.lags.forEach((lag, li) => {
        const inHitch = k.inHitch[ti]![li]!;
        const inNormal = k.inNormal[ti]![li]!;
        let ratio: number | null = null;
        if (hitch > 0 && normal > 0) {
          const hitchRate = inHitch / hitch;
          const normalRate = inNormal / normal;
          ratio =
            normalRate === 0
              ? hitchRate > 0
                ? Infinity
                : 0
              : hitchRate / normalRate;
        }
        for (const kValue of ks) {
          cells.push({
            thresholdMs,
            lag,
            k: kValue,
            inHitch,
            inNormal,
            ratio,
            supported: ratio !== null && ratio >= kValue && inHitch >= minHitch,
          });
        }
      });
    });
    const supportedCells = cells.filter((c) => c.supported).length;
    verdicts.push({
      kind,
      status:
        supportedCells === cells.length && cells.length > 0
          ? 'supported'
          : supportedCells > 0
            ? 'provisional'
            : 'unsupported',
      supportedCells,
      totalCells: cells.length,
      cells,
    });
  }

  const firstThresholdWidestLag = (v: CauseVerdict) =>
    counts.kinds[v.kind]!.inHitch[0]![counts.lags.length - 1]!;
  return verdicts.sort(
    (a, b) =>
      b.supportedCells - a.supportedCells ||
      firstThresholdWidestLag(b) - firstThresholdWidestLag(a) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
  );
}
