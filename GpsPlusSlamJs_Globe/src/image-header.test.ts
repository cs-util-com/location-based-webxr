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
