/**
 * Why these tests matter: the practice trainer must never be the silent
 * default of the real page, and a hand-typed address must never turn into
 * NaN timings or an unknown graphics state.
 */
import { describe, expect, it } from "vitest";

import { trainerChoiceFrom } from "./trainer-choice.js";

describe("trainerChoiceFrom", () => {
  it("is the unavailable trainer without a query", () => {
    expect(trainerChoiceFrom("")).toEqual({
      practice: false,
      gpu: "ready",
      pace: 1,
    });
    expect(trainerChoiceFrom("?trainer=fake").practice).toBe(false);
  });

  it("reads the practice flags", () => {
    expect(
      trainerChoiceFrom("?trainer=practice&pace=40&gpu=integrated"),
    ).toEqual({
      practice: true,
      gpu: "integrated",
      pace: 40,
    });
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
  });
});
