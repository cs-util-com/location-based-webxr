import { describe, expect, it } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import {
  CUT_CHOICE_DEFAULTS,
  draftOf,
  freshDraft,
  hasDraft,
  MAKER_STEPS,
  nextLabel,
  reachable,
  stepInfo,
} from "./maker-draft.js";

describe("maker-draft", () => {
  // Why: the sliders start at the cut's own defaults, which rest on the
  // sweep; the page must not carry a second set of numbers.
  it("starts the cut choice at the cut's defaults", () => {
    expect(CUT_CHOICE_DEFAULTS).toEqual({
      whiteTol: CUT_SETTINGS.whiteTol,
      shadowOn: CUT_SETTINGS.shadowOn,
      shadowFloor: CUT_SETTINGS.shadowFloor,
      islandMin: CUT_SETTINGS.islandMin,
      edgeSoft: CUT_SETTINGS.edgeSoft,
    });
  });

  // Why: "as drawn" is preselected (the jumping body is liked), with
  // "steady" one tap away.
  it("starts at step one with as drawn chosen", () => {
    const d = freshDraft();
    expect([d.step, d.choice, d.ground]).toEqual([0, "drawn", "meadow"]);
    expect(hasDraft(d)).toBe(false);
  });

  // Why: the draft comes back from storage, which another version or a
  // broken write may have left in any shape; every field falls back alone.
  it("reads a stored draft field by field", () => {
    const d = draftOf({
      step: 4,
      maxStep: 3,
      desc: "a fox",
      choice: "steady",
      ground: "snow",
      name: "Pip",
      copiedAt: 5,
      cut: { whiteTol: 40, shadowOn: false, islandMin: 9999, edgeSoft: "x" },
      extra: true,
    });
    expect(d).toMatchObject({
      step: 4,
      maxStep: 3,
      desc: "a fox",
      choice: "steady",
      ground: "snow",
    });
    expect(d.cut).toEqual({
      ...CUT_CHOICE_DEFAULTS,
      whiteTol: 40,
      shadowOn: false,
    });
    expect(
      draftOf({ step: 9, choice: "wobbly", ground: "mars", desc: 3 }),
    ).toEqual(freshDraft());
    expect(draftOf("garbage")).toEqual(freshDraft());
  });

  // Why: an unfinished character is offered again on the library page; a
  // saved one is not.
  it("knows an unfinished draft", () => {
    expect(hasDraft({ ...freshDraft(), desc: "x" })).toBe(true);
    expect(hasDraft({ ...freshDraft(), step: 2 })).toBe(true);
    expect(hasDraft({ ...freshDraft(), step: 5, savedId: "c1" })).toBe(false);
  });

  // Why: the stepper's words are the author's map; a failed picture says
  // why on its step, and the check and save steps open only with a cut.
  it("describes each step", () => {
    const d = {
      ...freshDraft(),
      desc: "a friendly fox park ranger with a hat",
    };
    expect(stepInfo(d, 0, false)).toEqual({
      state: "done",
      sub: '"a friendly fox park ranger..."',
    });
    expect(stepInfo(freshDraft(), 1, false)).toEqual({
      state: "todo",
      sub: "One button",
    });
    expect(stepInfo({ ...d, failure: "Only three poses" }, 3, false)).toEqual({
      state: "failed",
      sub: "Only three poses",
    });
    expect(stepInfo(d, 4, true)).toEqual({ state: "done", sub: "As drawn" });
    expect(stepInfo({ ...d, choice: "steady" }, 4, true).sub).toBe(
      "Steady body",
    );
    expect(stepInfo({ ...d, savedId: "c1" }, 5, true)).toEqual({
      state: "done",
      sub: "Saved on this device",
    });
    expect(MAKER_STEPS).toHaveLength(6);
  });

  it("opens the later steps only when reached or cut", () => {
    const d = { ...freshDraft(), maxStep: 1 };
    expect([0, 1, 2, 3, 4, 5].map((i) => reachable(d, i, false))).toEqual([
      true,
      true,
      false,
      true,
      false,
      false,
    ]);
    expect(reachable(d, 4, true)).toBe(true);
  });

  // Why: the one main button names what it does next, and while a cut runs
  // it says so and cannot be pressed (the async rule).
  it("names the next action", () => {
    expect(nextLabel({ ...freshDraft(), step: 3 }, false, true)).toEqual({
      label: "Cutting the picture...",
      disabled: true,
    });
    expect(nextLabel({ ...freshDraft(), step: 3 }, true, false).label).toBe(
      "Next: check your character",
    );
    expect(nextLabel({ ...freshDraft(), step: 3 }, false, false).label).toBe(
      "Choose the picture",
    );
    expect(nextLabel({ ...freshDraft(), step: 5 }, true, false).label).toBe(
      "Save the character",
    );
    expect(
      nextLabel({ ...freshDraft(), step: 5, savedId: "c1" }, true, false).label,
    ).toBe("Make another");
  });
});
