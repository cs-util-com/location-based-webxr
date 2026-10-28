/**
 * Why these properties matter: a visitor may pinch a toy any number of
 * times, in any order, on a model of any size - the limits must hold for
 * every sequence, not only the examples: never below 0.1x, never above
 * 3x, never a largest side beyond 50 m. A drag must be a pure rotation of
 * the finger's span, so the toy keeps under the finger whichever way the
 * visitor faces.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  pinchedToyFactor,
  TOY_MAX_FACTOR,
  TOY_MAX_SIZE_M,
  TOY_MIN_FACTOR,
  toyDragMetres,
  toyStartFactor,
} from "./model-gestures.js";

const size = fc.double({ min: 0.01, max: 500, noNaN: true });
const distancePx = fc.double({ min: 1, max: 4000, noNaN: true });

describe("the toy's limits (properties)", () => {
  it("any sequence of pinches keeps the factor within 0.1x-3x and the size within 50 m", () => {
    fc.assert(
      fc.property(
        size,
        fc.array(fc.tuple(distancePx, distancePx), { maxLength: 30 }),
        (sizeM, pinches) => {
          let factor = toyStartFactor(sizeM);
          for (const [from, to] of pinches) {
            factor = pinchedToyFactor(factor, from, to, sizeM);
            expect(factor).toBeGreaterThanOrEqual(TOY_MIN_FACTOR);
            expect(factor).toBeLessThanOrEqual(TOY_MAX_FACTOR);
            // Within 50 m, unless the 0.1x floor is already above it.
            expect(factor * sizeM).toBeLessThanOrEqual(
              Math.max(TOY_MAX_SIZE_M, TOY_MIN_FACTOR * sizeM) * (1 + 1e-12),
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("a drag moves the toy by the finger's span at its distance, in any heading", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        fc.double({ min: 0.2, max: 2.5, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (dxPx, dyPx, distanceM, fovYRad, yawRad) => {
          const heightPx = 800;
          const [dx, dz] = toyDragMetres({
            dxPx,
            dyPx,
            heightPx,
            distanceM,
            fovYRad,
            yawRad,
          });
          const span =
            (Math.hypot(dxPx, dyPx) * 2 * distanceM * Math.tan(fovYRad / 2)) /
            heightPx;
          expect(Math.hypot(dx, dz)).toBeCloseTo(span, 6);
        },
      ),
      { numRuns: 300 },
    );
  });
});
