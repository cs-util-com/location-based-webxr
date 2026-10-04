// WHY THESE TESTS MATTER. Synthetic Terrarium tiles are how the e2e suites
// feed KNOWN terrain to a page (OsmDemo's displaced ground, the terrain lab's
// ridge and flat checks). One step in the red byte is 256 m, so an encoder
// that is off by one carry does not fail loudly: it produces a smooth,
// plausible surface at the wrong height, and every assertion built on it
// measures the encoder instead of the page. So the round trip is checked
// through a real PNG decode (inflate + scanlines), not through the encoder's
// own arithmetic.

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { encodeRgbPng, terrariumPng, terrariumRgb } from './terrarium-png.mjs';

/** Terrarium's published decoding (tilezen/joerd formats.md), the oracle. */
const decode = ([r, g, b]) => r * 256 + g + b / 256 - 32768;

/** A minimal decoder for the encoder's own output: RGB8, filter 0 rows. */
function decodePng(png) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9]]).toEqual([8, 2]);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rows = [];
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    expect(raw[start]).toBe(0);
    rows.push(raw.subarray(start + 1, start + 1 + width * 3));
  }
  return { width, height, rows };
}

describe('terrariumRgb', () => {
  // Every value the lab and the demo feed: sea level, the demo's 40 m
  // corner, a fraction, a depth, the highest Appalachian peak, Everest.
  it.each([0, 40, 12.5, -432.25, 2037, 8848.75])('round-trips %s m exactly', (h) => {
    expect(decode(terrariumRgb(h))).toBe(h);
  });

  // The carry: 255/256 of a metre rounds into the next integer metre.
  it('carries a rounded fraction into the green and red bytes', () => {
    expect(terrariumRgb(-0.001)).toEqual([128, 0, 0]);
    expect(terrariumRgb(255.999)).toEqual([129, 0, 0]);
  });

  it('refuses a height the encoding cannot hold', () => {
    for (const bad of [Number.NaN, Infinity, -32769, 32768]) {
      expect(() => terrariumRgb(bad)).toThrow(RangeError);
    }
  });
});

describe('terrariumPng', () => {
  // The OsmDemo fixture's 2x2 tile: three posts at 0 m, one at 40 m. The
  // bytes are what its suite was measured on before the encoder moved here.
  it('encodes the OsmDemo 2x2 tile as the bytes it always had', () => {
    const png = terrariumPng(2, 2, (col, row) => (col === 1 && row === 1 ? 40 : 0));
    const { width, height, rows } = decodePng(png);
    expect([width, height]).toEqual([2, 2]);
    expect([...rows[0]]).toEqual([128, 0, 0, 128, 0, 0]);
    expect([...rows[1]]).toEqual([128, 0, 0, 128, 40, 0]);
    expect(png.toString('base64')).toBe(OSM_DEMO_TILE_BASE64);
  });

  it('places each height at its column and row', () => {
    const at = (col, row) => 100 * row + col - 50.5;
    const { rows } = decodePng(terrariumPng(5, 3, at));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const px = [...rows[row].subarray(col * 3, col * 3 + 3)];
        expect(decode(px)).toBe(at(col, row));
      }
    }
  });
});

describe('encodeRgbPng', () => {
  it('refuses pixel data of the wrong length', () => {
    expect(() => encodeRgbPng(2, 2, new Uint8Array(11))).toThrow(RangeError);
    expect(() => encodeRgbPng(0, 2, new Uint8Array(0))).toThrow(RangeError);
  });
});

/**
 * The OsmDemo fixture tile as its inline encoder wrote it (captured
 * 2026-09-27, before the move): a change here changes what that suite
 * measured.
 */
const OSM_DEMO_TILE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNoYGAAIhBu0GAAABBeAimSrkQhAAAAAElFTkSuQmCC';
