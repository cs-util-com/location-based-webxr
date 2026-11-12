import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Object3D } from "three";

import { drawAtExtent, markPlaceScale } from "./place-scale.js";

// Why this test matters: whatever a drawing's scale and extent, a
// preview at any value scales every axis by exactly value / extent (so a
// picture keeps its aspect), and clearing it gives back the scale drawn
// bit for bit, however many previews came before.
describe("place scale (property)", () => {
  it("scales by value / extent on every axis, and null restores the drawn scale", () => {
    const positive = fc.double({ min: 1e-3, max: 1e3, noNaN: true });
    fc.assert(
      fc.property(
        fc.tuple(positive, positive, positive),
        positive,
        fc.array(positive, { minLength: 1, maxLength: 4 }),
        ([x, y, z], extent, values) => {
          const o = new Object3D();
          o.scale.set(x, y, z);
          markPlaceScale(o, extent);
          for (const value of values) {
            drawAtExtent(o, value);
            const f = value / extent;
            expect(o.scale.x).toBeCloseTo(x * f, 9);
            expect(o.scale.y / o.scale.x).toBeCloseTo(y / x, 9);
            expect(o.scale.z / o.scale.x).toBeCloseTo(z / x, 9);
          }
          drawAtExtent(o, null);
          expect(o.scale.toArray()).toEqual([x, y, z]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
