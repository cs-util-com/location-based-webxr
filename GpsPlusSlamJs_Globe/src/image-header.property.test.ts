/**
 * Why this test matters: the header parser must read any size the fetch
 * could meet (every 16-bit JPEG dimension, PNG up to 2^31) and must never
 * read past a truncated buffer or accept random bytes as an image.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { imageInfo } from "./image-header.js";

const dim = fc.integer({ min: 1, max: 0xffff });

describe("imageInfo for any size and any bytes", () => {
  it("reads back every JPEG size it is given", () => {
    fc.assert(
      fc.property(dim, dim, (width, height) => {
        const b = new Uint8Array([
          0xff,
          0xd8,
          0xff,
          0xc0,
          0x00,
          0x0b,
          0x08,
          height >> 8,
          height & 0xff,
          width >> 8,
          width & 0xff,
          0x01,
          0x01,
          0x11,
          0x00,
        ]);
        expect(imageInfo(b)).toEqual({ type: "jpeg", width, height });
      }),
    );
  });

  it("never throws, and refuses what does not start like an image", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const info = imageInfo(bytes);
        const looksLikeImage =
          (bytes[0] === 0xff && bytes[1] === 0xd8) ||
          (bytes[0] === 0x89 && bytes[1] === 0x50);
        expect(info === null || looksLikeImage).toBe(true);
      }),
    );
  });
});
