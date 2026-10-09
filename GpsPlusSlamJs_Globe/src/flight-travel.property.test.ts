/**
 * Property tests for the meteor law (round-3 plan 2026-10-08-2345 F1).
 * Why this file matters: the law must be continuous at the bend and end at
 * beta itself for every beta and landing (F1b, DEC-R3-9), its sweep must fall strictly with beta
 * (the fit bisects on it), and the fit must never pass the asked beta nor
 * overshoot the arc it was given.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  bendAltitudeM,
  fitMeteorDeg,
  meteorDiveArcRad,
  travelLawDeg,
} from "./flight-travel.js";

const KM = 1_000;
const beta = fc.double({ min: 15, max: 89.5, noNaN: true });
const landing = fc.double({ min: 0.5 * KM, max: 20 * KM, noNaN: true });

describe("the meteor law's properties", () => {
  it("is continuous at the bend and beta at the landing", () => {
    fc.assert(
      fc.property(beta, landing, (b, l) => {
        const bend = bendAltitudeM(l);
        expect(
          Math.abs(
            travelLawDeg(bend * 1.00001, l, b) -
              travelLawDeg(bend * 0.99999, l, b),
          ),
        ).toBeLessThan(0.01);
        expect(travelLawDeg(l, l, b)).toBeCloseTo(b, 9);
      }),
    );
  });

  // Within the line family (beta under 90): R1 (beta 90) keeps its ease to
  // 45 below the bend since F1b, so it sweeps more than a near-vertical
  // line and is not the family's limit; the fit sends the arcs R1 fits to
  // R1 before it bisects among the lines.
  it("sweeps less as beta rises among the lines, from any start", () => {
    fc.assert(
      fc.property(
        beta,
        fc.double({ min: 0.2, max: 10, noNaN: true }),
        fc.double({ min: 500 * KM, max: 65_000 * KM, noNaN: true }),
        (b, d, h0) => {
          const steeper = Math.min(89.9, b + d);
          fc.pre(steeper > b);
          expect(meteorDiveArcRad(h0, 2 * KM, steeper)).toBeLessThan(
            meteorDiveArcRad(h0, 2 * KM, b),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  // DEC-R3-12: every candidate of a fit lands at the asked angle, so with
  // that landing angle fixed the family is whole again: the sweep falls
  // strictly with beta up to and including 90 (R1, easing to the asked
  // angle), which the fit's bisection needs.
  it("sweeps less as beta rises up to R1, at a fixed landing angle", () => {
    fc.assert(
      fc.property(
        beta,
        fc.double({ min: 0.2, max: 10, noNaN: true }),
        fc.double({ min: 500 * KM, max: 65_000 * KM, noNaN: true }),
        (b, d, h0) => {
          const steeper = Math.min(90, b + d);
          fc.pre(steeper > b);
          expect(meteorDiveArcRad(h0, 2 * KM, steeper, b)).toBeLessThan(
            meteorDiveArcRad(h0, 2 * KM, b, b),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("fits a beta no flatter than asked whose sweep fits the arc", () => {
    fc.assert(
      fc.property(
        beta,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 500 * KM, max: 30_000 * KM, noNaN: true }),
        (b, share, h0) => {
          const arc = share * meteorDiveArcRad(h0, 2 * KM, b) * 1.2;
          const fitted = fitMeteorDeg(h0, 2 * KM, arc, b);
          expect(fitted).toBeGreaterThanOrEqual(b);
          expect(fitted).toBeLessThanOrEqual(90);
          // Fitted below 90, its sweep (landing at the asked angle) fits the
          // arc (at 90, R1, it may not: R1 backs off its own dive).
          const sweep = meteorDiveArcRad(h0, 2 * KM, fitted, b);
          expect(fitted >= 90 || sweep <= arc * (1 + 1e-6)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
