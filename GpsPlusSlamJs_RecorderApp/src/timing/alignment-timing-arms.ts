/**
 * What the alignment-timing page measures, and under which parameters.
 *
 * Each arm is a WHOLE configuration in the library's public override names:
 * `setAlignmentOverrides` replaces rather than merges, so an arm carries only
 * what it changes from the shipped defaults and `null` IS the shipped
 * configuration. That is the same contract `../alignment-presets.ts` relies on
 * for the in-recording field wheel; this table is deliberately separate,
 * because these arms exist to price configurations rather than to offer them.
 *
 * WHAT CANNOT BE EXPRESSED HERE, and it matters for reading the result. The
 * offline comparison this page supplies the missing half of uses five
 * configurations. Four of them are below. The fifth is a fixed-seconds memory
 * rung, which needs a knob the public override whitelist does not carry - so
 * this page prices four of five, and a five-member figure has to be carried
 * across from the offline measurement's own finding that the cost of N
 * configurations is N times the cost of one (there is no sharing discount:
 * sharing the observation store saves memory, not CPU). The page says so on
 * screen; it is not left to a reader to infer from four columns.
 */

import type { AlignmentOverrides } from 'gps-plus-slam-app-framework/state';

export interface TimingArm {
  /** Stable id; also the JSON key and the table row label prefix. */
  readonly id: string;
  /** Short label, read on a phone, outdoors. */
  readonly label: string;
  /** `null` = the shipped defaults. */
  readonly overrides: AlignmentOverrides | null;
}

export const SHIPPED_ARM_ID = 'shipped';

export const TIMING_ARMS: readonly TimingArm[] = [
  {
    id: SHIPPED_ARM_ID,
    label: 'shipped defaults',
    overrides: null,
  },
  {
    // A steeper accuracy weighting. It changes what the solve weighs, not how
    // much of the history it reads, so it is the arm expected to cost about
    // what the shipped one does - which makes it the page's own sanity check.
    id: 'exp3',
    label: 'accuracy exponent 3',
    overrides: { gpsAccuracyExponent: 3 },
  },
  {
    // A looser rejection radius drops fewer pairs and therefore usually runs
    // FEWER trim-and-re-solve iterations, so this arm is expected to be
    // cheaper than shipped rather than dearer.
    id: 'thr10',
    label: 'rejection threshold 10 m',
    overrides: { outlierThresholdMeters: 10 },
  },
  {
    // The only arm whose cost should PLATEAU: it reads a bounded suffix of the
    // session instead of the whole of it. The recency weighting is switched
    // off with it deliberately - left on, the oldest fix inside the window is
    // still weighted hundreds of times lighter than the newest, so the window
    // would not be the variable.
    id: 'w180',
    label: 'flat window, last 180 s',
    overrides: { timeWeightEnabled: false, recentWindowSeconds: 180 },
  },
];

/**
 * Requested history rungs. The marginal cost is reported per rung-to-rung
 * segment, plus one final segment ending at the recording's full length.
 * Rungs at or above the recording's fix count are dropped, not clamped.
 */
export const HISTORY_LADDER: readonly number[] = [50, 100, 200, 400];

/**
 * Timed passes per arm, selectable on the page. A verdict from one parameter
 * value is provisional, so the count is swept rather than fixed: the offline
 * measurement found 3 and 5 agreeing within a few per cent on the large rungs
 * and differing by as much as 70 % on a 50-fix rung, and a phone is noisier
 * than the machine that was measured on.
 */
export const REPEAT_OPTIONS: readonly number[] = [3, 5, 9];
export const DEFAULT_REPEATS = 5;

/**
 * Discarded passes per arm. One is enough: the offline measurement read the
 * first pass at +137 % on one small cell and +3 % to +19 % on the large ones,
 * and a second warm-up bought nothing. Its total is still reported.
 */
export const WARMUP_PASSES = 1;
