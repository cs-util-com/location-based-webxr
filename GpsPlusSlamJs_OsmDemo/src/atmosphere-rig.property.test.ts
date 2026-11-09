/**
 * The night floor's ramp (r1155), for every elevation rather than a handful.
 *
 * WHY THIS TEST MATTERS: the floor must never light the day or the twilight
 * the DEC-R4-5 sweep approved, and must never flicker as the sun moves. So the
 * weight is in [0, 1], exactly 0 above the ramp, exactly 1 below it, and never
 * rises with the sun.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { NIGHT_FLOOR, nightFloorWeight } from "./atmosphere-rig.js";

const rad = (deg: number) => (deg * Math.PI) / 180;
const elevationDeg = fc.double({ min: -90, max: 90, noNaN: true });

describe("nightFloorWeight", () => {
  it("is in [0, 1], 0 above the ramp and 1 below it", () => {
    fc.assert(
      fc.property(elevationDeg, (deg) => {
        const w = nightFloorWeight(rad(deg));
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }),
    );
    // Off at and above the end of civil twilight, full at and below the end
    // of nautical twilight: no approved day or twilight look changes.
    fc.assert(
      fc.property(
        fc.double({ min: NIGHT_FLOOR.fromDeg, max: 90, noNaN: true }),
        (deg) => {
          expect(nightFloorWeight(rad(deg))).toBe(0);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: NIGHT_FLOOR.fullDeg, noNaN: true }),
        (deg) => {
          expect(nightFloorWeight(rad(deg))).toBe(1);
        },
      ),
    );
  });

  it("never rises as the sun rises", () => {
    fc.assert(
      fc.property(elevationDeg, elevationDeg, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(nightFloorWeight(rad(hi))).toBeLessThanOrEqual(
          nightFloorWeight(rad(lo)),
        );
      }),
    );
  });
});
