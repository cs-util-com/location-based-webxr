import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  ACCURACY_CEILING_M,
  BAND_ACCURACY_FACTOR,
  HUD_ARRIVAL_BAND_M,
  stationBands,
} from "./station-bands";

/**
 * Why these tests matter: the bands decide when a visitor has "found" a
 * station and when the HUD stops pointing at it. Since D16 (tour editor
 * plan 2026-10-17-1816) a station is reached by the radius the tour gives
 * it and nothing else - an accuracy that widened it found a station 15 m
 * early beside a code that had just placed the visitor to a metre - while
 * the HUD keeps a hysteresis band so its arrow does not flicker at the
 * edge. These tests pin the rule's shape so a later tweak of a constant
 * cannot break it silently.
 */

describe("stationBands", () => {
  it("is the authored found radius at every accuracy, with no floor (D16)", () => {
    for (const accuracy of [null, 0.5, 4, 12, 24, 60, 500]) {
      expect(
        stationBands({ activateRadiusM: 30, foundRadiusM: 10 }, accuracy)
          .foundM,
      ).toBe(10);
      // A 2 m radius stays 2 m: the old 5 m pose floor is gone.
      expect(
        stationBands({ activateRadiusM: 30, foundRadiusM: 2 }, accuracy).foundM,
      ).toBe(2);
    }
  });

  it("is the HUD's arrival deadband: the arrow hides at foundM and comes back at foundExitM", () => {
    const b = stationBands({ activateRadiusM: 30, foundRadiusM: 10 }, 4);
    expect(b.foundExitM - b.foundM).toBe(4 * BAND_ACCURACY_FACTOR);
    // The band's floor is the HUD's field-validated deadband (1.5 m).
    const tiny = stationBands({ activateRadiusM: 0.5, foundRadiusM: 0.2 }, 0.5);
    expect(tiny.foundExitM - tiny.foundM).toBe(HUD_ARRIVAL_BAND_M);
  });

  it("puts the activation radius no closer than one band outside the found radius, and has no exit radius of its own (R10)", () => {
    // Authored 6 m activation inside a 5 m found radius at 12 m accuracy:
    // the prefetch that starts from it starts before the station is found.
    const b = stationBands({ activateRadiusM: 6, foundRadiusM: 5 }, 12);
    expect(b.activateM).toBe(b.foundExitM);
    // Nothing toggles on the activation radius any more (K4 review R10).
    expect(Object.keys(b).sort()).toEqual([
      "activateM",
      "foundExitM",
      "foundM",
    ]);
    // A generous authored activation radius stands.
    expect(
      stationBands({ activateRadiusM: 80, foundRadiusM: 3 }, 5).activateM,
    ).toBe(80);
  });

  it("treats a missing or nonsense accuracy as the ceiling for the band, so a garbage reading never shrinks it", () => {
    for (const bad of [null, Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      const b = stationBands({ activateRadiusM: 10, foundRadiusM: 3 }, bad);
      expect(b.foundExitM - b.foundM).toBe(ACCURACY_CEILING_M);
    }
    // Above the ceiling it is clamped: a 500 m "fix" keeps the band finite.
    const wide = stationBands({ activateRadiusM: 10, foundRadiusM: 3 }, 500);
    expect(wide.foundExitM - wide.foundM).toBe(ACCURACY_CEILING_M);
  });

  it("orders the three distances for any radii and accuracy (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.oneof(
          fc.constant(null),
          fc.double({ min: -10, max: 1000, noNaN: false }),
        ),
        (activate, foundShare, accuracy) => {
          const found = Math.max(0.01, activate * foundShare);
          const b = stationBands(
            { activateRadiusM: activate, foundRadiusM: found },
            accuracy,
          );
          expect(b.foundM).toBe(found);
          expect(b.foundExitM).toBeGreaterThan(b.foundM);
          expect(b.activateM).toBeGreaterThanOrEqual(b.foundExitM);
          expect(b.activateM).toBeGreaterThanOrEqual(activate);
          for (const v of Object.values(b))
            expect(Number.isFinite(v)).toBe(true);
        },
      ),
    );
  });

  it("never shrinks when the accuracy gets worse (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100, noNaN: true }),
        fc.double({ min: 0.5, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        (found, acc, worse) => {
          const a = stationBands(
            { activateRadiusM: found * 2, foundRadiusM: found },
            acc,
          );
          const b = stationBands(
            { activateRadiusM: found * 2, foundRadiusM: found },
            acc + worse,
          );
          expect(b.foundExitM).toBeGreaterThanOrEqual(a.foundExitM);
          expect(b.activateM).toBeGreaterThanOrEqual(a.activateM);
        },
      ),
    );
  });
});
