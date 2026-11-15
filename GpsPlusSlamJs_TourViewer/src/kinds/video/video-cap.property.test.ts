/**
 * Why these properties matter: whatever the visitor and the videos do,
 * in any order, the cap must never let more than its limit play nor two
 * be heard, must hear only one that plays, and must never leave a place
 * free while a video waits for one. The limit is swept from 1 to 4: the
 * value 2 is a guess about phones, and the rule must hold for any value
 * it may be moved to.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { capStep, EMPTY_CAP, type CapAction } from "./video-cap.js";

const IDS = ["a", "b", "c", "d", "e"] as const;

const action: fc.Arbitrary<CapAction> = fc.record({
  type: fc.constantFrom("ask", "leave", "heard", "quiet"),
  id: fc.constantFrom(...IDS),
});

describe("the play cap, over any sequence", () => {
  it("never plays more than its limit nor hears more than one, and wastes no place", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.array(action, { maxLength: 60 }),
        (limit, actions) => {
          let state = EMPTY_CAP;
          for (const a of actions) {
            const step = capStep(state, a, limit);
            const before = state;
            state = step.state;
            expect(state.playing.length).toBeLessThanOrEqual(limit);
            if (state.audible !== null) {
              expect(state.playing).toContain(state.audible);
            }
            // Playing and waiting are apart, and each lists a video once.
            const all = [...state.playing, ...state.waiting];
            expect(new Set(all).size).toBe(all.length);
            // Nobody waits while a place is free.
            if (state.waiting.length > 0) {
              expect(state.playing.length).toBe(limit);
            }
            // A video granted now did not play before, and plays now.
            for (const id of step.granted) {
              expect(before.playing).not.toContain(id);
              expect(state.playing).toContain(id);
            }
            // The one muted was heard before and is not now.
            for (const id of step.muted) {
              expect(before.audible).toBe(id);
              expect(state.audible).not.toBe(id);
            }
          }
        },
      ),
    );
  });
});
