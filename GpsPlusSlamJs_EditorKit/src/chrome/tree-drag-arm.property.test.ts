/**
 * Why these properties matter: a grip's arm decides by the events' own
 * times, so waiting longer must never undo a finger's drag nor turn a
 * flick that already failed into one, and a mouse or a pen, which drags
 * by distance alone, must not depend on how fast the page handles it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { armState, type TreeDragArm } from "./tree-drag-arm.js";

const arm: fc.Arbitrary<TreeDragArm> = fc.record({
  holdMs: fc.double({ min: 0, max: 1000, noNaN: true }),
  tolerancePx: fc.double({ min: 0, max: 40, noNaN: true }),
  movePx: fc.double({ min: 0, max: 40, noNaN: true }),
});
const px = fc.double({ min: 0, max: 200, noNaN: true });
const ms = fc.double({ min: 0, max: 2000, noNaN: true });

describe("armState, as properties", () => {
  it("is monotone in time for a finger: later, a drag stays one and a refusal was one before", () => {
    fc.assert(
      fc.property(arm, px, ms, ms, (rule, distancePx, a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        const at = (t: number) =>
          armState(rule, { pointer: "touch", distancePx, ms: t });
        const [first, then] = [at(early), at(late)];
        expect(first !== "drag" || then === "drag", "a drag stays one").toBe(
          true,
        );
        expect(then !== "none" || first === "none", "a refusal was one").toBe(
          true,
        );
      }),
    );
  });

  it("ignores time for a mouse or a pen", () => {
    fc.assert(
      fc.property(
        arm,
        px,
        ms,
        ms,
        fc.constantFrom("mouse", "pen"),
        (rule, distancePx, a, b, pointer) => {
          expect(armState(rule, { pointer, distancePx, ms: a })).toBe(
            armState(rule, { pointer, distancePx, ms: b }),
          );
        },
      ),
    );
  });
});
