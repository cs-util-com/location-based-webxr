/**
 * Why these tests matter: the practice trainer must never be the silent
 * default of the real page, and a hand-typed address must never turn into
 * NaN timings or an unknown graphics state.
 */
import { describe, expect, it } from "vitest";

import { trainerChoiceFrom } from "./trainer-choice.js";

describe("trainerChoiceFrom", () => {
  // Why: the real trainer is the page's default; the practice one runs
  // only on its exact flag, so it can never stand in silently.
  it("is the GPU trainer without a query or with a value it does not know", () => {
    expect(trainerChoiceFrom("")).toEqual({
      trainer: "gpu",
      gpu: "ready",
      pace: 1,
      lost: null,
    });
    expect(trainerChoiceFrom("?trainer=fake").trainer).toBe("gpu");
    expect(trainerChoiceFrom("?trainer=gpu").trainer).toBe("gpu");
    expect(trainerChoiceFrom("?trainer=PRACTICE").trainer).toBe("gpu");
  });

  it("reads the practice flags", () => {
    expect(
      trainerChoiceFrom("?trainer=practice&pace=40&gpu=integrated"),
    ).toEqual({
      trainer: "practice",
      gpu: "integrated",
      pace: 40,
      lost: null,
    });
    // Which stretch loses the graphics card on its first try (1-based).
    expect(trainerChoiceFrom("?trainer=practice&lost=2").lost).toBe(2);
    expect(trainerChoiceFrom("?trainer=practice&gpu=no-webgpu").gpu).toBe(
      "no-webgpu",
    );
  });

  it("falls back on values it does not know, never NaN", () => {
    const c = trainerChoiceFrom("?trainer=practice&pace=fast&gpu=quantum");
    expect(c.pace).toBe(1);
    expect(c.gpu).toBe("ready");
    expect(trainerChoiceFrom("?pace=-3").pace).toBe(1);
    expect(trainerChoiceFrom("?pace=Infinity").pace).toBe(1);
    for (const bad of ["0", "-1", "1.5", "two", ""]) {
      expect(trainerChoiceFrom(`?lost=${bad}`).lost).toBeNull();
    }
  });
});
