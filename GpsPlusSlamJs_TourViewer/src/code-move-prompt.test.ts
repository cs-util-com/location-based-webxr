/**
 * The authoring prompt for a physically moved code (authoring plan
 * 2026-09-28-0953 §3.6 "Authoring (D20 ask once)", milestone M5b): when it
 * asks, what it remembers, and what it says.
 *
 * Why these tests matter: the prompt overwrites a code's saved position for
 * every visitor when the author says yes, so asking at the wrong moment is
 * the expensive failure. The cold review (§7j #8, #9) named the two wrong
 * moments - a yaw-only refusal (a turned print, not a move) and a transient
 * refusal of an immature alignment - and #14 asked that an answer is not
 * asked again for the same spot after a reload. Each test below pins one
 * of those rules on the pure tracker the creator setup calls on every
 * store change.
 */
import { describe, expect, it } from "vitest";

import { MOVED_CODE_FLOOR_M } from "./code-displacement.js";
import {
  isHorizontalRefusal,
  MOVE_ANSWERS_MAX,
  MOVE_PROMPT_RULE,
  movePromptText,
  parseMoveAnswers,
  rememberMoveAnswer,
  trackMovePrompt,
  type MovePromptInput,
  type MovePromptOnset,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";

const RULE = { minFixes: 5, minSeconds: 10, sameSpotM: 15, floorM: 20 };

/** A horizontal refusal: the code seen 40 m from its saved spot. */
const MOVED = {
  horizontalM: 40,
  yawDeg: 3,
  maxHorizontalM: 26.2,
  maxYawDeg: 120,
};

function input(overrides: Partial<MovePromptInput> = {}): MovePromptInput {
  return {
    levelId: "lvl",
    refusal: MOVED,
    offset: { northM: 40, eastM: 0 },
    gateOpen: true,
    fixCount: 10,
    lastFixMs: 1_000_000,
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

describe("isHorizontalRefusal", () => {
  it("is true only when the refusal broke the horizontal bound", () => {
    expect(isHorizontalRefusal(MOVED)).toBe(true);
    expect(isHorizontalRefusal({ horizontalM: 10, maxHorizontalM: 26.2 })).toBe(
      false,
    );
    expect(isHorizontalRefusal(null)).toBe(false);
    expect(isHorizontalRefusal({ ...MOVED, horizontalM: Number.NaN })).toBe(
      false,
    );
  });
});

describe("trackMovePrompt: when the prompt asks", () => {
  it("asks only once the refusal has persisted for the rule's fixes AND seconds", () => {
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
      maxHorizontalM: 26.2,
      fixes: 10,
      seconds: 10,
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

  it("never asks on a yaw-only refusal - a turned print is not a move (§7j #8)", () => {
    expect(
      run(60, {
        refusal: { ...MOVED, horizontalM: 12, yawDeg: 170 },
        offset: { northM: 12, eastM: 0 },
      }).prompt,
    ).toBeNull();
  });

  it("never asks for a refusal under the floor, however long it lasts (M5b review #1)", () => {
    // At a reported 2 m on both sides the refusal's bound is 13.5 m, so a
    // between-visit GPS bias difference of 15 m refuses an unmoved code.
    // The refusal stands (the correction is still not applied); only the
    // question "has it moved?" waits for the floor.
    const small = { ...MOVED, maxHorizontalM: 13.5 };
    expect(
      run(60, {
        refusal: { ...small, horizontalM: 19.9 },
        offset: { northM: 19.9, eastM: 0 },
      }).prompt,
    ).toBeNull();
    expect(
      run(60, {
        refusal: { ...small, horizontalM: 20.5 },
        offset: { northM: 20.5, eastM: 0 },
      }).prompt,
    ).not.toBeNull();
    // Above the floor the refusal's own bound still decides.
    expect(
      run(60, {
        refusal: { ...MOVED, horizontalM: 26, maxHorizontalM: 26.2 },
        offset: { northM: 26, eastM: 0 },
      }).prompt,
    ).toBeNull();
  });

  it("never asks while the mint gate is closed (§7j #9)", () => {
    expect(run(60, { gateOpen: false }).prompt).toBeNull();
  });

  it("starts counting again after any break in the refusal", () => {
    let onset: MovePromptOnset | null = null;
    for (let i = 0; i <= 8; i += 1) {
      onset = trackMovePrompt(
        onset,
        input({ fixCount: 10 + i, lastFixMs: 1_000_000 + i * 1000 }),
        RULE,
      ).onset;
    }
    // One accepted sighting: the refusal is gone for a fix.
    onset = trackMovePrompt(
      onset,
      input({ refusal: null, fixCount: 19, lastFixMs: 1_009_000 }),
      RULE,
    ).onset;
    expect(onset).toBeNull();
    // Refused again: two fixes later is not ten seconds of refusal.
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
  ): RememberedMoveAnswer => ({ levelId, northM, eastM: 0, answer });

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
});

describe("the remembered answers (kept in the draft's meta)", () => {
  const a = (northM: number, answer: "second-copy" | "not-now" = "not-now") =>
    ({ levelId: "lvl", northM, eastM: 0, answer }) as const;

  it("replaces an answer for the same spot instead of piling them up", () => {
    const list = rememberMoveAnswer([a(40)], a(45, "second-copy"));
    expect(list).toEqual([a(45, "second-copy")]);
    expect(rememberMoveAnswer([a(40)], a(80))).toEqual([a(40), a(80)]);
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
        { levelId: "x", northM: 1, eastM: 1, answer: "yes" },
        null,
        7,
        a(90, "second-copy"),
      ]),
    ).toEqual([a(40), a(90, "second-copy")]);
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
  it("names the distance in whole metres", () => {
    expect(movePromptText(41.6)).toBe(
      "This code seems to have moved about 42 m. Use the new spot?",
    );
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
      floorM: MOVED_CODE_FLOOR_M,
    });
  });

  // Why this test matters: the floor is ONE decision meant for both the
  // prompt and the viewer's rule (coordinator, 2026-10-01; provisional
  // until the owner's recordings), so the prompt reads it from the one
  // constant instead of restating it.
  it("asks only beyond the shared moved-code floor of 20 m", () => {
    expect(MOVED_CODE_FLOOR_M).toBe(20);
  });
});
