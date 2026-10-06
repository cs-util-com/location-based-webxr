/**
 * The authoring prompt for a physically moved code (authoring plan
 * 2026-09-28-0953 §3.6 "Authoring (D20 ask once)", milestone M5b): WHEN the
 * creator setup asks "The code is about N m from its saved spot. Did the
 * poster move here?" (UI round 1, U3), and which answers it remembers so it
 * does not ask again.
 *
 * THE TRIGGER (owner decision D26, 2026-10-02: its own 15 m trigger). While
 * authoring, a sighting of the code in hand is mapped through the visit's
 * GPS alignment and compared with the code's saved position
 * (`visit-settle.ts` `sightedCodeOffset`). The prompt asks only when:
 * - that HORIZONTAL offset is beyond {@link MovePromptRule.floorM} - a turn
 *   alone is a turned print or a bad heading, never a move (§7j #8);
 * - INDEPENDENT of the settle's refusal: the settle still refuses a
 *   correction only beyond its plausibility bound (about 26 m at the default
 *   accuracies, as shipped), so between the floor and that bound the visit
 *   still follows the code while the prompt asks, until the author answers
 *   (before D26 the prompt asked only on a refusal, so a code moved 15-26 m
 *   silently shifted the visit's notes);
 * - the mint gate is open (`MIN_ALIGNMENT_SAMPLES` of this session's fixes
 *   solved in) - before it the alignment is the first fix's (§7j #9);
 * - the offset has PERSISTED beyond the floor, without a break, for at least
 *   {@link MovePromptRule.minFixes} new fixes AND
 *   {@link MovePromptRule.minSeconds} of the fixes' own time: an immature
 *   alignment's early offset comes and goes, a moved code's stays. Fixes
 *   AND seconds: fixes alone pass a burst of fixes in a second, time alone
 *   passes a GPS stall during which nothing new was learned. Fixes without
 *   a readable time leave the fix count to decide alone.
 *
 * WHAT IS REMEMBERED. Every answer ("Yes, it moved", "No, it's a second
 * poster", "Not now"; UI round 1, U3) is kept per level
 * and per spot - the offset of the code as the visit saw it from its saved
 * position, north and east in metres - so a reload does not ask again for
 * the same spot; an offset more than {@link MovePromptRule.sameSpotM} from
 * every remembered one for that level asks again (the code may have moved
 * once more). A distance, not fixed bands: a band edge would re-ask for a
 * spot that only GPS noise moved across it. An offset is FROM the saved
 * position of the time, so each answer also keeps that saved pose's key
 * ({@link savedPoseKey}) and counts only while the level in hand carries the
 * same pose: a new saved position makes the old answers name other places
 * (they stop counting).
 *
 * Pure: the creator setup feeds it on every store change and owns the DOM
 * and the draft writes; the settle reads "moved" through {@link answerAtSpot}.
 *
 * @see code-move-prompt.ts.md
 */

/** The prompt's thresholds (swept in `code-move-prompt.sweep.test.ts`). */
export interface MovePromptRule {
  /** New fixes the offset must stay beyond the trigger for. */
  readonly minFixes: number;
  /** Seconds of the fixes' own time it must last for. */
  readonly minSeconds: number;
  /** An answer covers offsets within this distance (m) of its own. */
  readonly sameSpotM: number;
  /** The trigger (m): asks for a horizontal offset beyond this, whether or
   *  not the settle refuses the correction; a non-finite value never asks. */
  readonly floorM: number;
}

/**
 * THE PROMPT'S TRIGGER (m), owner decision D26 (2026-10-02): its own offset
 * trigger, independent of the settle's refusal bound and of the viewer's
 * floor (`MOVED_CODE_FLOOR_M`, 20 m, in `code-displacement.ts`).
 *
 * Parameters it rests on (results doc
 * `GpsPlusSlamJs_Docs/docs/2026-10-01-2040-moved-code-detection-results.md`,
 * "Recalibrated on real recordings", "Authoring prompt at 15 m"): 6,166
 * cross-day pairs of 42 reference points (209 walks, median 2.7 min), the
 * offset held over the prompt's 20 s persistence. At 15 m: 44 of 6,166
 * unmoved pairs prompted (0.7 %, upper bound 0.9 %; 2 of 42 points), 62.6 %
 * of 15 m moves and 98.3 % of 20 m moves asked about. At 12 m: 1.1 % unmoved,
 * 93.5 % of 15 m moves. At 20 m (the floor before D26, and then only on a
 * refusal of about 26 m): a code moved 15-26 m was never asked about.
 * Valid for short visits (D27: the owner records 10 minute walks in the
 * field test). What reverses it: another walk like the church one (27 m off
 * at a reported 6 m) in more than about 1 in 50 walks, or unmoved offsets
 * beyond 15 m common in longer walks.
 */
export const MOVE_PROMPT_FLOOR_M = 15;

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
 * with an 8 m bias per later visit in its own direction, so the two
 * differ by 0-16 m, about 10 m on average) and misses about half of second moves of
 * 20 m (up to 5.5 % of 30 m); 15 m re-asks 7 % / 36 %, 25 m misses 80-96 % of 20 m.
 * The floor before D26 (20 m, shared with the viewer): at a reported 2 m, with no
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
  floorM: MOVE_PROMPT_FLOOR_M,
});

/** The most remembered answers the draft keeps (newest kept). */
export const MOVE_ANSWERS_MAX = 32;

/** "moved": the creator said the poster moved here (UI round 1, U3) - the
 *  settle then saves the new spot once the visit walked enough
 *  (`code-position-settle.ts`); "second-copy" and "not-now" keep the
 *  saved spot. */
export type MoveAnswer = "second-copy" | "not-now" | "moved";

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

/** Where a running offset beyond the trigger began. */
export interface MovePromptOnset {
  readonly levelId: string;
  /** The store's fix count when it began. */
  readonly fixCount: number;
  /** The latest fix's own time then (epoch ms); null when unreadable. */
  readonly tMs: number | null;
}

/** The prompt to show: the offset, the trigger it crossed, and how long
 *  it lasted. */
export interface MovePrompt {
  readonly levelId: string;
  readonly horizontalM: number;
  readonly northM: number;
  readonly eastM: number;
  readonly yawDeg: number;
  /** The trigger the offset crossed (m): the rule's `floorM`. */
  readonly triggerM: number;
  /** New fixes since the run beyond the trigger began. */
  readonly fixes: number;
  /** Seconds of fix time since it began; null without readable times. */
  readonly seconds: number | null;
  /** The saved pose's key, for the answer to this prompt. */
  readonly savedKey: string;
}

export interface MovePromptInput {
  /** The level in hand; null with none. */
  readonly levelId: string | null;
  /** This visit's latest sighting of that level, through the visit's GPS
   *  alignment, minus its saved position (`sightedCodeOffset`): horizontal
   *  size, north and east (m), and turn (degrees); null with none. */
  readonly offset: {
    readonly horizontalM: number;
    readonly northM: number;
    readonly eastM: number;
    readonly yawDeg: number;
  } | null;
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
 * Whether a sighting of `levelId` at `offset` from the saved pose
 * `savedKey` is at a spot the creator answered "It's a second copy" for -
 * the same level, saved pose and spot that keep the prompt quiet (M5b
 * review #11). Such a sighting is another print, never a visit of the
 * stored code. "Not now" leaves the question open, so it does not count;
 * an offset that is not finite never matches.
 */
export function isSecondCopySpot(
  answers: readonly RememberedMoveAnswer[],
  sighting: {
    readonly levelId: string;
    readonly savedKey: string;
    readonly offset: { readonly northM: number; readonly eastM: number };
  },
  sameSpotM: number = MOVE_PROMPT_RULE.sameSpotM,
): boolean {
  const { levelId, savedKey, offset } = sighting;
  if (!finite(offset.northM) || !finite(offset.eastM)) return false;
  return answered(
    answers.filter((a) => a.answer === "second-copy"),
    levelId,
    savedKey,
    offset,
    sameSpotM,
  );
}

/**
 * The answer that covers a sighting of `levelId` at `offset` from the saved
 * pose `savedKey`, for the settle (UI round 1, U3): "moved" (save the new
 * spot once walked enough) or "second-copy" (another print, never a visit
 * of the stored code); "not-now" and no answer are null. The newest
 * covering answer counts, as in {@link rememberMoveAnswer}.
 */
export function answerAtSpot(
  answers: readonly RememberedMoveAnswer[],
  sighting: {
    readonly levelId: string;
    readonly savedKey: string;
    readonly offset: { readonly northM: number; readonly eastM: number };
  },
  sameSpotM: number = MOVE_PROMPT_RULE.sameSpotM,
): "moved" | "second-copy" | null {
  const { levelId, savedKey, offset } = sighting;
  if (!finite(offset.northM) || !finite(offset.eastM)) return null;
  const covering = answers.filter((a) =>
    answered([a], levelId, savedKey, offset, sameSpotM),
  );
  const newest = covering.at(-1)?.answer;
  return newest === "moved" || newest === "second-copy" ? newest : null;
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
  const { levelId, offset, fixCount } = input;
  if (
    levelId === null ||
    offset === null ||
    !input.gateOpen ||
    !finite(offset.horizontalM) ||
    !(offset.horizontalM > rule.floorM) ||
    !finite(offset.northM) ||
    !finite(offset.eastM) ||
    !finite(fixCount) ||
    fixCount < 0
  ) {
    return { onset: null, prompt: null };
  }
  const lastFixMs = finite(input.lastFixMs) ? input.lastFixMs : null;
  // Another level, or a history that restarted (a new session's store),
  // begins a new run.
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
      horizontalM: offset.horizontalM,
      northM: offset.northM,
      eastM: offset.eastM,
      yawDeg: finite(offset.yawDeg) ? offset.yawDeg : 0,
      triggerM: rule.floorM,
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
      if (
        answer !== "second-copy" &&
        answer !== "not-now" &&
        answer !== "moved"
      )
        return [];
      if (typeof savedKey !== "string" || savedKey.length === 0) return [];
      return [{ levelId, northM, eastM, answer, savedKey }];
    })
    .slice(-MOVE_ANSWERS_MAX);
}

/** The prompt's question. Whole metres: the offset is beyond the 15 m
 *  trigger, where GPS-level error makes decimals noise. */
export function movePromptText(horizontalM: number): string {
  return `The code is about ${String(Math.round(horizontalM))} m from its saved spot. Did the poster move here?`;
}

/** The prompt's and the undo's words (one place, for the panel and the
 *  e2e). */
export const MOVE_PROMPT_LABELS = Object.freeze({
  use: "Yes, it moved",
  secondCopy: "No, it's a second poster",
  notNow: "Not now",
  moved:
    "Marked as moved: the code's new spot is saved when this visit ends, if you walked enough by then. Pins and photos keep their places.",
  undo: "Undo",
  undone: "Not marked as moved.",
  movedHint: "Marked as moved.",
});
