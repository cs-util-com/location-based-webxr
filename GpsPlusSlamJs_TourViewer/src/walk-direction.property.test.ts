import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  WALK_AHEAD_DEG,
  WALK_BEHIND_DEG,
  WALK_DIRECTION_HYSTERESIS_DEG,
  walkDirection,
  type WalkDirection,
} from "./walk-direction";

/**
 * Why these properties matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, Tests): a phone held still jitters by a degree or two, and a visitor
 * turning slowly crosses a threshold many times in a second; without the
 * band the peek's tail and the rows would flicker between two words. The
 * property states the band's promise for every threshold, every band
 * width and every jitter smaller than it, rather than for the one value
 * the unit tests pin.
 */

const THRESHOLDS = [
  WALK_AHEAD_DEG,
  -WALK_AHEAD_DEG,
  WALK_BEHIND_DEG,
  -WALK_BEHIND_DEG,
];

describe("walkDirection - properties", () => {
  it("a heading jittering by less than the hysteresis around a threshold never changes the word", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...THRESHOLDS),
        fc.double({ min: 0.5, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 60,
        }),
        (threshold, h, share, steps) => {
          const jitter = h * share;
          let word: WalkDirection | null = null;
          let first: WalkDirection | null = null;
          for (const step of steps) {
            const angle = threshold + step * jitter;
            word = walkDirection(angle, word, { hysteresisDeg: h });
            first ??= word;
            expect(word).toBe(first);
          }
        },
      ),
    );
  });

  it("with no band, the word is the angle's zone alone", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom<WalkDirection | null>(
          null,
          "ahead",
          "left",
          "right",
          "behind",
        ),
        (angle, previous) => {
          expect(walkDirection(angle, previous, { hysteresisDeg: 0 })).toBe(
            walkDirection(angle),
          );
        },
      ),
    );
  });

  it("a word is always one of the zones next to the angle's", () => {
    // The band only ever keeps the PREVIOUS word, and only within h of
    // its zone: it never invents a word the angle is nowhere near.
    fc.assert(
      fc.property(
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom<WalkDirection | null>(
          null,
          "ahead",
          "left",
          "right",
          "behind",
        ),
        (angle, previous) => {
          const h = WALK_DIRECTION_HYSTERESIS_DEG;
          const word = walkDirection(angle, previous);
          const near = new Set(
            [angle - h, angle, angle + h].map((a) => walkDirection(a)),
          );
          expect(near.has(word)).toBe(true);
        },
      ),
    );
  });
});
