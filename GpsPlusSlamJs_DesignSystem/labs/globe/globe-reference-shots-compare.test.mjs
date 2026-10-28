/**
 * Tests for the reference-view comparison's pixel difference.
 *
 * Why this file matters: a refactor that must leave the globe looking the
 * same is judged by these numbers, so a difference that the counting
 * missed (a channel skipped, an off-by-one in the threshold) would pass a
 * visible change as identical.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { diffRgba } from "./globe-reference-shots-compare.mjs";

const rgba = (...pixels) => new Uint8Array(pixels.flat());

describe("diffRgba", () => {
  it("reads two equal images as no difference at all", () => {
    const a = rgba([10, 20, 30, 255], [0, 0, 0, 255]);
    const d = diffRgba(a, a.slice());
    assert.equal(d.max, 0);
    assert.deepEqual(Object.values(d.shares), [0, 0, 0, 0]);
  });

  it("counts a pixel by its largest channel, in every colour channel", () => {
    for (const channel of [0, 1, 2]) {
      const a = rgba([100, 100, 100, 255], [0, 0, 0, 255]);
      const b = a.slice();
      b[channel] += 5;
      const d = diffRgba(a, b);
      assert.equal(d.max, 5);
      // Over 1 and over 4: one pixel in two; not over 16.
      assert.equal(d.shares[">1"], 0.5);
      assert.equal(d.shares[">4"], 0.5);
      assert.equal(d.shares[">16"], 0);
    }
  });

  it("ignores alpha and counts strictly above a threshold", () => {
    const a = rgba([0, 0, 0, 255]);
    const d1 = diffRgba(a, rgba([0, 0, 0, 0]));
    assert.equal(d1.max, 0);
    const d4 = diffRgba(a, rgba([4, 0, 0, 255]));
    assert.equal(d4.shares[">1"], 1);
    assert.equal(d4.shares[">4"], 0);
  });

  it("draws the difference amplified, opaque", () => {
    const d = diffRgba(rgba([0, 0, 0, 255]), rgba([3, 0, 0, 255]), {
      gain: 10,
    });
    assert.deepEqual([...d.image], [30, 30, 30, 255]);
  });

  it("refuses buffers of different sizes", () => {
    assert.throws(() => diffRgba(rgba([0, 0, 0, 0]), new Uint8Array(8)));
  });
});
