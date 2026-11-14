/**
 * Why this test matters: a sign or a glyph that eased the long way round
 * would spin almost a full turn when its target crosses behind it; these
 * hold the wrap's range and the short way for any angles.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { easeAngle, wrapAngle } from "./angle-easing.js";

const angle = fc.double({ min: -50, max: 50, noNaN: true });

describe("angles the short way round", () => {
  it("wraps into (-pi, pi], the same direction", () => {
    fc.assert(
      fc.property(angle, (a) => {
        const w = wrapAngle(a);
        expect(w).toBeGreaterThan(-Math.PI - 1e-12);
        expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
        expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
        expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      }),
    );
  });

  it("eases by at most half a turn, reaching the target at k = 1", () => {
    fc.assert(
      fc.property(
        angle,
        angle,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, k) => {
          const step = easeAngle(a, b, k) - a;
          expect(Math.abs(step)).toBeLessThanOrEqual(Math.PI * k + 1e-9);
          const end = easeAngle(a, b, 1);
          expect(Math.cos(end)).toBeCloseTo(Math.cos(b), 9);
          expect(Math.sin(end)).toBeCloseTo(Math.sin(b), 9);
          expect(easeAngle(a, b, 0) === a).toBe(true);
        },
      ),
    );
  });

  it("crosses behind the short way", () => {
    // 170 deg to -170 deg is 20 deg forward, not 340 deg back.
    const d = (x: number) => (x * Math.PI) / 180;
    expect(easeAngle(d(170), d(-170), 1)).toBeCloseTo(d(190), 9);
  });
});
