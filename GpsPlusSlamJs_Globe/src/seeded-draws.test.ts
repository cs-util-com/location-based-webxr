/**
 * Why these tests matter: the star field and the speed dust are drawn from
 * a seeded generator, and the same seed must keep giving the same sky and
 * the same dust. These pins hold the exact outputs, so swapping the
 * generator for another implementation (or changing its arithmetic) shows
 * up here rather than as a sky that quietly moved. The cloud bake's blue
 * noise is pinned the same way in `globe-cloud-bake.test.ts`.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createSpeedField } from "./globe-speed-dust.js";
import { generateStarField } from "./globe-stars.js";

const hash = (a: Float32Array) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex")
    .slice(0, 16);

describe("seeded outputs", () => {
  it("the speed dust's particle seeds are pinned for a seed", () => {
    expect(hash(createSpeedField(64, 1))).toBe("eff243229a33796a");
  });

  it("the star field is pinned for a seed", () => {
    const field = generateStarField({ seed: 1, magLimit: 4 });
    expect(hash(field.directions)).toBe("df94a41998bd4d7c");
    expect(hash(field.magnitudes)).toBe("b29e579fbf9e46f1");
  });
});
