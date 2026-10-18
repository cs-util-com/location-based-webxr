/**
 * Why these properties matter: the near plane at eye height decides
 * whether the ground at the feet and a held item are drawn at all. Over
 * random clearances and item distances: it is never below its floor,
 * never in front of the ground's share or the item's share (unless the
 * floor puts it there), and never grows when the camera comes closer to
 * the ground or to an item.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_EYE, eyeNearM } from "./globe-eye-camera.js";

const distance = fc.double({ min: 0, max: 100_000, noNaN: true });

describe("eyeNearM", () => {
  it("stays at its floor or within both shares", () => {
    fc.assert(
      fc.property(distance, distance, (clearance, item) => {
        const near = eyeNearM(clearance, item);
        expect(near).toBeGreaterThanOrEqual(GLOBE_EYE.minNearM);
        const limit = Math.min(
          GLOBE_EYE.nearFraction * clearance,
          GLOBE_EYE.itemShare * item,
        );
        expect(near).toBe(Math.max(GLOBE_EYE.minNearM, limit));
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
