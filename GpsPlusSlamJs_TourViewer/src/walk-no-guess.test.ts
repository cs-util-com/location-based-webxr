import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  NO_GUESS_START,
  noGuessStep,
  WALK_NO_GUESS_HOLD_MS,
  type NoGuessClock,
} from "./walk-no-guess";

/**
 * Why these tests matter (visitor walk W4 build plan M4, §1.9 R-2): with
 * no distance shown an any-order tour guesses no station. The guess goes
 * at once and comes back only once the distance has been back for a hold
 * without a break, so a fix flickering around the ceiling, or a code
 * session dropping its pose for a moment, does not flip the peek, the
 * radar's orange and the breadcrumbs between a station and none.
 */
describe("noGuessStep", () => {
  it("enters at once without a distance and leaves after the hold of an unbroken distance", () => {
    let c: NoGuessClock = NO_GUESS_START;
    expect(c.noGuess).toBe(false);
    c = noGuessStep(c, false, 0);
    expect(c).toEqual({ noGuess: true, backAtMs: null });
    c = noGuessStep(c, true, 1_000);
    expect(c).toEqual({ noGuess: true, backAtMs: 1_000 });
    c = noGuessStep(c, true, 1_000 + WALK_NO_GUESS_HOLD_MS - 1);
    expect(c.noGuess).toBe(true);
    // A break restarts the hold.
    c = noGuessStep(c, false, 3_500);
    c = noGuessStep(c, true, 4_000);
    c = noGuessStep(c, true, 4_000 + WALK_NO_GUESS_HOLD_MS - 1);
    expect(c.noGuess).toBe(true);
    c = noGuessStep(c, true, 4_000 + WALK_NO_GUESS_HOLD_MS);
    expect(c).toEqual({ noGuess: false, backAtMs: null });
    // With a distance and no guess withheld nothing changes.
    expect(noGuessStep(c, true, 99_999)).toBe(c);
  });

  it("a clock that is no number changes nothing", () => {
    const c = noGuessStep(NO_GUESS_START, false, 0);
    expect(noGuessStep(c, true, Number.NaN)).toBe(c);
    expect(noGuessStep(NO_GUESS_START, false, Number.NaN)).toBe(NO_GUESS_START);
  });

  // The plan's bound: over T s of ticks a flapping input dispatches at
  // most 2 x floor(T / hold) + 1 transitions, whatever the tick rate - a
  // leave needs a hold of distance of its own, and each enter but the
  // first follows a leave.
  it("a flapping input over T makes at most 2 floor(T / hold) + 1 transitions, at any tick rate", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 2_000 }), fc.boolean()), {
          maxLength: 400,
        }),
        fc.constantFrom(1_000, 3_000, 5_000, 10_000),
        (steps, holdMs) => {
          let c = NO_GUESS_START;
          let t = 0;
          let transitions = 0;
          for (const [dt, shown] of steps) {
            t += dt;
            const next = noGuessStep(c, shown, t, holdMs);
            if (next.noGuess !== c.noGuess) transitions += 1;
            c = next;
          }
          expect(transitions).toBeLessThanOrEqual(
            2 * Math.floor(t / holdMs) + 1,
          );
        },
      ),
    );
  });
});
