/**
 * The per-code verdict of the summary after Finish (authoring plan
 * 2026-09-28-0953 §3.3, milestone M3b): "Good", or the first thing the
 * author should do to make the code's estimate good enough.
 *
 * The rule is the M3a spike's proposal
 * (`2026-10-01-0354-code-estimate-across-visits-results.md`, Q3), computed
 * from what `combineCodeVisits` predicts - never from the actual error,
 * which the page cannot know:
 *
 * - **Good** when the predicted horizontal error is at most
 *   {@link VERDICT_GOOD_HORIZONTAL_M} and the predicted heading at most
 *   {@link VERDICT_GOOD_HEADING_DEG};
 * - otherwise the FIRST reason that applies:
 *   1. heading over the limit: "Walk further from the code" (the walk's
 *      extent is the heading model's lever);
 *   2. the best visit's accuracy over {@link VERDICT_POOR_GPS_M}: "Wait for
 *      better GPS";
 *   3. otherwise: "Scan it again in another AR visit" (another independent
 *      visit is what is left to average).
 *
 * THE THRESHOLDS ARE PROVISIONAL: measured on synthetic replays only (see
 * the sidecar for what they rest on and what would reverse them).
 *
 * @see code-verdict.ts.md
 */

import {
  CODE_YAW_NOISE_DEG,
  type CodeVisitPose,
  type CombinedCodePose,
} from "./code-visit-combine.js";

/** "Good" up to this predicted horizontal error (m). Provisional. */
export const VERDICT_GOOD_HORIZONTAL_M = 5;
/** "Good" up to this predicted heading error (degrees). Provisional. */
export const VERDICT_GOOD_HEADING_DEG = 12;
/** A best visit reporting worse than this (m) asks for better GPS.
 *  Provisional. */
const VERDICT_POOR_GPS_M = 8;

export type CodeVerdictKind =
  | "good"
  | "walk-further"
  | "wait-for-gps"
  | "scan-again"
  // Only for the STORED pose (what visitors get, M3a/M3b review #2): no
  // visit this device kept saved it, so its error is not known here...
  | "unknown"
  // ...or the tour stores no position for the code at all.
  | "not-saved";

/** The verdict's words, one per kind. */
export const VERDICT_TEXT: Readonly<Record<CodeVerdictKind, string>> = {
  good: "Good",
  "walk-further": "Walk further from the code",
  "wait-for-gps": "Wait for better GPS",
  "scan-again": "Scan it again in another AR visit",
  unknown: "Not known on this device",
  "not-saved": "No saved position yet",
};

/** A verdict with no numbers behind it: a stored pose this device cannot
 *  grade, or a code with no stored pose. */
export function verdictWithoutNumbers(
  kind: "unknown" | "not-saved",
): CodeVerdict {
  return { kind, text: VERDICT_TEXT[kind], numbers: null, walkM: null };
}

export interface CodeVerdict {
  readonly kind: CodeVerdictKind;
  readonly text: string;
  /** The numbers behind it; null when no visit measured the code. */
  readonly numbers: {
    readonly visitCount: number;
    /** How many of them the position combines (the best by accuracy). */
    readonly positionVisitCount: number;
    readonly predictedHorizontalM: number;
    readonly predictedHeadingDeg: number;
    /** The best (smallest) accuracy of the visits combined (m). */
    readonly bestAccuracyM: number;
    /** The longest walk of the visits combined (m). */
    readonly longestWalkM: number;
    /** How far the visits disagree, horizontally (m) and in heading. */
    readonly maxOffsetM: number;
    readonly maxHeadingOffsetDeg: number;
  } | null;
  /** For "walk further": the walk out and back (m) one visit at the best
   *  accuracy would need for the heading to pass; null otherwise. */
  readonly walkM: number | null;
}

const RAD = Math.PI / 180;

/**
 * The walk a single visit at `accuracyM` needs for the heading model to
 * meet the limit: `hypot(noise, atan(a / L)) <= limit`, so
 * `L >= a / tan(sqrt(limit² - noise²))` - 4.77 x the accuracy at the
 * adopted 12 degrees and 2 degrees of code yaw noise (24 m at 5 m); 4.72 x
 * at 1 degree, 4.86 x at 3, 5.19 x at 5.
 */
export function walkNeededM(accuracyM: number): number {
  const budget = Math.sqrt(
    VERDICT_GOOD_HEADING_DEG ** 2 - CODE_YAW_NOISE_DEG ** 2,
  );
  return accuracyM / Math.tan(budget * RAD);
}

const usableAccuracy = (v: CodeVisitPose): boolean =>
  Number.isFinite(v.gpsAccuracyM) && v.gpsAccuracyM > 0;

/**
 * The verdict for one code from its visits and their combination.
 *
 * @param visits the poses handed to `combineCodeVisits` (for the best
 *   accuracy and the longest walk; unusable ones are ignored, as the
 *   combiner ignores them).
 * @param combined `combineCodeVisits(visits)`; null when no visit measured
 *   the code, which reads "Scan it again in another AR visit" with no
 *   numbers.
 * @param options.averaging false when grading ONE saved pose (what
 *   visitors get, M3a/M3b review #2): visitors keep it whatever later
 *   visits do, so "scan it again" cannot help it, and a position short of
 *   Good with an honest heading reads "Wait for better GPS".
 */
export function codeVerdict(
  visits: readonly CodeVisitPose[],
  combined: CombinedCodePose | null,
  options: { readonly averaging?: boolean } = {},
): CodeVerdict {
  const usable = visits.filter(usableAccuracy);
  if (combined === null || usable.length === 0) {
    return {
      kind: "scan-again",
      text: VERDICT_TEXT["scan-again"],
      numbers: null,
      walkM: null,
    };
  }
  const bestAccuracyM = Math.min(...usable.map((v) => v.gpsAccuracyM));
  const numbers = {
    visitCount: combined.visitCount,
    positionVisitCount: combined.positionVisitCount,
    predictedHorizontalM: combined.predictedHorizontalM,
    predictedHeadingDeg: combined.predictedHeadingDeg,
    bestAccuracyM,
    longestWalkM: Math.max(
      0,
      ...usable.map((v) => (Number.isFinite(v.baselineM) ? v.baselineM : 0)),
    ),
    maxOffsetM: combined.maxOffsetM,
    maxHeadingOffsetDeg: combined.maxHeadingOffsetDeg,
  };
  const kind = verdictKind(numbers, options.averaging ?? true);
  return {
    kind,
    text: VERDICT_TEXT[kind],
    numbers,
    walkM: kind === "walk-further" ? walkNeededM(bestAccuracyM) : null,
  };
}

function verdictKind(
  n: {
    predictedHorizontalM: number;
    predictedHeadingDeg: number;
    bestAccuracyM: number;
  },
  averaging: boolean,
): CodeVerdictKind {
  const headingOk = n.predictedHeadingDeg <= VERDICT_GOOD_HEADING_DEG;
  if (n.predictedHorizontalM <= VERDICT_GOOD_HORIZONTAL_M && headingOk) {
    return "good";
  }
  if (!headingOk) return "walk-further";
  if (!averaging || n.bestAccuracyM > VERDICT_POOR_GPS_M) return "wait-for-gps";
  return "scan-again";
}
