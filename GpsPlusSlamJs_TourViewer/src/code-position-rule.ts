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
  | { kind: "keep"; reason: "not-walked" | "stored-good" | "far" }
  | { kind: "replace" }
  | { kind: "move" }
  | { kind: "move-waits"; walkMoreM: number };

/**
 * @param stored the saved position's quality
 * @param candidate this visit's measurement (its alignment's extent and
 *   accuracy)
 * @param offsetM how far this visit sees the code from its saved spot
 * @param moved the creator answered "Yes, the poster moved here"
 */
export function decideCodePosition(input: {
  stored: PositionQuality;
  candidate: PositionQuality;
  offsetM: number;
  moved: boolean;
}): CodePositionDecision {
  const reliable = isReliable(input.candidate);
  if (input.moved) {
    if (reliable) return { kind: "move" };
    const needed = Math.max(
      MIN_RELIABLE_WALK_M,
      walkNeededM(input.candidate.accuracyM ?? 5),
    );
    return {
      kind: "move-waits",
      walkMoreM: Math.max(0, needed - (input.candidate.extentM ?? 0)),
    };
  }
  // Far from the saved spot is the move question's domain, never a silent
  // replace (D20/D26: the poster may have moved, or be a second print).
  if (input.offsetM >= MOVE_PROMPT_FLOOR_M)
    return { kind: "keep", reason: "far" };
  if (!reliable) return { kind: "keep", reason: "not-walked" };
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
  /** This visit's measurement quality (for "walk about N m"). */
  readonly candidate: PositionQuality;
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
      (o.decision.kind === "replace" || o.decision.kind === "move"),
  );
  if (changed.some((o) => o.decision.kind === "replace")) {
    return "The code's saved position was improved by this walk; pins and photos within 40 m moved with it.";
  }
  if (changed.length > 0) {
    return "The code's saved position moved to the poster's new spot; pins and photos kept their places.";
  }
  const latest = outcomes.at(-1);
  if (latest === undefined) return "";
  const { decision } = latest;
  if (decision.kind === "move-waits") {
    return `The poster's move is not saved yet: walk about ${String(Math.round(decision.walkMoreM))} m more in AR after seeing the code, then finish again.`;
  }
  if (decision.kind === "keep" && decision.reason === "not-walked") {
    const needed = Math.max(
      MIN_RELIABLE_WALK_M,
      walkNeededM(latest.candidate.accuracyM ?? 5),
    );
    return `The code's saved position was kept: walk about ${String(Math.round(needed))} m in AR after seeing the code to improve it.`;
  }
  return "";
}
