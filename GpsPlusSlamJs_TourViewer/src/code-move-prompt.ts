/**
 * The authoring prompt for a physically moved code (authoring plan
 * 2026-09-28-0953 §3.6 "Authoring (D20 ask once)", milestone M5b): WHEN the
 * creator setup asks "This code seems to have moved about N m. Use the new
 * spot?", and which answers it remembers so it does not ask again.
 *
 * THE TRIGGER. While authoring, a sighting of the code in hand is judged
 * through the visit's alignment (`visit-settle.ts`); a correction beyond
 * the plausibility bound is REFUSED. The prompt asks only when:
 * - the refusal is HORIZONTAL - a yaw-only refusal is a turned print or a
 *   bad heading, never a move (§7j #8);
 * - the offset is beyond {@link MovePromptRule.floorM} as well as the
 *   refusal's bound: the bound shrinks with the REPORTED accuracies (13.5 m
 *   at 2 m on both sides) while two visits' GPS can still disagree by more,
 *   so an unmoved code may be refused - the refusal stands - without being
 *   offered as moved (M5b review #1);
 * - the mint gate is open (`MIN_ALIGNMENT_SAMPLES` of this session's fixes
 *   solved in) - before it the alignment is the first fix's (§7j #9);
 * - the refusal has PERSISTED, without a break, for at least
 *   {@link MovePromptRule.minFixes} new fixes AND
 *   {@link MovePromptRule.minSeconds} of the fixes' own time: an immature
 *   alignment's early refusal comes and goes, a moved code's stays. Fixes
 *   AND seconds: fixes alone pass a burst of fixes in a second, time alone
 *   passes a GPS stall during which nothing new was learned. Fixes without
 *   a readable time leave the fix count to decide alone.
 *
 * WHAT IS REMEMBERED. "It's a second copy" and "Not now" are kept per level
 * and per spot - the offset of the code as the visit saw it from its saved
 * position, north and east in metres - so a reload does not ask again for
 * the same spot; an offset more than {@link MovePromptRule.sameSpotM} from
 * every remembered one for that level asks again (the code may have moved
 * once more). A distance, not fixed bands: a band edge would re-ask for a
 * spot that only GPS noise moved across it. An offset is FROM the saved
 * position of the time, so each answer also keeps that saved pose's key
 * ({@link savedPoseKey}) and counts only while the level in hand carries the
 * same pose: a replace makes the old answers name other places (they stop
 * counting), and an Undo brings the old pose back (they count again).
 *
 * Pure: the creator setup feeds it on every store change and owns the DOM,
 * the replace and the draft writes.
 *
 * @see code-move-prompt.ts.md
 */

import { MOVED_CODE_FLOOR_M } from "./code-displacement.js";
import type { CorrectionRefusal } from "./visit-settle.js";

/** The prompt's thresholds (swept in `code-move-prompt.sweep.test.ts`). */
export interface MovePromptRule {
  /** New fixes the refusal must last for. */
  readonly minFixes: number;
  /** Seconds of the fixes' own time it must last for. */
  readonly minSeconds: number;
  /** An answer covers offsets within this distance (m) of its own. */
  readonly sameSpotM: number;
  /** Never asks for an offset at or under this (m), whatever the
   *  refusal's bound; a non-finite value never asks. */
  readonly floorM: number;
}

/**
 * The shipped thresholds. SYNTHETIC AND PROVISIONAL, like the M5a rule:
 * swept on simulated GPS (Gauss-Markov per axis, tau 30-300 s, sigma
 * 3-10 m, two models of the solver's averaging), no field recording.
 * Parameters it rests on and the verdict across the range: the sidecar,
 * "The sweep". In short: with sigma <= 5 m, a bias shared between visits
 * AND a reported accuracy of 5 m, no persistence from 1 to 60 s ever
 * prompted for an unmoved code - but that is the 26.2 m bound of a 5 m
 * report, not the persistence; a phone reporting 2-3 m has a 13.5-17.7 m
 * bound, which the floor below covers. At sigma 10 m 20 s cuts the unmoved
 * prompts by 8-40 % only, and every second of it delays a moved code's
 * prompt by a second. 20 s is kept against what the model leaves out: the first fixes'
 * short-baseline alignment. The same spot: 20 m asks an unmoved spot again
 * in at most 1.5 % of re-visits at sigma <= 5 m with a shared bias (15 %
 * with 8 m of bias difference) and misses about half of second moves of
 * 20 m (up to 5.5 % of 30 m); 15 m re-asks 7 % / 36 %, 25 m misses 80-96 % of 20 m.
 * The floor ({@link MOVED_CODE_FLOOR_M}, 20 m): at a reported 2 m, with no
 * floor, an unmoved code was prompted in 24.5 % (sigma 3 m) to 55.5 %
 * (sigma 5 m) of sessions at 8 m of bias difference and 92.5 % at 15 m;
 * with 20 m that falls to 1-15 % at 8 m and 25.5-52.5 % at 15 m, while
 * 81.5-100 % of 30 m moves and every 50 m move are still prompted
 * (sigma <= 5 m). 25 m gives 0-4 % / 3-21 % and prompts only 71-95.5 % of
 * 30 m moves; 15 m is under a 3 m report's 17.7 m bound and changes
 * nothing there. A bias difference
 * of 15 m is beyond the corpus's worst (about 14 m), which is why 20 m is
 * kept despite its rate there.
 * What would reverse them: field recordings in which an unmoved code's
 * refusal comes and goes over more than 20 s (raise both), or in which an
 * unmoved code's offset differs by more than 20 m between visits (raise
 * `sameSpotM`).
 */
export const MOVE_PROMPT_RULE: MovePromptRule = Object.freeze({
  minFixes: 20,
  minSeconds: 20,
  sameSpotM: 20,
  floorM: MOVED_CODE_FLOOR_M,
});

/** The most remembered answers the draft keeps (newest kept). */
export const MOVE_ANSWERS_MAX = 32;

export type MoveAnswer = "second-copy" | "not-now";

/** An answer that keeps the prompt quiet for one spot of one code. */
export interface RememberedMoveAnswer {
  readonly levelId: string;
  /** Where the visit saw the code minus its saved position (m). */
  readonly northM: number;
  readonly eastM: number;
  readonly answer: MoveAnswer;
  /** {@link savedPoseKey} of the saved level the offset was taken from. */
  readonly savedKey: string;
}

/**
 * A short key for a saved level's pose json (FNV-1a, 32 bits, hex): what a
 * remembered answer was given against. Not a security hash; a collision
 * costs one prompt not asked for a spot answered against another pose.
 */
export function savedPoseKey(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Where a running refusal began. */
export interface MovePromptOnset {
  readonly levelId: string;
  /** The store's fix count when it began. */
  readonly fixCount: number;
  /** The latest fix's own time then (epoch ms); null when unreadable. */
  readonly tMs: number | null;
}

/** The prompt to show: the refusal, its offset, and how long it lasted. */
export interface MovePrompt {
  readonly levelId: string;
  readonly horizontalM: number;
  readonly northM: number;
  readonly eastM: number;
  readonly yawDeg: number;
  readonly maxHorizontalM: number;
  /** New fixes since the refusal began. */
  readonly fixes: number;
  /** Seconds of fix time since it began; null without readable times. */
  readonly seconds: number | null;
  /** The saved pose's key, for the answer to this prompt. */
  readonly savedKey: string;
}

export interface MovePromptInput {
  /** The level in hand; null with none. */
  readonly levelId: string | null;
  /** The refusal of this visit's latest sighting of that level. */
  readonly refusal: CorrectionRefusal | null;
  /** That sighting's offset from the saved position (m). */
  readonly offset: { readonly northM: number; readonly eastM: number } | null;
  /** The mint gate's alignment half: a matrix and enough session fixes. */
  readonly gateOpen: boolean;
  /** The store's GPS fix count. */
  readonly fixCount: number;
  /** The latest fix's own time (epoch ms), or null. */
  readonly lastFixMs: number | null;
  /** {@link savedPoseKey} of the level in hand; null without one. */
  readonly savedKey: string | null;
  readonly answers: readonly RememberedMoveAnswer[];
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A refusal that broke the HORIZONTAL bound (not only the yaw one). */
export function isHorizontalRefusal(
  refusal: Pick<CorrectionRefusal, "horizontalM" | "maxHorizontalM"> | null,
): boolean {
  return (
    refusal !== null &&
    finite(refusal.horizontalM) &&
    finite(refusal.maxHorizontalM) &&
    refusal.horizontalM > refusal.maxHorizontalM
  );
}

/** Whether an answer for `levelId`, given against the saved pose
 *  `savedKey`, covers `offset`. */
function answered(
  answers: readonly RememberedMoveAnswer[],
  levelId: string,
  savedKey: string,
  offset: { northM: number; eastM: number },
  sameSpotM: number,
): boolean {
  return answers.some(
    (a) =>
      a.levelId === levelId &&
      a.savedKey === savedKey &&
      Math.hypot(a.northM - offset.northM, a.eastM - offset.eastM) <= sameSpotM,
  );
}

/**
 * One step of the tracker: the onset carried to the next call, and the
 * prompt to show now (null for none).
 */
export function trackMovePrompt(
  onset: MovePromptOnset | null,
  input: MovePromptInput,
  rule: MovePromptRule = MOVE_PROMPT_RULE,
): { onset: MovePromptOnset | null; prompt: MovePrompt | null } {
  const { levelId, refusal, offset, fixCount } = input;
  if (
    levelId === null ||
    refusal === null ||
    offset === null ||
    !input.gateOpen ||
    !isHorizontalRefusal(refusal) ||
    !(refusal.horizontalM > rule.floorM) ||
    !finite(offset.northM) ||
    !finite(offset.eastM) ||
    !finite(fixCount) ||
    fixCount < 0
  ) {
    return { onset: null, prompt: null };
  }
  const lastFixMs = finite(input.lastFixMs) ? input.lastFixMs : null;
  // Another level, or a history that restarted (a new session's store),
  // begins a new refusal.
  const start: MovePromptOnset =
    onset !== null && onset.levelId === levelId && fixCount >= onset.fixCount
      ? onset
      : { levelId, fixCount, tMs: lastFixMs };
  const fixes = fixCount - start.fixCount;
  const seconds =
    start.tMs === null || lastFixMs === null
      ? null
      : (lastFixMs - start.tMs) / 1000;
  const persisted =
    fixes >= rule.minFixes && (seconds === null || seconds >= rule.minSeconds);
  const { savedKey } = input;
  if (
    !persisted ||
    savedKey === null ||
    answered(input.answers, levelId, savedKey, offset, rule.sameSpotM)
  ) {
    return { onset: start, prompt: null };
  }
  return {
    onset: start,
    prompt: {
      levelId,
      horizontalM: refusal.horizontalM,
      northM: offset.northM,
      eastM: offset.eastM,
      yawDeg: refusal.yawDeg,
      maxHorizontalM: refusal.maxHorizontalM,
      fixes,
      seconds,
      savedKey,
    },
  };
}

/**
 * `answers` with `entry` added: an answer for the same level, saved pose
 * and spot is replaced (the newest answer for a spot is the one that counts), and only
 * the newest {@link MOVE_ANSWERS_MAX} are kept, so the meta file stays
 * bounded.
 */
export function rememberMoveAnswer(
  answers: readonly RememberedMoveAnswer[],
  entry: RememberedMoveAnswer,
  sameSpotM: number = MOVE_PROMPT_RULE.sameSpotM,
): RememberedMoveAnswer[] {
  const kept = answers.filter(
    (a) => !answered([a], entry.levelId, entry.savedKey, entry, sameSpotM),
  );
  return [...kept, entry].slice(-MOVE_ANSWERS_MAX);
}

/** The remembered answers in a meta value (external data): well-formed
 *  entries only, the newest {@link MOVE_ANSWERS_MAX}. Anything else reads
 *  as no answer - the cost is one prompt asked again. An answer without
 *  a saved-pose key (written before it existed) is dropped too: what pose
 *  its offset was taken from is unknown, so it is never trusted. */
export function parseMoveAnswers(value: unknown): RememberedMoveAnswer[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((v): RememberedMoveAnswer[] => {
      if (typeof v !== "object" || v === null) return [];
      const r = v as Record<string, unknown>;
      const { levelId, northM, eastM, answer, savedKey } = r;
      if (typeof levelId !== "string" || levelId.length === 0) return [];
      if (!finite(northM) || !finite(eastM)) return [];
      if (answer !== "second-copy" && answer !== "not-now") return [];
      if (typeof savedKey !== "string" || savedKey.length === 0) return [];
      return [{ levelId, northM, eastM, answer, savedKey }];
    })
    .slice(-MOVE_ANSWERS_MAX);
}

/** The prompt's question. Whole metres: the offset is beyond an 18 m+
 *  bound, where GPS-level error makes decimals noise. */
export function movePromptText(horizontalM: number): string {
  return `This code seems to have moved about ${String(Math.round(horizontalM))} m. Use the new spot?`;
}

/** The prompt's and the undo's words (one place, for the panel and the
 *  e2e). */
export const MOVE_PROMPT_LABELS = Object.freeze({
  use: "Use the new spot",
  using: "Using the new spot…",
  secondCopy: "It's a second copy",
  notNow: "Not now",
  used: "The code's saved position is now the new spot. Notes keep their own positions.",
  useFailed:
    "Could not use the new spot - hold the phone on the code until it reads as measured, then try again.",
  undo: "Undo",
  undoing: "Undoing…",
  undone: "The code's saved position is back where it was.",
  undoNotBackedUp:
    "Undone here, but this device could not save the change - finish and download before closing the page.",
  replacedHint:
    "The code's saved position was replaced. Undo is possible until Finish, while this page stays open.",
});
