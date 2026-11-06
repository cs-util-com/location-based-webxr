import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  bakeCloudTextures,
  cloudDetailMean,
  cloudLifeGain,
} from "./globe-cloud-bake.js";

const hash = (a: Uint8Array) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex")
    .slice(0, 16);

describe("bakeCloudTextures", () => {
  const bakes = bakeCloudTextures();

  // Why this test matters: the accepted look is the check page's. These
  // digests were taken from the page's own bake functions, so a slip in the
  // port (a seed, a rounding, an axis) changes the clouds' shape and fails
  // here rather than as a vague difference in a screenshot.
  it("is byte for byte the check page's bake", () => {
    expect(hash(bakes.shape)).toBe("1ac54cce499c4dbd");
    expect(hash(bakes.detail)).toBe("2b6e49c0b6a06e89");
    expect(hash(bakes.domes)).toBe("5dbe367688ddd45f");
    expect(hash(bakes.region)).toBe("6061d915e494566a");
    expect(hash(bakes.blue)).toBe("8ac8761b07c8893a");
  });

  // Why this test matters: both numbers go into the shader; the gain sets
  // how much cloud the life cycle keeps and the mean what a far sample
  // takes in place of the erosion.
  it("measures the life gain and the erosion's mean as the page does", () => {
    expect(bakes.lifeGain).toBeCloseTo(0.82780236073842, 12);
    expect(bakes.detailMean).toBeCloseTo(0.5059861127068018, 12);
  });

  it("has the sizes the textures are made with", () => {
    expect(bakes.shape.length).toBe(64 ** 3);
    expect(bakes.detail.length).toBe(32 ** 3);
    expect(bakes.domes.length).toBe(512 * 512 * 4);
    expect(bakes.region.length).toBe(512 * 512 * 4);
    expect(bakes.blue.length).toBe(64 * 64);
  });

  // Why this test matters: a worker hands these buffers over by transfer,
  // which needs each to own its whole buffer; a view into a shared one
  // would detach the others.
  it("gives each texture a buffer of its own", () => {
    const { shape, detail, domes, region, blue } = bakes;
    const buffers = [shape, detail, domes, region, blue].map((a) => a.buffer);
    expect(new Set(buffers).size).toBe(5);
    expect(shape.byteLength).toBe(shape.buffer.byteLength);
  });
});

describe("cloudDetailMean", () => {
  // Why this test matters: an empty texture must not give NaN to a uniform.
  it("is 0 for no data", () => {
    expect(cloudDetailMean(new Uint8Array(0))).toBe(0);
  });

  it("stays in 0..1 for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) => {
        const mean = cloudDetailMean(bytes);
        expect(mean).toBeGreaterThanOrEqual(0);
        expect(mean).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("cloudLifeGain", () => {
  it("refuses a tile that does not match its size", () => {
    expect(() => cloudLifeGain(new Uint8Array(4), 2)).toThrow(RangeError);
  });

  // Why this test matters: the gain is clamped so a degenerate tile cannot
  // blow the coverage up or wipe it out.
  it("stays within its clamp for any tile", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 64, maxLength: 64 }), (bytes) => {
        const gain = cloudLifeGain(bytes, 4);
        expect(gain).toBeGreaterThanOrEqual(0.3);
        expect(gain).toBeLessThanOrEqual(2);
      }),
    );
  });
});
