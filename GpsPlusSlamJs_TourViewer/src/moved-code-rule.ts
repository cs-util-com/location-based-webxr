/**
 * The viewer's whole moved-code rule (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.6, decision D20, milestone M5c; owner decisions of
 * 2026-10-02): the POSITION half (`code-displacement.ts`
 * `judgeCodeDisplacement`, the rigid fit against the 20 m floor alone) and
 * the TURN half this module adds, because the rigid fit absorbs a turn
 * exactly and so never reads a poster re-hung facing another way as moved
 * (§7l D3).
 *
 * THE TURN CHECK (owner, 2026-10-02: "the global rotation of the QR code
 * should only ever come from the global pose in the GPS world space of the
 * QR code, which is very accurate if the user walked for a while"): the
 * code's heading in GPS world space - the rigid fit's yaw, i.e. the code's
 * pin carried through the visitor's own GPS path - against its saved
 * heading, beyond `settledYawDeg`. It runs ONLY when
 * - the saved code was minted on a SETTLED alignment ({@link isSettledSave}):
 *   an early save carries its alignment's heading error into every reading
 *   (28.5 % of unmoved codes past 45 degrees on the real walks), and a save
 *   the mint marked `headingUncertain` is never settled (D31), and
 * - the visitor has walked enough: the position rule's own evidence gate
 *   (`minSpanS`, `minSpreadM`), below which the fit has no turn.
 * Otherwise there is no turn check: an early save is judged by position
 * only. No compass reading is used anywhere (the earlier compass channel
 * and its 90 degree fallback are retired).
 *
 * Pure: every reading is an argument; the per-fix wiring is
 * `moved-code-check.ts`.
 *
 * @see moved-code-rule.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  CODE_MOVE_RULE,
  judgeCodeDisplacement,
  type CodeMoveRule,
  type CodeMoveVerdict,
  type DisplacementEstimate,
} from "./code-displacement.js";
import { turnLimitDeg } from "./visit-settle.js";

/** The turn check's parameters (see {@link CODE_TURN_RULE}). */
export interface CodeTurnRule {
  /** The rigid fit's |yaw| beyond this (degrees) is a turn. */
  readonly settledYawDeg: number;
  /** A save is settled when its alignment had solved at least this many
   *  fixes (`mintQuality.alignmentSampleCount`). */
  readonly settledAlignmentSamples: number;
  /** A turn must also exceed this many sigmas of the fit's own GPS heading
   *  error (polish round C5; `turnLimitDeg` with `settledYawDeg` as its
   *  floor). */
  readonly sigmaFactor: number;
  /** The heading model's baseline as a multiple of the fit's RMS spread
   *  (polish round C5): a walk's extent is about two to three and a half
   *  times its RMS distance from the centroid. */
  readonly baselineSpreadFactor: number;
}

/**
 * The turn check as approved (owner, 2026-10-02). Parameters it rests on
 * (results doc "Recalibrated on real recordings", and the M5c sweep of
 * `code-displacement.recordings.test.ts`, "the viewer rule as shipped"); each
 * value states what would reverse it. Figures are per-fix FIRST crossings
 * within 120 s on 379 outdoor virtual codes (151 walks), the saved heading
 * drawn from ANOTHER walk, turn check alone - what the viewer acts on:
 * - `settledYawDeg` 45: 1 of the 379 unmoved codes whose walk lasts 120 s
 *   past it (0.3 %, upper bound 1.2 %; 1 of all 710 codes), every 90 degree
 *   turn of those caught; 30: 3 of 379; 60: 0. Within 300 s: 0 of 100. What reverses
 *   it: a settled save whose heading is off by more than about 30 degrees in
 *   more than about 1 in 100 saves.
 * - `settledAlignmentSamples` 120: the level carries no alignment AGE, only
 *   how many fixes its alignment had solved (`mintQuality.
 *   alignmentSampleCount`, the honest proxy). The corpus records about two
 *   fixes a second (median interval 0.52 s; 57-174 fixes in a walk's first
 *   60 s, median 108), so 120 is about the 60 s the measurement called
 *   settled at the median rate. Swept 60 / 120 / 180: the check reads
 *   0-0.3 % at all three; a phone at 1 Hz needs 2 minutes to reach it
 *   (conservative: its codes are then judged by position only).
 * - `sigmaFactor` 3 and `baselineSpreadFactor` 3 (polish round C5; swept
 *   k 0 / 2 / 3 / 4 x T 30 / 45 / 60 and, at k 3, the baseline 1.5 / 2 / 3 x
 *   the RMS spread, against "spread at least q x accuracy" with q 0.5 / 1 /
 *   2; settled at 120, within 120 s; on 710 outdoor and 42 indoor or mixed
 *   virtual codes, the saved heading drawn from another outdoor walk):
 *   - before C5 (k 0, T 45): false alarms 1 of 710 outdoors, 2 of 42 indoors;
 *   - k 3, baseline 3: 0 of 710 and 0 of 42, while 90-degree turns are
 *     caught as before outdoors (1,022 of 1,420, every covered one) and 51 of
 *     52 covered indoors (k 3 at baseline 2: 49 of 52; k 2 keeps the
 *     outdoor false alarm; k 4 loses catches in both; the q alternative
 *     never beats it).
 *   - The indoor sample is small (42 codes, 26 covered). The 2026-10-10
 *     recording (2.15 m of spread at 8.3 m) gets a threshold of about 156
 *     degrees, and its 46-degree reading no veto. What reverses it: indoor
 *     recordings in which real turns go uncaught.
 */
export const CODE_TURN_RULE: CodeTurnRule = Object.freeze({
  settledYawDeg: 45,
  settledAlignmentSamples: 120,
  sigmaFactor: 3,
  baselineSpreadFactor: 3,
});

/** The accuracy assumed (m) when no fix of the fit reported one. */
const DEFAULT_FIT_ACCURACY_M = 5;

/**
 * The largest yaw (deg) the fit's own GPS heading error explains: the
 * heading model's sigma (`visitHeadingSigmaDeg` through `turnLimitDeg`)
 * for the fit's accuracy and a baseline of `baselineSpreadFactor` times
 * its RMS spread (the spread is the fixes' RMS distance from their
 * centroid; a straight walk's extent is about 3.5 times that), times
 * `sigmaFactor`, never below `settledYawDeg`. Polish round C5: at 2.15 m of
 * spread and 8.3 m accuracy indoors the sigma is about 52 degrees, so the
 * 46-degree reading that vetoed the code is no evidence; after a 12 m
 * spread at 4 m it is about 7, and the calibrated 45 decides as before.
 */
export function turnThresholdDeg(
  estimate: Pick<DisplacementEstimate, "spreadM">,
  accuracyMedianM: number | null | undefined,
  rule: CodeTurnRule = CODE_TURN_RULE,
): number {
  const accuracyM =
    accuracyMedianM !== null &&
    accuracyMedianM !== undefined &&
    Number.isFinite(accuracyMedianM) &&
    accuracyMedianM > 0
      ? accuracyMedianM
      : DEFAULT_FIT_ACCURACY_M;
  return (
    turnLimitDeg(
      { extentM: rule.baselineSpreadFactor * estimate.spreadM, accuracyM },
      { floorDeg: rule.settledYawDeg, factor: rule.sigmaFactor },
    ) ?? rule.settledYawDeg
  );
}

/**
 * How long after its pin (seconds) the viewer keeps checking a code. The
 * real-walk visits are short (median 2.7 min; 173 cross-day pairs reach
 * 300 s, 2 reach 600 s): on them every one of the 23 position alarms of
 * 6,166 unmoved pairs came within 120 s, and 20 m moves were caught 58.0 %
 * within 120 s, 58.8 % within 300 s, 58.9 % over the whole visit. The
 * horizon keeps the check inside the measured range; what reverses it:
 * long-tour recordings that show late alarms are rare and late detections
 * common.
 */
export const MOVED_CODE_HORIZON_S = 300;

/**
 * The fit window (seconds) BEFORE a code's pin (M5c review H2): the check
 * folds only the device fixes stamped at most this long before the pin, and
 * every one after it, so a long session's old fixes (another street, another
 * GPS bias) never decide about a code scanned now. 300 s is the range the
 * real-walk measurement covered (visits of median 2.7 min, p90 5.7). Swept
 * on the cross-day pairs (`code-displacement.recordings.test.ts`, "M5c fit
 * window"): 120 / 300 / 600 s / unbounded; the sidecar carries the numbers.
 * What reverses it: long-tour recordings in which a wider window catches
 * moves earlier without more false alarms.
 *
 * The window compares a fix's own stamp (Geolocation time, epoch ms) with
 * the pin's page clock (`Date.now` in the viewer): both epoch, as in the
 * measurement, which compared fix stamps with the mark's action time.
 */
export const MOVED_CODE_FIT_WINDOW_S = 300;

/** Bumped whenever a value above or in `CODE_MOVE_RULE`, or what counts as
 *  settled ({@link isSettledSave}), changes; the
 *  `tourViewing/codeIgnored` log carries it. */
export const MOVED_CODE_RULE_VERSION = "d20-m5c-2026-10-03-d31-c5";

/**
 * Whether a saved level's pose was minted on a settled alignment: its
 * `mintQuality.alignmentSampleCount` reaches the rule's count. A level that
 * carries no count (hand-written, older tools) is NOT settled, and neither
 * is one the mint marked `headingUncertain` (owner decision D31: its
 * alignment spanned under about 10 m of GPS, so its heading is close to
 * guesswork however many fixes it had solved). An absent marker means the
 * mint predates D31 or did not know the extent: the count rule alone.
 */
export function isSettledSave(
  level: QrLevel,
  rule: CodeTurnRule = CODE_TURN_RULE,
): boolean {
  if (level.qr.mintQuality?.headingUncertain === true) return false;
  const n = level.qr.mintQuality?.alignmentSampleCount;
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= rule.settledAlignmentSamples
  );
}

export interface CodeMoveJudgement {
  readonly verdict: CodeMoveVerdict;
  /** What read `moved`; null for any other verdict. */
  readonly decidedBy: "position" | "turn" | null;
  /** The position bound (m). */
  readonly boundM: number;
  /** Whether the turn check ran (the save was settled). */
  readonly turnChecked: boolean;
}

/**
 * One judgement of a code: `moved` by position first, else - for a settled
 * save only - by the rigid fit's yaw; otherwise the position verdict
 * (`consistent` or `undecided`, neither a reason to stop checking).
 */
export function judgeCodeMove(
  input: {
    readonly estimate: DisplacementEstimate | null;
    /** {@link isSettledSave} of the saved level. */
    readonly settled: boolean;
    /** The median reported accuracy (m) of the fit's device fixes; absent
     *  or unusable: 5 m ({@link turnThresholdDeg}). */
    readonly accuracyMedianM?: number | null;
  },
  rules: { readonly move: CodeMoveRule; readonly turn: CodeTurnRule } = {
    move: CODE_MOVE_RULE,
    turn: CODE_TURN_RULE,
  },
): CodeMoveJudgement {
  const { estimate, settled } = input;
  const position = judgeCodeDisplacement(estimate, rules.move);
  const judged = (
    verdict: CodeMoveVerdict,
    decidedBy: CodeMoveJudgement["decidedBy"],
  ): CodeMoveJudgement => ({
    verdict,
    decidedBy,
    boundM: position.boundM,
    turnChecked: settled,
  });
  if (position.verdict === "moved") return judged("moved", "position");
  // The yaw needs the position rule's evidence (the time span and the
  // spread), and must exceed what the fit's own GPS heading can be off by
  // (polish round C5).
  const turned =
    settled &&
    estimate !== null &&
    estimate.spanS >= rules.move.minSpanS &&
    estimate.spreadM >= rules.move.minSpreadM &&
    Math.abs(estimate.yawDeg) >
      turnThresholdDeg(estimate, input.accuracyMedianM, rules.turn);
  return turned ? judged("moved", "turn") : judged(position.verdict, null);
}
