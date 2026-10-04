import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  ACCURACY_CEILING_M,
  BAND_ACCURACY_FACTOR,
  FOUND_ACCURACY_FACTOR,
  HUD_ARRIVAL_BAND_M,
  HUD_ARRIVAL_MIN_M,
  stationBands,
} from "./station-bands";

/**
 * Why these tests matter: the bands decide when a visitor has "found" a
 * station and when the HUD stops pointing at it. An authored radius below
 * what the phone's GPS can resolve would never fire for a visitor standing
 * on the spot (tour kit plan §6: "a found radius below about twice the
 * phone's accuracy flickers"), and a band without hysteresis toggles the
 * station's figure on and off while the visitor stands at the edge. The
 * numbers come from `station-bands.sweep.test.ts`; these tests pin the
 * rule's shape so a later tweak of a constant cannot break it silently.
 */

describe("stationBands", () => {
  it("keeps an authored found radius the GPS can resolve, and widens one it cannot", () => {
    // 10 m authored, 4 m accuracy: the creator's radius stands.
    expect(
      stationBands({ activateRadiusM: 30, foundRadiusM: 10 }, 4).foundM,
    ).toBe(10);
    // 3 m authored at 12 m accuracy: a visitor on the spot is often 10 m
    // "away"; the radius grows to the accuracy.
    expect(
      stationBands({ activateRadiusM: 30, foundRadiusM: 3 }, 12).foundM,
    ).toBe(12 * FOUND_ACCURACY_FACTOR);
  });

  it("is the HUD's arrival deadband: the arrow hides at foundM and comes back at foundExitM", () => {
    const b = stationBands({ activateRadiusM: 30, foundRadiusM: 10 }, 4);
    expect(b.foundExitM - b.foundM).toBe(4 * BAND_ACCURACY_FACTOR);
    // The field-validated HUD deadband (1.5 m / 3.0 m) is the floor of both.
    const tiny = stationBands({ activateRadiusM: 0.5, foundRadiusM: 0.2 }, 0.5);
    expect(tiny.foundM).toBe(HUD_ARRIVAL_MIN_M);
    expect(tiny.foundExitM - tiny.foundM).toBe(HUD_ARRIVAL_BAND_M);
  });

  it("activates no later than one band outside the found radius, and leaves one band further out", () => {
    // Authored 6 m activation inside a widened 12 m found radius: the
    // station activates before it is found, never after.
    const b = stationBands({ activateRadiusM: 6, foundRadiusM: 3 }, 12);
    expect(b.activateM).toBe(b.foundExitM);
    expect(b.activateExitM - b.activateM).toBe(b.foundExitM - b.foundM);
    // A generous authored activation radius stands.
    expect(
      stationBands({ activateRadiusM: 80, foundRadiusM: 3 }, 5).activateM,
    ).toBe(80);
  });

  it("treats a missing or nonsense accuracy as the ceiling, so a garbage reading never shrinks a radius", () => {
    for (const bad of [null, Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) {
      expect(
        stationBands({ activateRadiusM: 10, foundRadiusM: 3 }, bad).foundM,
      ).toBe(ACCURACY_CEILING_M * FOUND_ACCURACY_FACTOR);
    }
    // Above the ceiling it is clamped: a 500 m "fix" does not make every
    // station of the tour found at once.
    expect(
      stationBands({ activateRadiusM: 10, foundRadiusM: 3 }, 500).foundM,
    ).toBe(ACCURACY_CEILING_M * FOUND_ACCURACY_FACTOR);
  });

  it("orders the four distances for any radii and accuracy (property)", () => {
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
          expect(b.foundM).toBeGreaterThanOrEqual(found);
          expect(b.foundM).toBeGreaterThanOrEqual(HUD_ARRIVAL_MIN_M);
          expect(b.foundExitM).toBeGreaterThan(b.foundM);
          expect(b.activateM).toBeGreaterThanOrEqual(b.foundExitM);
          expect(b.activateM).toBeGreaterThanOrEqual(activate);
          expect(b.activateExitM).toBeGreaterThan(b.activateM);
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
          expect(b.foundM).toBeGreaterThanOrEqual(a.foundM);
          expect(b.activateExitM).toBeGreaterThanOrEqual(a.activateExitM);
        },
      ),
    );
  });
});
