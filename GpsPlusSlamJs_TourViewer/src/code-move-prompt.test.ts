/**
 * The authoring prompt for a physically moved code (authoring plan
 * 2026-09-28-0953 §3.6 "Authoring (D20 ask once)", milestone M5b): when it
 * asks, what it remembers, and what it says.
 *
 * Why these tests matter: the prompt overwrites a code's saved position for
 * every visitor when the author says yes, so asking at the wrong moment is
 * the expensive failure. The cold review (§7j #8, #9) named the two wrong
 * moments - a turn alone (a turned print, not a move) and a transient offset
 * of an immature alignment - and #14 asked that an answer is not asked again
 * for the same spot after a reload. Since the owner's decision D26
 * (2026-10-02) the prompt has its OWN 15 m trigger on the sighting's offset,
 * independent of the settle's refusal (about 26 m): a code moved 15-26 m used
 * to shift the visit's notes silently. Each test below pins one of those
 * rules on the pure tracker the creator setup calls on every store change.
 */
import { describe, expect, it } from "vitest";

import { MOVED_CODE_FLOOR_M } from "./code-displacement.js";
import {
  isSecondCopySpot,
  answerAtSpot,
  MOVE_ANSWERS_MAX,
  MOVE_PROMPT_FLOOR_M,
  MOVE_PROMPT_LABELS,
  MOVE_PROMPT_RULE,
  movePromptText,
  parseMoveAnswers,
  rememberMoveAnswer,
  savedPoseKey,
  trackMovePrompt,
  type MovePromptInput,
  type MovePromptOnset,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";

const RULE = { minFixes: 5, minSeconds: 10, sameSpotM: 15, floorM: 15 };

/** The code seen 40 m north of its saved spot, barely turned. */
const at = (northM: number, yawDeg = 3) => ({
  horizontalM: Math.abs(northM),
  northM,
  eastM: 0,
  yawDeg,
});

function input(overrides: Partial<MovePromptInput> = {}): MovePromptInput {
  return {
    levelId: "lvl",
    offset: at(40),
    gateOpen: true,
    fixCount: 10,
    lastFixMs: 1_000_000,
    savedKey: "k1",
    answers: [],
    ...overrides,
  };
}

/** Feed `n` one-second fixes after `start`, returning the last result. */
function run(
  steps: number,
  overrides: Partial<MovePromptInput> = {},
  rule = RULE,
): { onset: MovePromptOnset | null; prompt: unknown } {
  let onset: MovePromptOnset | null = null;
  let result: { onset: MovePromptOnset | null; prompt: unknown } = {
    onset,
    prompt: null,
  };
  for (let i = 0; i <= steps; i += 1) {
    result = trackMovePrompt(
      onset,
      input({
        fixCount: 10 + i,
        lastFixMs: 1_000_000 + i * 1000,
        ...overrides,
      }),
      rule,
    );
    onset = result.onset;
  }
  return result;
}

describe("trackMovePrompt: when the prompt asks", () => {
  it("asks only once the offset has persisted beyond the trigger for the rule's fixes AND seconds", () => {
    // 4 one-second fixes: neither 5 fixes nor 10 s yet.
    expect(run(4).prompt).toBeNull();
    // 9 fixes over 9 s: the fix count is met, the time is not.
    expect(run(9).prompt).toBeNull();
    // 10 fixes over 10 s: both met.
    expect(run(10).prompt).toEqual({
      levelId: "lvl",
      horizontalM: 40,
      northM: 40,
      eastM: 0,
      yawDeg: 3,
      triggerM: 15,
      fixes: 10,
      seconds: 10,
      savedKey: "k1",
    });
  });

  it("counts fixes, not only time: a 20 s gap with one fix is not enough", () => {
    let onset: MovePromptOnset | null = null;
    onset = trackMovePrompt(onset, input({ fixCount: 10 }), RULE).onset;
    const late = trackMovePrompt(
      onset,
      input({ fixCount: 11, lastFixMs: 1_000_000 + 20_000 }),
      RULE,
    );
    expect(late.prompt).toBeNull();
  });

  it("never asks for a turn alone - a turned print is not a move (§7j #8)", () => {
    expect(run(60, { offset: at(12, 170) }).prompt).toBeNull();
  });

  // Why (D26): the settle refuses a correction only beyond about 26 m, and
  // below that the visit silently follows the code. The prompt's own trigger
  // asks for an 18 m offset that no refusal ever flagged, and stays quiet
  // at 12 m, with the shipped rule.
  it("asks for a code seen 18 m off with no refusal, never for 12 m (D26, the shipped 15 m trigger)", () => {
    expect(MOVE_PROMPT_RULE.floorM).toBe(15);
    const shipped = (northM: number) =>
      run(MOVE_PROMPT_RULE.minFixes, { offset: at(northM) }, MOVE_PROMPT_RULE)
        .prompt;
    expect(shipped(18)).toMatchObject({ horizontalM: 18, triggerM: 15 });
    expect(shipped(-18)).not.toBeNull();
    expect(shipped(12)).toBeNull();
    expect(shipped(15)).toBeNull();
  });

  it("never asks for an offset at or under the trigger, however long it lasts", () => {
    expect(run(60, { offset: at(14.9) }).prompt).toBeNull();
    expect(run(60, { offset: at(15) }).prompt).toBeNull();
    expect(run(60, { offset: at(15.5) }).prompt).not.toBeNull();
    // A non-finite size never asks.
    expect(
      run(60, { offset: { ...at(40), horizontalM: Number.NaN } }).prompt,
    ).toBeNull();
  });

  it("never asks while the mint gate is closed (§7j #9)", () => {
    expect(run(60, { gateOpen: false }).prompt).toBeNull();
  });

  it("starts counting again after any break in the offset", () => {
    let onset: MovePromptOnset | null = null;
    for (let i = 0; i <= 8; i += 1) {
      onset = trackMovePrompt(
        onset,
        input({ fixCount: 10 + i, lastFixMs: 1_000_000 + i * 1000 }),
        RULE,
      ).onset;
    }
    // One sighting under the trigger: the run is broken for a fix.
    onset = trackMovePrompt(
      onset,
      input({ offset: at(10), fixCount: 19, lastFixMs: 1_009_000 }),
      RULE,
    ).onset;
    expect(onset).toBeNull();
    // Beyond it again: two fixes later is not ten seconds of it.
    for (let i = 0; i <= 2; i += 1) {
      const r = trackMovePrompt(
        onset,
        input({ fixCount: 20 + i, lastFixMs: 1_010_000 + i * 1000 }),
        RULE,
      );
      onset = r.onset;
      expect(r.prompt).toBeNull();
    }
  });

  it("starts counting again for another level, and after the store's history restarted", () => {
    let onset: MovePromptOnset | null = run(12).onset;
    const other = trackMovePrompt(
      onset,
      input({ levelId: "other", fixCount: 23, lastFixMs: 1_013_000 }),
      RULE,
    );
    expect(other.prompt).toBeNull();
    expect(other.onset?.levelId).toBe("other");
    onset = run(12).onset;
    const restarted = trackMovePrompt(
      onset,
      input({ fixCount: 3, lastFixMs: 1_013_000 }),
      RULE,
    );
    expect(restarted.prompt).toBeNull();
    expect(restarted.onset?.fixCount).toBe(3);
  });

  it("lets the fix count alone decide when the fixes carry no time", () => {
    expect(run(5, { lastFixMs: null }).prompt).not.toBeNull();
    expect(run(4, { lastFixMs: null }).prompt).toBeNull();
  });

  it("asks nothing without a level, an offset or a readable fix count", () => {
    expect(run(60, { levelId: null }).prompt).toBeNull();
    expect(run(60, { offset: null }).prompt).toBeNull();
    expect(
      trackMovePrompt(null, input({ fixCount: Number.NaN }), RULE),
    ).toEqual({ onset: null, prompt: null });
  });
});

describe("trackMovePrompt: an answer is not asked again for the same spot (§7j #14)", () => {
  const answered = (
    answer: RememberedMoveAnswer["answer"],
    northM: number,
    levelId = "lvl",
    savedKey = "k1",
  ): RememberedMoveAnswer => ({ levelId, northM, eastM: 0, answer, savedKey });

  it("stays quiet for a spot within the same-spot distance of an answer", () => {
    for (const answer of ["second-copy", "not-now"] as const) {
      expect(
        run(30, { answers: [answered(answer, 40 + 14)] }).prompt,
      ).toBeNull();
    }
  });

  it("asks again for a markedly different spot, or for another code", () => {
    expect(
      run(30, { answers: [answered("not-now", 40 + 16)] }).prompt,
    ).not.toBeNull();
    expect(
      run(30, { answers: [answered("second-copy", 40, "other")] }).prompt,
    ).not.toBeNull();
  });

  it("asks again once the saved position changed: an answer counts only against the saved pose it was given for (M5b review #2)", () => {
    // An answer is an offset FROM the saved position at the time; after a
    // replace the same offset names another place. Undo brings the old
    // pose - and its key - back, so its answers count again.
    const old = answered("second-copy", 40, "lvl", "old-pose");
    expect(
      run(30, { answers: [old], savedKey: "new-pose" }).prompt,
    ).not.toBeNull();
    expect(run(30, { answers: [old], savedKey: "old-pose" }).prompt).toBeNull();
    // Without a saved pose's key there is nothing an answer could be kept
    // against: no prompt (the setup always has one with a level in hand).
    expect(run(30, { answers: [], savedKey: null }).prompt).toBeNull();
  });
});

describe("isSecondCopySpot (M5b review #11)", () => {
  // Why: a sighting at a spot the creator called "It's a second copy" is
  // another print, not the stored code, so the visit log must not count it
  // as a visit of that code. Only that answer says so - "Not now" leaves
  // the question open - and only for the same level, the same saved pose
  // and the same spot, exactly as the prompt itself stays quiet.
  const copy: RememberedMoveAnswer = {
    levelId: "lvl",
    northM: 40,
    eastM: 0,
    answer: "second-copy",
    savedKey: "k1",
  };
  const at = (northM: number, levelId = "lvl", savedKey = "k1") => ({
    levelId,
    savedKey,
    offset: { northM, eastM: 0 },
  });

  it("is true within the same-spot distance of a second-copy answer for that level and saved pose", () => {
    expect(isSecondCopySpot([copy], at(40 + 14), 15)).toBe(true);
    expect(isSecondCopySpot([copy], at(40 + MOVE_PROMPT_RULE.sameSpotM))).toBe(
      true,
    );
  });

  it("is false beyond it, for another level or saved pose, and for a 'Not now'", () => {
    expect(isSecondCopySpot([copy], at(40 + 16), 15)).toBe(false);
    expect(isSecondCopySpot([copy], at(40, "other"))).toBe(false);
    expect(isSecondCopySpot([copy], at(40, "lvl", "k2"))).toBe(false);
    expect(isSecondCopySpot([{ ...copy, answer: "not-now" }], at(40))).toBe(
      false,
    );
    expect(isSecondCopySpot([], at(40))).toBe(false);
  });

  it("is false for an offset that is not finite (defensive)", () => {
    expect(isSecondCopySpot([copy], at(Number.NaN))).toBe(false);
  });
});

describe("savedPoseKey", () => {
  it("is the same for the same pose json and differs for another", () => {
    const json = '{"lat":52.5,"lon":13.4,"rot":[0,0,0,1]}';
    expect(savedPoseKey(json)).toBe(savedPoseKey(json));
    expect(savedPoseKey(json)).not.toBe(
      savedPoseKey('{"lat":52.5,"lon":13.41,"rot":[0,0,0,1]}'),
    );
    expect(savedPoseKey(json)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("the remembered answers (kept in the draft's meta)", () => {
  const a = (northM: number, answer: "second-copy" | "not-now" = "not-now") =>
    ({ levelId: "lvl", northM, eastM: 0, answer, savedKey: "k1" }) as const;

  it("replaces an answer for the same spot instead of piling them up", () => {
    const list = rememberMoveAnswer([a(40)], a(45, "second-copy"));
    expect(list).toEqual([a(45, "second-copy")]);
    expect(rememberMoveAnswer([a(40)], a(80))).toEqual([a(40), a(80)]);
    // Another saved pose's answer for the same offset is another place: kept.
    const other = { ...a(40), savedKey: "k2" };
    expect(rememberMoveAnswer([a(40)], other)).toEqual([a(40), other]);
  });

  it("keeps at most the newest MOVE_ANSWERS_MAX", () => {
    let list: RememberedMoveAnswer[] = [];
    for (let i = 0; i < MOVE_ANSWERS_MAX + 5; i += 1) {
      list = rememberMoveAnswer(list, a(i * 100));
    }
    expect(list).toHaveLength(MOVE_ANSWERS_MAX);
    expect(list.at(-1)?.northM).toBe((MOVE_ANSWERS_MAX + 4) * 100);
    expect(list[0]?.northM).toBe(500);
  });

  it("reads back only well-formed answers from a meta file (external data)", () => {
    expect(
      parseMoveAnswers([
        a(40),
        { levelId: "", northM: 1, eastM: 1, answer: "not-now" },
        { levelId: "x", northM: "1", eastM: 1, answer: "not-now" },
        { levelId: "x", northM: 1, eastM: Number.NaN, answer: "not-now" },
        { levelId: "x", northM: 1, eastM: 1, answer: "yes", savedKey: "k1" },
        // "moved" (UI round 1, U3) reads back.
        { ...a(200), answer: "moved" },
        // An answer written before the saved-pose key existed (or with an
        // unreadable one) is dropped, never trusted for any pose.
        { levelId: "x", northM: 1, eastM: 1, answer: "not-now" },
        { levelId: "x", northM: 1, eastM: 1, answer: "not-now", savedKey: "" },
        { levelId: "x", northM: 1, eastM: 1, answer: "not-now", savedKey: 7 },
        null,
        7,
        a(90, "second-copy"),
      ]),
    ).toEqual([a(40), { ...a(200), answer: "moved" }, a(90, "second-copy")]);
    expect(parseMoveAnswers(undefined)).toEqual([]);
    expect(parseMoveAnswers({ length: 3 })).toEqual([]);
    expect(
      parseMoveAnswers(
        Array.from({ length: MOVE_ANSWERS_MAX + 3 }, (_, i) => a(i)),
      ),
    ).toHaveLength(MOVE_ANSWERS_MAX);
  });
});

describe("movePromptText", () => {
  // Why (UI round 1, U3; review F5): the question asks what the creator
  // knows - did the poster move? - not what the app should do with it.
  it("asks whether the poster moved, with the distance in whole metres", () => {
    expect(movePromptText(41.6)).toBe(
      "The code is about 42 m from its saved spot. Did the poster move here?",
    );
  });

  // Why: "Yes" no longer moves anything at once - the settle saves the new
  // spot only after enough walking - and the pins stay (D19); the line must
  // not promise more.
  it("says a 'moved' answer is saved at the visit's end, after enough walking, and the pins stay", () => {
    expect(MOVE_PROMPT_LABELS.moved).toMatch(/saved when this visit ends/);
    expect(MOVE_PROMPT_LABELS.moved).toMatch(/walked enough/);
    expect(MOVE_PROMPT_LABELS.moved).toMatch(/keep their places/);
  });
});

describe("answerAtSpot (UI round 1, U3)", () => {
  const at = (northM: number, savedKey = "k1") => ({
    levelId: "lvl",
    savedKey,
    offset: { northM, eastM: 0 },
  });
  const answer = (
    northM: number,
    a: "moved" | "second-copy" | "not-now",
  ): RememberedMoveAnswer => ({
    levelId: "lvl",
    northM,
    eastM: 0,
    answer: a,
    savedKey: "k1",
  });

  // Why: the settle saves a moved poster's new spot only for the spot the
  // creator answered, against the saved pose it was asked about.
  it("reads 'moved' and 'second-copy' for the same spot and saved pose, never 'not-now'", () => {
    expect(answerAtSpot([answer(40, "moved")], at(45))).toBe("moved");
    expect(answerAtSpot([answer(40, "second-copy")], at(45))).toBe(
      "second-copy",
    );
    expect(answerAtSpot([answer(40, "not-now")], at(45))).toBeNull();
    expect(answerAtSpot([answer(40, "moved")], at(80))).toBeNull();
    expect(answerAtSpot([answer(40, "moved")], at(40, "k2"))).toBeNull();
    expect(answerAtSpot([], at(40))).toBeNull();
    expect(answerAtSpot([answer(40, "moved")], at(Number.NaN))).toBeNull();
  });

  it("lets the newest covering answer count (an Undo re-answers 'not-now')", () => {
    const undone = rememberMoveAnswer(
      [answer(40, "moved")],
      answer(41, "not-now"),
    );
    expect(answerAtSpot(undone, at(40))).toBeNull();
  });
});

describe("MOVE_PROMPT_RULE", () => {
  // Why this test matters: the values come from the sweep in
  // code-move-prompt.sweep.test.ts (and its sidecar section); a change here
  // moves how long an author waits for the prompt and how often it asks
  // for a code that did not move, and must be re-read against it.
  it("records the swept defaults", () => {
    expect(MOVE_PROMPT_RULE).toEqual({
      minFixes: 20,
      minSeconds: 20,
      sameSpotM: 20,
      floorM: MOVE_PROMPT_FLOOR_M,
    });
  });

  // Why this test matters (D25, D26): the prompt and the viewer no longer
  // share one floor. The prompt only ASKS the author, at 15 m, measured on
  // the real cross-day pairs; the viewer ACTS on its own, at 20 m. Two named
  // constants, so neither moves with the other.
  it("asks beyond its own 15 m trigger; the viewer keeps its own 20 m floor", () => {
    expect(MOVE_PROMPT_FLOOR_M).toBe(15);
    expect(MOVED_CODE_FLOOR_M).toBe(20);
  });
});
