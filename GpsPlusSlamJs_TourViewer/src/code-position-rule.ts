/**
 * Which position of a printed code a tour keeps (UI round 1, U3; owner
 * decisions 2026-10-06): measured automatically, the BETTER position kept
 * - a new one replaces the saved one only when this visit walked enough
 * for its direction to be reliable (the summary's walk model, at least
 * 10 m) and the saved one was not itself measured that well; a code far
 * from its saved spot is left to "did the poster move here?", and a
 * confirmed move waits for the same walk. Pure.
 *
 * @see code-position-rule.ts.md
 */

import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import { walkNeededM } from "./code-verdict.js";
import { MOVE_PROMPT_FLOOR_M } from "./code-move-prompt.js";

/** What a position's alignment rested on: the GPS spread walked and the
 *  fixes' accuracy (m); null when unknown. */
export interface PositionQuality {
  readonly extentM: number | null;
  readonly accuracyM: number | null;
}

/** The minimum walk whatever the accuracy: below it the heading is close
 *  to guesswork (D31's own threshold). */
const MIN_RELIABLE_WALK_M = 10;

/** Reliable: the walk the summary's heading model needs at this accuracy
 *  (`walkNeededM`, 4.77 x accuracy), and at least 10 m. One model for the
 *  rule and the summary, so the two never disagree. */
export function isReliable(q: PositionQuality): boolean {
  if (q.extentM === null || q.accuracyM === null) return false;
  return q.extentM >= Math.max(MIN_RELIABLE_WALK_M, walkNeededM(q.accuracyM));
}

export type CodePositionDecision =
  | { kind: "keep"; reason: "stored-good" | "far" }
  | { kind: "keep"; reason: "not-walked"; walkMoreM: number }
  | { kind: "replace" }
  | { kind: "move" }
  | { kind: "move-waits"; walkMoreM: number }
  /** The code was seen back at the spot an automatic move left: that spot
   *  was restored (code book plan M6 v5.1, `code-spots.ts`). Never
   *  decided here; the settle logs it with the rest. */
  | { kind: "undo" };

/** How much more walking `q` needs to be reliable (m); 5 m accuracy is
 *  assumed when it is unknown, only for this figure. */
function walkMoreM(q: PositionQuality): number {
  const needed = Math.max(MIN_RELIABLE_WALK_M, walkNeededM(q.accuracyM ?? 5));
  return Math.max(0, needed - (q.extentM ?? 0));
}

/**
 * @param stored the saved position's quality
 * @param candidate this visit's measurement (its alignment's extent and
 *   accuracy)
 * @param offsetM how far this visit sees the code from its saved spot
 * @param moved the creator answered "Yes, the poster moved here"
 * @param far this visit sees the code too far off for a silent replace:
 *   beyond the move question's 15 m, or beyond the code correction's
 *   plausibility bound (`correctionBoundM`, `CORRECTION_MAX_YAW_DEG`) -
 *   a second print or a moved poster. Defaults to `offsetM >= 15`.
 */
export function decideCodePosition(input: {
  stored: PositionQuality;
  candidate: PositionQuality;
  offsetM: number;
  moved: boolean;
  far?: boolean;
}): CodePositionDecision {
  const reliable = isReliable(input.candidate);
  // A "Yes, it moved" counts only while the code is still seen where the
  // question was asked about (15 m and more): a walked alignment that puts
  // it back near its saved spot shows the question came from GPS bias
  // (U3 milestone review #3).
  if (input.moved && input.offsetM >= MOVE_PROMPT_FLOOR_M) {
    if (reliable) return { kind: "move" };
    return { kind: "move-waits", walkMoreM: walkMoreM(input.candidate) };
  }
  // Far from the saved spot is the move question's domain, never a silent
  // replace (D20/D26: the poster may have moved, or be a second print).
  if (input.far ?? input.offsetM >= MOVE_PROMPT_FLOOR_M) {
    return { kind: "keep", reason: "far" };
  }
  if (!reliable) {
    return {
      kind: "keep",
      reason: "not-walked",
      walkMoreM: walkMoreM(input.candidate),
    };
  }
  // A saved position from a good walk is not churned by every later visit
  // (the D10b reason: GPS jumps 5-10 m between visits).
  if (isReliable(input.stored)) return { kind: "keep", reason: "stored-good" };
  return { kind: "replace" };
}

/** A saved level's quality (`qr.mintQuality`, D31); unknown for an older
 *  level or an unreadable file - never "settled". */
export function qualityOfLevel(json: string): PositionQuality {
  try {
    const quality = parseQrLevel(JSON.parse(json) as unknown).qr.mintQuality;
    return {
      extentM: quality?.alignmentGpsExtentM ?? null,
      accuracyM: quality?.gpsAccuracyM ?? null,
    };
  } catch {
    return { extentM: null, accuracyM: null };
  }
}

/** What one settle decided for the code, for the result screen. */
export interface CodePositionOutcome {
  readonly decision: CodePositionDecision;
  /** The change was made (the re-mint succeeded). */
  readonly applied: boolean;
}

/**
 * The result screen's line about the code's position since the last
 * Finish (UI round 1, U3: no button announces it any more, so the result
 * says which happened and why). An applied change outranks any later
 * "kept"; otherwise the latest outcome speaks. A position kept because it
 * was good already, or left to the move question, says nothing.
 */
export function codePositionSentence(
  outcomes: readonly CodePositionOutcome[],
): string {
  const changed = outcomes.filter(
    (o) =>
      o.applied &&
      (o.decision.kind === "replace" ||
        o.decision.kind === "move" ||
        o.decision.kind === "undo"),
  );
  if (changed.some((o) => o.decision.kind === "replace")) {
    return "The code's saved position was improved by this walk; pins and photos within 40 m moved with it.";
  }
  // Of a move and its undo, the later one is where the code now is.
  const lastChange = changed.at(-1);
  if (lastChange?.decision.kind === "undo") {
    return "The code was seen back at its earlier spot: its saved position went back there, and the print at the other spot counts as a second copy.";
  }
  if (lastChange !== undefined) {
    return "The code's saved position moved to the poster's new spot; pins and photos kept their places.";
  }
  const latest = outcomes.at(-1);
  if (latest === undefined) return "";
  const { decision } = latest;
  // How much farther: this visit's GPS spread against what its accuracy
  // needs. A "Yes, it moved" is forgotten at the settle that could not
  // apply it, so it is asked again (U3 milestone review #5).
  const more = (m: number) => String(Math.max(1, Math.round(m)));
  if (decision.kind === "move-waits") {
    return `The poster's move was not saved: this visit's walk was about ${more(decision.walkMoreM)} m too short for the GPS accuracy. Next time, walk farther in AR and answer "Yes, it moved" again.`;
  }
  if (decision.kind === "keep" && decision.reason === "not-walked") {
    return `The code's saved position was kept: this visit's walk was about ${more(decision.walkMoreM)} m too short for the GPS accuracy to improve it.`;
  }
  return "";
}
