/**
 * Why these tests matter: a grip that drags at the first touch reorders a
 * list whenever a creator's flick to scroll it starts on a grip, and one
 * that drags at the first pixel of a mouse turns every click into a
 * reorder. The rule must tell a rested finger from a flick across a
 * plausible range of holds and tolerances, not at one value only, and a
 * mouse's small move from a click.
 */
import { describe, expect, it } from "vitest";

import { armIsValid, armState, type ArmState } from "./tree-drag-arm.js";

/** A finger's gesture as its moves: time since the press (ms) and the
 *  distance from where it went down (px). */
type Gesture = readonly { readonly ms: number; readonly px: number }[];

/** The first decided state of `gesture` under the rule, else "wait". */
function outcome(
  holdMs: number,
  tolerancePx: number,
  gesture: Gesture,
  pointer = "touch",
): ArmState {
  for (const move of gesture) {
    const state = armState(
      { holdMs, tolerancePx, movePx: 4 },
      { pointer, distancePx: move.px, ms: move.ms },
    );
    if (state !== "wait") return state;
  }
  return "wait";
}

/** Moves every 16 ms (a frame), `pxPerFrame` further each time. */
function moving(pxPerFrame: number, frames: number, fromMs = 0, fromPx = 0) {
  return Array.from({ length: frames }, (_, i) => ({
    ms: fromMs + (i + 1) * 16,
    px: fromPx + (i + 1) * pxPerFrame,
  }));
}

/** A finger resting (2 px of jitter) until `restMs`, then moving away. */
function rested(restMs: number): Gesture {
  return [
    { ms: 40, px: 2 },
    { ms: restMs - 10, px: 1 },
    ...moving(10, 4, restMs, 2),
  ];
}

const HOLDS = [100, 150, 200, 250];
const TOLERANCES = [4, 6, 8];

describe("armState, swept over holds and tolerances", () => {
  it("never drags for a flick or a slow scroll that starts on the grip", () => {
    for (const hold of HOLDS) {
      for (const tolerance of TOLERANCES) {
        for (const speed of [4, 12, 30]) {
          expect(outcome(hold, tolerance, moving(speed, 10)), [
            hold,
            tolerance,
            speed,
          ]).toBe("none");
        }
      }
    }
  });

  it("drags for a finger that rested 300 ms, at every hold up to 250 ms", () => {
    for (const hold of HOLDS) {
      for (const tolerance of TOLERANCES) {
        expect(outcome(hold, tolerance, rested(300)), [hold, tolerance]).toBe(
          "drag",
        );
      }
    }
  });

  it("a rest shorter than the hold drags nothing: the hold is the boundary", () => {
    // 120 ms of rest: a drag at a 100 ms hold, none from 150 ms on.
    expect(HOLDS.map((hold) => outcome(hold, 6, rested(120)))).toEqual([
      "drag",
      "none",
      "none",
      "none",
    ]);
  });

  it("a still finger is undecided until a move comes after the hold", () => {
    expect(outcome(150, 6, [{ ms: 149, px: 0 }])).toBe("wait");
    expect(outcome(150, 6, [{ ms: 150, px: 0 }])).toBe("drag");
    // Inside the tolerance it waits; past it, before the hold, never.
    expect(outcome(150, 6, [{ ms: 50, px: 6 }])).toBe("wait");
    expect(outcome(150, 6, [{ ms: 50, px: 6.5 }])).toBe("none");
  });

  it("a mouse or a pen drags from its move threshold on, whenever", () => {
    for (const pointer of ["mouse", "pen"]) {
      expect(outcome(150, 6, [{ ms: 5, px: 3.9 }], pointer)).toBe("wait");
      expect(outcome(150, 6, [{ ms: 5, px: 4 }], pointer)).toBe("drag");
      expect(outcome(150, 6, [{ ms: 900, px: 1 }], pointer)).toBe("wait");
    }
  });

  it("a move that is not numbers drags nothing", () => {
    const arm = { holdMs: 150, tolerancePx: 6, movePx: 4 };
    expect(armState(arm, { pointer: "touch", distancePx: NaN, ms: 300 })).toBe(
      "none",
    );
    expect(armState(arm, { pointer: "mouse", distancePx: 9, ms: NaN })).toBe(
      "none",
    );
  });

  it("takes only finite values of 0 or more as a rule", () => {
    expect(armIsValid({ holdMs: 150, tolerancePx: 6, movePx: 4 })).toBe(true);
    expect(armIsValid({ holdMs: 0, tolerancePx: 0, movePx: 0 })).toBe(true);
    for (const bad of [-1, NaN, Infinity]) {
      expect(armIsValid({ holdMs: bad, tolerancePx: 6, movePx: 4 })).toBe(
        false,
      );
      expect(armIsValid({ holdMs: 150, tolerancePx: bad, movePx: 4 })).toBe(
        false,
      );
      expect(armIsValid({ holdMs: 150, tolerancePx: 6, movePx: bad })).toBe(
        false,
      );
    }
  });
});
