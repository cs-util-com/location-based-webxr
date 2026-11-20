/**
 * Why these tests matter: the page shows one print per window of the real
 * planner and prints its metres; a dropped window, a renumbered one or
 * metres that run backwards would show the person a walk that is not the
 * one being trained, without any error.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TRAINER_DEFAULTS } from "./trainer-defaults.js";
import { planWindows } from "./walk-windows.js";
import {
  stretchesFromPlan,
  walkedDistances,
  windowPlanner,
} from "./window-plan.js";

/** A walk along x at `spacing` metres per second. */
const walk = (n: number, spacing = 1.2) => ({
  captures: Array.from({ length: n }, (_, i) => ({
    position: [i * spacing, 0, 0] as [number, number, number],
    capturedAt: i * 1000,
  })),
});

describe("stretchesFromPlan", () => {
  it("gives one stretch per planned window, in order, with its core count", () => {
    const input = walk(200);
    const plan = planWindows(input.captures, TRAINER_DEFAULTS);
    const stretches = windowPlanner()(input);
    expect(stretches.length).toBe(plan.windows.length);
    expect(stretches.length).toBeGreaterThan(3);
    stretches.forEach((s, i) => {
      expect(s).toMatchObject({
        id: `w${i}`,
        index: i,
        frames: plan.windows[i]?.core.length,
      });
      expect(s.window).toEqual(plan.windows[i]);
    });
    expect(stretches[0]?.fromM).toBe(0);
    expect(stretches.at(-1)?.toM).toBeCloseTo(199 * 1.2);
  });

  it("gives no stretch for an empty walk", () => {
    expect(windowPlanner()({ captures: [] })).toEqual([]);
  });

  it("treats a non-finite pose step as no distance", () => {
    const d = walkedDistances([
      { position: [0, 0, 0] },
      { position: [Number.NaN, 0, 0] },
      { position: [3, 0, 0] },
    ]);
    expect(d.every(Number.isFinite)).toBe(true);
  });

  it("numbers stretches densely and their metres never run backwards (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 4, noNaN: true }), {
          minLength: 1,
          maxLength: 400,
        }),
        (steps) => {
          let x = 0;
          const input = {
            captures: steps.map((s, i) => ({
              position: [(x += s), 0, 0] as [number, number, number],
              capturedAt: i * 1000,
            })),
          };
          const plan = planWindows(input.captures, TRAINER_DEFAULTS);
          const stretches = stretchesFromPlan(input.captures, plan);
          expect(stretches.length).toBe(
            plan.windows.filter((w) => w.core.length > 0).length,
          );
          let last = 0;
          for (const [i, s] of stretches.entries()) {
            expect(s.index).toBe(i);
            expect(s.frames).toBeGreaterThan(0);
            expect(s.fromM).toBeGreaterThanOrEqual(last);
            expect(s.toM).toBeGreaterThanOrEqual(s.fromM);
            last = s.toM;
          }
        },
      ),
    );
  });
});
