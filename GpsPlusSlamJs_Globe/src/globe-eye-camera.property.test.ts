/**
 * Why these properties matter: the near plane at eye height decides
 * whether the ground at the feet and a held item are drawn at all. Over
 * random clearances and item distances: it is positive and never below
 * its floor, never farther than the ground's share or the item's share
 * (unless the floor puts it there), so an item beyond twice the floor is
 * never clipped, and it never grows when the camera comes closer to the
 * ground or to an item. Invariants, not the formula restated (G1 review
 * L7): a wrong share or a wrong min/max fails one of them.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_EYE, eyeNearM } from "./globe-eye-camera.js";

const distance = fc.double({ min: 0, max: 100_000, noNaN: true });

describe("eyeNearM", () => {
  it("is positive, at least its floor, and within both shares", () => {
    fc.assert(
      fc.property(distance, distance, (clearance, item) => {
        const near = eyeNearM(clearance, item);
        const floor = GLOBE_EYE.minNearM;
        expect(near).toBeGreaterThan(0);
        expect(near).toBeGreaterThanOrEqual(floor);
        // Never farther than 0.3 x the clearance, nor half the item.
        expect(near).toBeLessThanOrEqual(Math.max(floor, 0.3 * clearance));
        expect(near).toBeLessThanOrEqual(Math.max(floor, 0.5 * item));
        // So an item beyond twice the floor is in front of the plane.
        expect(item <= 2 * floor || near < item).toBe(true);
      }),
    );
  });

  it("never grows as the ground or an item comes closer", () => {
    fc.assert(
      fc.property(distance, distance, distance, distance, (c1, c2, i1, i2) => {
        const [nearC, farC] = c1 <= c2 ? [c1, c2] : [c2, c1];
        const [nearI, farI] = i1 <= i2 ? [i1, i2] : [i2, i1];
        expect(eyeNearM(nearC, farI)).toBeLessThanOrEqual(eyeNearM(farC, farI));
        expect(eyeNearM(farC, nearI)).toBeLessThanOrEqual(eyeNearM(farC, farI));
      }),
    );
  });
});
