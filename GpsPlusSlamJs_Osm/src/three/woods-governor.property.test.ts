import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createWoodsGovernor, WOODS_GOVERNOR } from "./woods-governor.js";

/**
 * Whatever the frames, the governor's share stays on its ladder (never no
 * woods), moves one rung at a time except for the worthwhile test's return
 * to full, and is a function of its input alone: the same frames give the
 * same shares, which is what makes a phone reading reproducible here.
 */
const frames = fc.array(
  fc.record({
    ms: fc.double({ min: 1, max: 4000, noNaN: true }),
    chained: fc.boolean(),
  }),
  { maxLength: 400 },
);

function shares(
  input: readonly { ms: number; chained: boolean }[],
  auto = true,
): number[] {
  const governor = createWoodsGovernor({ auto });
  const out: number[] = [];
  let at = 0;
  for (const { ms, chained } of input) {
    at += ms;
    governor.frame(at, chained);
    out.push(governor.state().share);
  }
  return out;
}

describe("woods governor properties", () => {
  it("keeps the share on the ladder and moves it one rung at a time, or back to full", () => {
    fc.assert(
      fc.property(frames, (input) => {
        const ladder: readonly number[] = WOODS_GOVERNOR.shares;
        let before = 1;
        for (const share of shares(input)) {
          expect(ladder).toContain(share);
          const step = ladder.indexOf(share) - ladder.indexOf(before);
          expect(step === 0 || Math.abs(step) === 1 || share === 1).toBe(true);
          before = share;
        }
      }),
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(frames, (input) => {
        expect(shares(input)).toEqual(shares(input));
      }),
    );
  });

  it("never moves with auto off", () => {
    fc.assert(
      fc.property(frames, (input) => {
        expect(shares(input, false).every((share) => share === 1)).toBe(true);
      }),
    );
  });

  // The idle-gap guard as a property: a frame stream with no chained frame
  // is all idle, so it can never thin the woods.
  it("never steps on unchained frames alone", () => {
    fc.assert(
      fc.property(frames, (input) => {
        const idle = input.map((frame) => ({ ...frame, chained: false }));
        expect(shares(idle).every((share) => share === 1)).toBe(true);
      }),
    );
  });
});
