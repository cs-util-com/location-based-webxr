/**
 * Why these tests matter: "never a flight that looks stuck" is the owner's
 * first rule for the approach. For any tour place, ground height and
 * flight length these check that the camera's height only ever falls,
 * falls a visible amount in every stretch of the flight (no plateau), and
 * that the bar it drives only ever rises.
 *
 * Parameter: the stretch length and the smallest fall per stretch. The
 * fall is eased at both ends, so the first and last stretches fall least;
 * the check is swept over stretches of 1/10, 1/20 and 1/40 of the flight,
 * and the smallest fall measured in each sweep step must be at least a
 * fixed share of what an even fall would give (0.2 of it at 1/10, shrinking
 * with the square of the stretch: smoothstep's slope at the ends is 0, so
 * its first stretch of length s falls by about 3 s^2 of the whole).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { streetView } from "./globe-editor-look.js";
import {
  approachFlight,
  barValue,
  flightPoseAt,
} from "./globe-approach-flight.js";

const place = fc.record({
  lat: fc.double({ min: -75, max: 75, noNaN: true }),
  lng: fc.double({ min: -180, max: 179.999, noNaN: true }),
  groundM: fc.double({ min: -430, max: 4_800, noNaN: true }),
  reduced: fc.boolean(),
});

describe("the approach, for any place", () => {
  it("only falls and its bar only rises", () => {
    fc.assert(
      fc.property(place, ({ lat, lng, groundM, reduced }) => {
        const goal = streetView({ lat, lng }, groundM);
        const f = approachFlight(goal, groundM, { reducedMotion: reduced });
        let h = Number.POSITIVE_INFINITY;
        let bar = -1;
        for (let k = 0; k <= 100; k++) {
          const p = flightPoseAt(f, (f.durationMs * k) / 100);
          expect(p.altitudeKm).toBeLessThanOrEqual(h + 1e-12);
          const b = barValue(f, p.altitudeKm);
          expect(b).toBeGreaterThanOrEqual(bar - 1e-12);
          h = p.altitudeKm;
          bar = b;
          expect(p.lng).toBeGreaterThanOrEqual(-180);
          expect(p.lng).toBeLessThan(180);
        }
        expect(bar).toBe(1);
      }),
    );
  });

  it.each([10, 20, 40])(
    "falls a visible share in every 1/%i of the flight",
    (steps) => {
      fc.assert(
        fc.property(place, ({ lat, lng, groundM }) => {
          const goal = streetView({ lat, lng }, groundM);
          const f = approachFlight(goal, groundM);
          const even = 1 / steps;
          // smoothstep's first stretch of length s covers 3s^2 - 2s^3.
          const floor = 0.5 * (3 * even * even - 2 * even ** 3);
          for (let k = 0; k < steps; k++) {
            const a = barValue(
              f,
              flightPoseAt(f, (f.durationMs * k) / steps).altitudeKm,
            );
            const b = barValue(
              f,
              flightPoseAt(f, (f.durationMs * (k + 1)) / steps).altitudeKm,
            );
            expect(b - a).toBeGreaterThan(floor);
          }
        }),
        { numRuns: 50 },
      );
    },
  );
});
