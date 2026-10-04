/**
 * The catalog's label rule (W5 plan 2026-09-26-0549, M1).
 *
 * Why this test matters: 130-170 labels at once are unreadable and cost a
 * DOM write each per frame; the rule keeps only the nearest K and fades
 * them with distance. A sort that is not stable makes labels flicker between
 * equally near spheres, and a fade with its ends swapped shows only the far
 * ones. Swept over K and the fade distances, not only the defaults.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LABEL_RULE, labelOpacities } from "./label-rule.js";

describe("labelOpacities", () => {
  it("shows the nearest K at full strength inside the near distance", () => {
    const o = labelOpacities([5, 50, 1, 3], {
      k: 2,
      fadeNearM: 10,
      fadeFarM: 20,
    });
    assert.deepEqual(o, [0, 0, 1, 1]);
  });

  it("fades linearly between near and far, and hides beyond far", () => {
    const o = labelOpacities([10, 15, 20, 25], {
      k: 4,
      fadeNearM: 10,
      fadeFarM: 20,
    });
    assert.deepEqual(o, [1, 0.5, 0, 0]);
  });

  // The owner's distances (round-3 plan 2026-09-27-0532 §2: "about twice
  // the distance"): full strength to 50 m, half at 95 m, gone at 140 m. The
  // old 25-70 m rule hid a label at 70 m.
  it("by default shows labels from twice the old distance", () => {
    assert.deepEqual(LABEL_RULE, { k: 16, fadeNearM: 50, fadeFarM: 140 });
    assert.deepEqual(labelOpacities([50, 95, 140, 141]), [1, 0.5, 0, 0]);
    assert.ok(labelOpacities([100])[0] > 0);
  });

  // Equal distances must not flicker from frame to frame: ties keep input order.
  it("breaks ties by index, the same every frame", () => {
    const o = labelOpacities([4, 4, 4], { k: 2, fadeNearM: 10, fadeFarM: 20 });
    assert.deepEqual(o, [1, 1, 0]);
  });

  it("hides non-finite distances and counts them out of K", () => {
    const o = labelOpacities([Number.NaN, 2, Infinity, 3], {
      k: 2,
      fadeNearM: 10,
      fadeFarM: 20,
    });
    assert.deepEqual(o, [0, 1, 0, 1]);
  });

  it("refuses a bad K or fade distances", () => {
    assert.throws(
      () => labelOpacities([1], { ...LABEL_RULE, k: -1 }),
      RangeError,
    );
    assert.throws(
      () => labelOpacities([1], { ...LABEL_RULE, k: 1.5 }),
      RangeError,
    );
    assert.throws(
      () => labelOpacities([1], { k: 1, fadeNearM: 20, fadeFarM: 20 }),
      RangeError,
    );
  });

  // The sweep rule: for any K and fades, at most K labels show, and a
  // nearer label is never fainter than a farther one.
  it("never shows more than K and never fades a nearer label more", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(random() * 60);
      const distances = Array.from({ length: n }, () => random() * 150);
      const k = Math.floor(random() * 30);
      const near = random() * 40;
      const far = near + 1 + random() * 80;
      const o = labelOpacities(distances, {
        k,
        fadeNearM: near,
        fadeFarM: far,
      });
      assert.ok(o.filter((x) => x > 0).length <= k);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (o[a] > 0 && o[b] > 0 && distances[a] < distances[b]) {
            assert.ok(o[a] >= o[b]);
          }
        }
      }
    }
  });
});
