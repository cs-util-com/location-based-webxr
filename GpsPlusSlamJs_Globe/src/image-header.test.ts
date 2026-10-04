/**
 * Why this test matters: the fetch script checks every downloaded image by
 * its header alone (no image decoder, no new dependency). A GIBS error page
 * served with a 200, a truncated download or a wrong size must be refused
 * before it is committed as a tile, because on the globe it would show as a
 * silently wrong patch of Earth. Crafted buffers, not fixtures.
 */

import { describe, expect, it } from "vitest";

import { imageInfo } from "./image-header.js";

/** A minimal JPEG: SOI, an APP0 segment, then a SOF marker with a size. */
function jpeg(width: number, height: number, sof = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    sof,
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
}

/** A minimal PNG signature plus IHDR. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe("imageInfo", () => {
  it("reads a baseline JPEG's size after an APP segment", () => {
    expect(imageInfo(jpeg(256, 256))).toEqual({
      type: "jpeg",
      width: 256,
      height: 256,
    });
  });

  it("reads a progressive JPEG's size (SOF2)", () => {
    expect(imageInfo(jpeg(2048, 1024, 0xc2))).toEqual({
      type: "jpeg",
      width: 2048,
      height: 1024,
    });
  });

  it("reads a PNG's size from IHDR", () => {
    expect(imageInfo(png(2048, 1024))).toEqual({
      type: "png",
      width: 2048,
      height: 1024,
    });
  });

  // GIBS answers a bad request with an XML exception, sometimes with 200.
  it("refuses text, a truncated JPEG and an empty buffer", () => {
    expect(imageInfo(new TextEncoder().encode("<?xml version="))).toBeNull();
    expect(imageInfo(jpeg(256, 256).slice(0, 12))).toBeNull();
    expect(imageInfo(new Uint8Array())).toBeNull();
  });

  // DHT (0xC4) and DAC (0xCC) sit in the SOF range but are not frames.
  it("skips DHT and DAC segments instead of reading them as a size", () => {
    const withDht = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc4,
      0x00,
      0x04,
      0x12,
      0x34,
      ...jpeg(512, 256).slice(2),
    ]);
    expect(imageInfo(withDht)).toEqual({
      type: "jpeg",
      width: 512,
      height: 256,
    });
  });
});

/**
 * A minimal WebP: the RIFF header, then one chunk of the given kind with
 * the header fields its size and alpha live in (round-4 plan 2026-09-28-2105
 * DEC-GL4-3/6: the imagery tiles are WebP, the water mask in their alpha).
 */
function webp(
  kind: "VP8 " | "VP8L" | "VP8X",
  width: number,
  height: number,
  alpha = false,
): Uint8Array {
  const b = new Uint8Array(30);
  const view = new DataView(b.buffer);
  b.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 22, true);
  b.set(new TextEncoder().encode("WEBP"), 8);
  b.set(new TextEncoder().encode(kind), 12);
  view.setUint32(16, 10, true);
  if (kind === "VP8X") {
    b[20] = alpha ? 0x10 : 0;
    const w = width - 1;
    const h = height - 1;
    b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
    b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  } else if (kind === "VP8L") {
    b[20] = 0x2f;
    // 14 bits width-1, 14 bits height-1, 1 bit alpha, little-endian.
    const bits =
      ((width - 1) & 0x3fff) |
      (((height - 1) & 0x3fff) << 14) |
      ((alpha ? 1 : 0) << 28);
    view.setUint32(21, bits >>> 0, true);
  } else {
    b.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width & 0x3fff, true);
    view.setUint16(28, height & 0x3fff, true);
  }
  return b;
}

describe("imageInfo for WebP", () => {
  it("reads the size and alpha of an extended (VP8X) WebP", () => {
    expect(imageInfo(webp("VP8X", 256, 256, true))).toEqual({
      type: "webp",
      width: 256,
      height: 256,
      alpha: true,
    });
    expect(imageInfo(webp("VP8X", 2048, 1024))).toEqual({
      type: "webp",
      width: 2048,
      height: 1024,
      alpha: false,
    });
  });

  it("reads a lossless (VP8L) and a simple lossy (VP8) WebP", () => {
    expect(imageInfo(webp("VP8L", 300, 17, true))).toEqual({
      type: "webp",
      width: 300,
      height: 17,
      alpha: true,
    });
    expect(imageInfo(webp("VP8 ", 256, 256))).toEqual({
      type: "webp",
      width: 256,
      height: 256,
      alpha: false,
    });
  });

  // A tile without its alpha would read as all land: no glint anywhere.
  it("refuses a RIFF that is not WebP, a truncated one, and an unknown chunk", () => {
    const wave = webp("VP8X", 256, 256, true);
    wave.set(new TextEncoder().encode("WAVE"), 8);
    expect(imageInfo(wave)).toBeNull();
    expect(imageInfo(webp("VP8X", 256, 256, true).slice(0, 24))).toBeNull();
    const odd = webp("VP8X", 256, 256, true);
    odd.set(new TextEncoder().encode("ABCD"), 12);
    expect(imageInfo(odd)).toBeNull();
  });
});
