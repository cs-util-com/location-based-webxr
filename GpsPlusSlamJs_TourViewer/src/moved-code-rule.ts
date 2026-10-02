/**
 * The viewer's whole moved-code rule (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.6, decision D20, milestone M5c; owner approval of
 * 2026-10-02): the POSITION half (`code-displacement.ts`
 * `judgeCodeDisplacement`, the rigid fit against the 20 m floor alone) and
 * the TURN half this module adds, because the rigid fit absorbs a turn
 * exactly and so never reads a poster re-hung facing another way as moved
 * (§7l D3).
 *
 * THE TURN CHECK has three channels, and exactly one of them runs for a code
 * ({@link turnChannelOf}):
 * - `settled-yaw` - the code was saved on a SETTLED alignment
 *   ({@link isSettledSave}): the rigid fit's yaw beyond `settledYawDeg`. A
 *   turned poster turns the code's pin, and the fit's yaw is that turn. The
 *   saved heading must be good for this to mean anything: an early save
 *   carries its alignment's heading error into every reading.
 * - `compass` - not settled, and the device reports a compass reading
 *   outdoors ({@link isOutdoorByAccuracy}): the compass's bearing of the AR
 *   frame's north against the bearing the code's pin gives it
 *   ({@link compassTurnDeg}), beyond `compassDeg`. This is the code's facing
 *   direction at the scan (the device compass combined with the camera's
 *   view of the code) against its saved facing direction.
 * - `fallback-yaw` - neither: the rigid fit's yaw again, but only once the
 *   walk has spread `fallbackMinSpreadM` and beyond `fallbackYawDeg`.
 *
 * Pure: every reading is an argument; the per-fix wiring is
 * `moved-code-check.ts`.
 *
 * @see moved-code-rule.ts.md
 */

import { bearingDeltaDeg } from "gps-plus-slam-app-framework/core";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  CODE_MOVE_RULE,
  judgeCodeDisplacement,
  type CodeMoveRule,
  type CodeMoveVerdict,
  type CodePin,
  type DisplacementEstimate,
} from "./code-displacement.js";
import { alignmentNorthBearingDeg } from "./gps-noise-fit.js";

/** The turn check's parameters (see {@link CODE_TURN_RULE}). */
export interface CodeTurnRule {
  /** `settled-yaw`: the rigid fit's |yaw| beyond this (degrees) is a turn. */
  readonly settledYawDeg: number;
  /** A save is settled when its alignment had solved at least this many
   *  fixes (`mintQuality.alignmentSampleCount`). */
  readonly settledAlignmentSamples: number;
  /** `compass`: |compass - pin| beyond this (degrees) is a turn. */
  readonly compassDeg: number;
  /** The compass is used only while the device fixes' median reported
   *  accuracy is at or under this (m): the outdoor proxy. */
  readonly outdoorMaxAccuracyM: number;
  /** `fallback-yaw`: |yaw| beyond this (degrees) is a turn... */
  readonly fallbackYawDeg: number;
  /** ...once the evidence spreads at least this far (m). */
  readonly fallbackMinSpreadM: number;
}

/**
 * The turn check as approved (owner, 2026-10-02) and completed in M5c.
 * Parameters it rests on (results doc "Recalibrated on real recordings",
 * and the M5c sweep of `code-displacement.recordings.test.ts`, "the viewer
 * rule as shipped"); each value states what would reverse it:
 * Figures are per-fix FIRST crossings within 120 s on 379 outdoor virtual
 * codes (151 walks), the saved heading drawn from ANOTHER walk, turn
 * channel alone - what the viewer acts on:
 * - `settledYawDeg` 45: 1 of 379 unmoved codes past it (0.3 %, upper bound
 *   1.2 %), every 90 degree turn caught; 30: 3 of 379; 60: 0. A same-walk
 *   early save read 28.5 % past 45 (results doc) - why the channel needs a
 *   settled save.
 * - `settledAlignmentSamples` 120: the level carries no alignment AGE, only
 *   how many fixes its alignment had solved (`mintQuality.
 *   alignmentSampleCount`, the honest proxy). The corpus records about two
 *   fixes a second (median interval 0.52 s; 57-174 fixes in a walk's first
 *   60 s, median 108), so 120 is about the 60 s the measurement called
 *   settled at the median rate. Swept 60 / 120 / 180: the settled channel
 *   reads 0-0.3 % at all three; a phone at 1 Hz needs 2 minutes to reach it
 *   (conservative: it then uses the compass or the fallback).
 * - `compassDeg` 60 (owner): against another walk's heading, 3.3 % of
 *   outdoor draws past it with any mint, 2.0 % with a settled one, 95-97 %
 *   of 90 degree turns caught (results doc). Magnetic, as measured: the
 *   corpus' declination (a few degrees) is inside those figures; where it is
 *   large it adds to every reading.
 * - `outdoorMaxAccuracyM` 6.5: 0 of 10 indoor walks pass it, 13 of 197
 *   outdoor walks lose the compass (6 m: 0 and 17; 7 m: 1 and 11; 8 m: 2
 *   and 2). Ten indoor walks: a weak bound (upper 26 %).
 * - `fallbackYawDeg` 90 / `fallbackMinSpreadM` 10: an early save carries
 *   its alignment's heading error into every yaw reading. With a save under
 *   120 fixes: T 45 read 4.2 % of unmoved codes, T 60 3.7 %, T 90 1.1 %
 *   (upper bound 2.4 %); T 90 catches 57 % of 90 degree turns (T 60: 96 %)
 *   and any half turn. The spread barely matters (2 / 5 / 10 / 20 m: 1.3 /
 *   1.1 / 1.1 / 1.1 % at T 90): the threshold is the lever, not the spread.
 *   What reverses T 90: turned posters common enough that missing 4 in 10
 *   quarter turns costs more than 2.6 more false alarms per 100 visits.
 */
export const CODE_TURN_RULE: CodeTurnRule = Object.freeze({
  settledYawDeg: 45,
  settledAlignmentSamples: 120,
  compassDeg: 60,
  outdoorMaxAccuracyM: 6.5,
  fallbackYawDeg: 90,
  fallbackMinSpreadM: 10,
});

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

/** Bumped whenever a value above or in `CODE_MOVE_RULE` changes; the
 *  `tourViewing/codeIgnored` log carries it. */
export const MOVED_CODE_RULE_VERSION = "d20-m5c-2026-10-02";

export type TurnChannel = "settled-yaw" | "compass" | "fallback-yaw";

/**
 * Whether a saved level's pose was minted on a settled alignment: its
 * `mintQuality.alignmentSampleCount` reaches the rule's count. A level that
 * carries no count (hand-written, older tools) is NOT settled.
 */
export function isSettledSave(
  level: QrLevel,
  rule: CodeTurnRule = CODE_TURN_RULE,
): boolean {
  const n = level.qr.mintQuality?.alignmentSampleCount;
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= rule.settledAlignmentSamples
  );
}

/** Whether the device fixes' median reported accuracy reads as outdoors;
 *  false without one. */
export function isOutdoorByAccuracy(
  medianAccuracyM: number | null,
  rule: CodeTurnRule = CODE_TURN_RULE,
): boolean {
  return (
    medianAccuracyM !== null &&
    Number.isFinite(medianAccuracyM) &&
    medianAccuracyM > 0 &&
    medianAccuracyM <= rule.outdoorMaxAccuracyM
  );
}

/**
 * The code's turn as the compass sees it (degrees, (-180, 180]): the
 * compass's bearing of the AR frame's north (`arNorthBearingDeg` of the
 * framework's absolute orientation; magnetic, as measured) minus the
 * bearing the code's pin gives the same axis. With the poster where and how
 * it was saved, the pin IS the odometry's true placement and the two agree
 * up to the compass error; a poster turned by t turns the pin by t.
 *
 * @returns null for a non-finite bearing or a pin whose north is vertical.
 */
export function compassTurnDeg(
  compassArNorthDeg: number,
  pin: Pick<CodePin, "alignment">,
): number | null {
  if (!Number.isFinite(compassArNorthDeg)) return null;
  const pinned = alignmentNorthBearingDeg(pin.alignment);
  return pinned === null ? null : bearingDeltaDeg(compassArNorthDeg, pinned);
}

/** Which turn channel runs for a code (see the module comment). */
export function turnChannelOf(input: {
  readonly settled: boolean;
  readonly compassTurnDeg: number | null;
  readonly outdoor: boolean;
}): TurnChannel {
  if (input.settled) return "settled-yaw";
  if (input.compassTurnDeg !== null && input.outdoor) return "compass";
  return "fallback-yaw";
}

export interface CodeMoveJudgement {
  readonly verdict: CodeMoveVerdict;
  /** What read `moved`; null for any other verdict. */
  readonly decidedBy: "position" | TurnChannel | null;
  /** The position bound (m). */
  readonly boundM: number;
  /** The turn channel that ran. */
  readonly turnChannel: TurnChannel;
}

/**
 * One judgement of a code: `moved` by position first, else by its turn
 * channel; otherwise the position verdict (`consistent` or `undecided`,
 * neither a reason to stop checking).
 */
export function judgeCodeMove(
  input: {
    readonly estimate: DisplacementEstimate | null;
    readonly settled: boolean;
    /** {@link compassTurnDeg} at the scan; null without a reading. */
    readonly compassTurnDeg: number | null;
    readonly outdoor: boolean;
  },
  rules: { readonly move: CodeMoveRule; readonly turn: CodeTurnRule } = {
    move: CODE_MOVE_RULE,
    turn: CODE_TURN_RULE,
  },
): CodeMoveJudgement {
  const { estimate } = input;
  const position = judgeCodeDisplacement(estimate, rules.move);
  const turnChannel = turnChannelOf(input);
  const judged = (
    verdict: CodeMoveVerdict,
    decidedBy: CodeMoveJudgement["decidedBy"],
  ): CodeMoveJudgement => ({
    verdict,
    decidedBy,
    boundM: position.boundM,
    turnChannel,
  });
  if (position.verdict === "moved") return judged("moved", "position");
  // The yaw channels need the position rule's time span; their spread is
  // their own.
  const yawBeyond = (minSpreadM: number, limitDeg: number): boolean =>
    estimate !== null &&
    estimate.spanS >= rules.move.minSpanS &&
    estimate.spreadM >= minSpreadM &&
    Math.abs(estimate.yawDeg) > limitDeg;
  let turned: boolean;
  switch (turnChannel) {
    case "settled-yaw":
      turned = yawBeyond(rules.move.minSpreadM, rules.turn.settledYawDeg);
      break;
    case "compass":
      turned = Math.abs(input.compassTurnDeg ?? 0) > rules.turn.compassDeg;
      break;
    case "fallback-yaw":
      turned = yawBeyond(
        Math.max(rules.move.minSpreadM, rules.turn.fallbackMinSpreadM),
        rules.turn.fallbackYawDeg,
      );
      break;
  }
  return turned ? judged("moved", turnChannel) : judged(position.verdict, null);
}
