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
import { DESCENT_MAX_START_M } from "./ar-descent.js";

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

describe("the limit's REASONING, not just its value (Q5)", () => {
  /**
   * Why this test matters: every existing assertion is written against
   * `NUDGE_LIMIT_M` itself, so the constant could be changed to any number at
   * all and the suite would stay green — including to a value that reintroduces
   * the failure the bound exists to prevent, which is pushing the scene
   * somewhere it can never be recovered from.
   *
   * The bound moved from 50 m to 100 m in round four because Q5's entry
   * fly-down starts the session at the 3D view's camera height, so a user can
   * legitimately be a long way BELOW the city and want to walk it up by hand if
   * the entry move
   * is interrupted. These pin the properties that made 100 acceptable, so the
   * next change has to argue with something.
   */
  it("stays recoverable by hand in a few seconds of holding", () => {
    // THE PROPERTY THAT BOUNDS THE BOUND. At `NUDGE_STEP_M` per press and a
    // typical ~20 presses/second key-repeat or hold, the whole range has to be
    // traversable in a handful of seconds — otherwise "recoverable" is a claim
    // rather than a fact, and the scene IS effectively lost.
    const pressesToCross = (2 * NUDGE_LIMIT_M) / NUDGE_STEP_M;
    expect(pressesToCross).toBeLessThanOrEqual(200);
  });

  it("still reaches well past the vertical error it exists to null", () => {
    // The original justification: "five times the reported symptom". The
    // reported symptom is a ~10 m GPS-altitude offset, and the bound must stay
    // comfortably above it or the control cannot do its first job.
    const REPORTED_SYMPTOM_M = 10;
    expect(NUDGE_LIMIT_M).toBeGreaterThanOrEqual(5 * REPORTED_SYMPTOM_M);
  });

  it("covers the height the entry descent can start from", () => {
    // The new reason for the bound. If the descent may begin above the nudge's
    // reach, an interrupted descent leaves the user unable to walk the scene
    // down by hand — the exact unrecoverable state the limit exists to prevent,
    // arriving by a route the limit was not written for.
    expect(NUDGE_LIMIT_M).toBeGreaterThanOrEqual(DESCENT_MAX_START_M);
  });
});
