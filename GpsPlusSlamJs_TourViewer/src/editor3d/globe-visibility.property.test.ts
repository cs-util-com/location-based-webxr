/**
 * Why these tests matter: the two rules run every frame over every object
 * while the camera moves freely, so their promises must hold for any size,
 * distance and screen layout, not only the examples: an object never grows
 * on screen as the camera backs away, the hysteresis never flips an object
 * inside its band, and crowding treats both pins of a pair alike.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_VISIBILITY,
  crowdedPins,
  screenSizePx,
  sizeShown,
} from "./globe-visibility.js";

describe("the globe's visibility rules, for any input", () => {
  it("never grows an object on screen as the camera backs away", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 1, max: 170, noNaN: true }),
        (radiusM, a, b, fovYDeg) => {
          const [near, far] = a <= b ? [a, b] : [b, a];
          const view = { radiusM, fovYDeg, viewportHeightPx: 900 };
          expect(screenSizePx({ ...view, distanceM: far })).toBeLessThanOrEqual(
            screenSizePx({ ...view, distanceM: near }),
          );
        },
      ),
    );
  });

  // Why: inside the band [hide, hide x ratio) the state is whatever it was;
  // walking any sequence of sizes inside it never changes it.
  it("keeps an object's state for any walk of sizes inside its band", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 200, noNaN: true }),
        fc.boolean(),
        fc.array(fc.double({ min: 0, max: 0.999_999, noNaN: true }), {
          maxLength: 30,
        }),
        (hidePx, start, steps) => {
          let shown = start;
          for (const t of steps) {
            const size = hidePx * (1 + t * (GLOBE_VISIBILITY.showRatio - 1));
            shown = sizeShown(shown, size, hidePx);
          }
          expect(shown).toBe(start);
        },
      ),
    );
  });

  it("treats both pins of an isolated pair alike", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }),
        fc.boolean(),
        (crowdPx, gap, wasHidden) => {
          const pins = [
            { id: "bench", x: 10, y: 10 },
            { id: "fountain", x: 10 + gap, y: 10 },
          ];
          const was = new Set(wasHidden ? ["bench", "fountain"] : []);
          const hidden = crowdedPins(pins, crowdPx, was);
          expect(hidden.has("bench")).toBe(hidden.has("fountain"));
        },
      ),
    );
  });

  it("never hides the selected pin and returns only known ids", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.constantFrom("a", "b", "c", "d", "e", "f"),
            x: fc.double({ min: 0, max: 400, noNaN: true }),
            y: fc.double({ min: 0, max: 400, noNaN: true }),
          }),
          { selector: (p) => p.id, maxLength: 6 },
        ),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (pins, crowdPx) => {
          const selected = pins[0]?.id ?? null;
          const hidden = crowdedPins(pins, crowdPx, new Set(), selected);
          expect(selected !== null && hidden.has(selected)).toBe(false);
          for (const id of hidden) {
            expect(pins.some((p) => p.id === id)).toBe(true);
          }
        },
      ),
    );
  });
});
