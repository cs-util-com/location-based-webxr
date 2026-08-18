/**
 * Why this test matters: the nudge is a user-facing fudge over a diagnosed
 * defect, so its arithmetic has to be boring and exact. Two properties carry
 * real weight — that repeated presses do not accumulate floating-point drift
 * (the reset case is compared against the un-nudged vector exactly), and that
 * the value is bounded, because a stuck button that pushes the city somewhere it
 * can never be seen again is worse than the misalignment it was fixing.
 */

import { describe, expect, it } from "vitest";

import {
  NUDGE_LIMIT_M,
  NUDGE_STEP_M,
  describeNudge,
  nudged,
} from "./elevation-nudge.js";

describe("nudged", () => {
  it("moves one step in the direction pressed", () => {
    expect(nudged(0, 1)).toBe(NUDGE_STEP_M);
    expect(nudged(0, -1)).toBe(-NUDGE_STEP_M);
  });

  it("accumulates exactly, with no floating-point drift", () => {
    // Ten presses up then ten down must return EXACTLY zero, not 1e-15. The
    // reset path compares against the un-nudged offset vector, so a value that
    // renders as "0 m" while comparing unequal would show as a scene that never
    // quite goes back.
    let value = 0;
    for (let i = 0; i < 10; i += 1) value = nudged(value, 1);
    for (let i = 0; i < 10; i += 1) value = nudged(value, -1);
    expect(value).toBe(0);
    expect(Object.is(value, 0)).toBe(true);
  });

  it("is bounded both ways", () => {
    let up = 0;
    for (let i = 0; i < 200; i += 1) up = nudged(up, 1);
    expect(up).toBe(NUDGE_LIMIT_M);

    let down = 0;
    for (let i = 0; i < 200; i += 1) down = nudged(down, -1);
    expect(down).toBe(-NUDGE_LIMIT_M);
  });

  it("still steps back from the limit", () => {
    // A clamp that also blocked the return would strand the user at the bound.
    expect(nudged(NUDGE_LIMIT_M, -1)).toBe(NUDGE_LIMIT_M - NUDGE_STEP_M);
  });

  it("takes an explicit step, so the reach is testable independently", () => {
    expect(nudged(0, 1, 0.25)).toBe(0.25);
  });

  it("uses a step that can actually reach the reported error", () => {
    // The field symptom is ~10 m. A step needing 40 presses to cross it is a
    // control nobody uses, and 0.25 m was chosen in an earlier draft against a
    // 1-2 m error that is not the symptom.
    expect(10 / NUDGE_STEP_M).toBeLessThanOrEqual(10);
  });
});

describe("describeNudge", () => {
  it("always signs a non-zero value", () => {
    expect(describeNudge(3)).toBe("+3 m");
    expect(describeNudge(-2)).toBe("−2 m");
  });

  it("shows zero rather than nothing", () => {
    // A control with no visible value leaves the user unsure it exists, and a
    // non-zero offset that is not shown is indistinguishable from bad data next
    // session.
    expect(describeNudge(0)).toBe("0 m");
  });

  it("never renders a non-finite value as a measurement", () => {
    expect(describeNudge(Number.NaN)).toBe("0 m");
  });
});
