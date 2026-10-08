/**
 * Why this test matters: the relief's exaggeration law decides how high
 * every mountain is drawn, and the clearance, the clip planes and the cloud
 * shell's height all read it. With the third band (city plan 2026-10-05-0040
 * K1) it rises from 1 to the near value on the way down from orbit and then
 * eases to the ground value near the ground. The properties, for any near
 * and ground values the lab accepts: E stays between 1 and the near value;
 * below the band it IS the ground value; above it the law is the default
 * one; and inside the band it never rises as the camera descends, so the
 * mountains shrink smoothly and never pump.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_FLIGHT, exaggerationAt } from "./globe-flight.js";

const nearE = fc.double({ min: 1, max: 5, noNaN: true });
const share = fc.double({ min: 0, max: 1, noNaN: true });
const altitude = fc.double({ min: 0, max: 6_000_000, noNaN: true });

describe("exaggerationAt with a ground value (properties)", () => {
  const step = GLOBE_FLIGHT.exaggerationStep;

  it("stays between 1 and the near value", () => {
    fc.assert(
      fc.property(nearE, share, altitude, (near, s, alt) => {
        const ground = 1 + (near - 1) * s;
        const e = exaggerationAt(alt, { near, ground });
        expect(e).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(e).toBeLessThanOrEqual(Math.round(near / step) * step + 1e-9);
      }),
    );
  });

  it("is the ground value below the band", () => {
    const below = fc.double({
      min: 0,
      max: GLOBE_FLIGHT.groundBandBottomM,
      noNaN: true,
    });
    fc.assert(
      fc.property(nearE, share, below, (near, s, alt) => {
        const ground = 1 + (near - 1) * s;
        expect(exaggerationAt(alt, { near, ground })).toBeCloseTo(
          Math.round(ground / step) * step,
          9,
        );
      }),
    );
  });

  it("is the default law above the band", () => {
    const above = fc.double({
      min: GLOBE_FLIGHT.groundBandTopM,
      max: 6_000_000,
      noNaN: true,
    });
    fc.assert(
      fc.property(nearE, share, above, (near, s, alt) => {
        const ground = 1 + (near - 1) * s;
        expect(exaggerationAt(alt, { near, ground })).toBe(
          exaggerationAt(alt, { near }),
        );
      }),
    );
  });

  it("never rises as the camera descends below the near-ground altitude", () => {
    fc.assert(
      fc.property(nearE, share, altitude, altitude, (near, s, a, b) => {
        const ground = 1 + (near - 1) * s;
        const lo = Math.min(a, b) % GLOBE_FLIGHT.exaggerationNearM;
        const hi = Math.max(a, b) % GLOBE_FLIGHT.exaggerationNearM;
        const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
        expect(exaggerationAt(low, { near, ground })).toBeLessThanOrEqual(
          exaggerationAt(high, { near, ground }),
        );
      }),
    );
  });
});
