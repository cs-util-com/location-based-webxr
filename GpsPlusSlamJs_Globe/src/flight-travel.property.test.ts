/**
 * Property tests for the meteor law (round-3 plan 2026-10-08-2345 F1).
 * Why this file matters: the law must be continuous at the bend and end at
 * 45 for every beta and landing, its sweep must fall strictly with beta
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
  it("is continuous at the bend and 45 at the landing", () => {
    fc.assert(
      fc.property(beta, landing, (b, l) => {
        const bend = bendAltitudeM(l);
        expect(
          Math.abs(
            travelLawDeg(bend * 1.00001, l, b) -
              travelLawDeg(bend * 0.99999, l, b),
          ),
        ).toBeLessThan(0.01);
        expect(travelLawDeg(l, l, b)).toBe(45);
      }),
    );
  });

  it("sweeps less as beta rises, from any start", () => {
    fc.assert(
      fc.property(
        beta,
        fc.double({ min: 0.2, max: 10, noNaN: true }),
        fc.double({ min: 500 * KM, max: 65_000 * KM, noNaN: true }),
        (b, d, h0) => {
          const steeper = Math.min(90, b + d);
          expect(meteorDiveArcRad(h0, 2 * KM, steeper)).toBeLessThan(
            meteorDiveArcRad(h0, 2 * KM, b),
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
          // Fitted below 90, its sweep fits the arc (at 90, R1, it may not:
          // R1 backs off its own dive, about 16 km).
          const sweep = meteorDiveArcRad(h0, 2 * KM, fitted);
          expect(fitted >= 90 || sweep <= arc * (1 + 1e-6)).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
