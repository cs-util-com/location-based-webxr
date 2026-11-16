import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { standHereDevelop, standHereTarget } from "./stand-here.js";

const anyNumber = fc.oneof(
  fc.double(),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -1, 0),
);

describe("a stand-here video's develop, for any frame", () => {
  // Why: the develop drives an opacity and a start; out of 0 to 1, or
  // moving away from its target, it would flash the clip or start it
  // while the visitor walks off.
  it("stays in 0 to 1 and never passes its target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (develop, target, dt) => {
          const next = standHereDevelop(develop, target, dt);
          expect(next).toBeGreaterThanOrEqual(
            Math.min(develop, target) - 1e-12,
          );
          expect(next).toBeLessThanOrEqual(Math.max(develop, target) + 1e-12);
        },
      ),
    );
    fc.assert(
      fc.property(anyNumber, anyNumber, anyNumber, (develop, target, dt) => {
        const next = standHereDevelop(develop, target, dt);
        expect(next >= 0 && next <= 1).toBe(true);
      }),
    );
  });

  it("targets less the farther off and the more turned away", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 180, noNaN: true }),
        (d1, d2, a1, a2) => {
          const t = standHereTarget(Math.min(d1, d2), Math.min(a1, a2));
          expect(t).toBeGreaterThanOrEqual(
            standHereTarget(Math.max(d1, d2), Math.max(a1, a2)),
          );
          expect(t >= 0 && t <= 1).toBe(true);
        },
      ),
    );
  });
});
