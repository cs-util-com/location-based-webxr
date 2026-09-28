/**
 * Synthetic Terrarium elevation tiles for e2e suites: known heights, written
 * as real PNG bytes, so a page under test runs its whole tile path (fetch,
 * decode, sample) against terrain whose answer is known.
 *
 * ONE ENCODER FOR THE WORKSPACE (DEC-H3, 2026-08-24). OsmDemo's suite and
 * the design system's terrain lab both need it, and it carries a contract:
 * Terrarium's fixed-point layout, where one step in the red byte is 256 m.
 * Two copies of that would be two chances to be off by one carry, which
 * shows as a smooth plausible surface at the wrong height rather than as an
 * error.
 *
 * Node only (zlib), test-side only: production decodes tiles, it never
 * encodes them.
 *
 * @see terrarium-png.mjs.md
 */
import { deflateSync } from 'node:zlib';

/** The Terrarium offset: `h = R*256 + G + B/256 - 32768` (tilezen/joerd). */
const OFFSET_M = 32768;

/**
 * The [R, G, B] bytes of one height, rounded to Terrarium's 1/256 m step.
 * Throws a RangeError for a height the encoding cannot hold.
 *
 * @param {number} heightM
 * @returns {[number, number, number]}
 */
export function terrariumRgb(heightM) {
  if (!Number.isFinite(heightM) || heightM < -OFFSET_M || heightM >= OFFSET_M) {
    throw new RangeError(`Terrarium cannot encode ${heightM} m`);
  }
  // Integer 1/256-metre units, so the fraction's rounding carries into G and
  // R instead of overflowing B.
  const q = Math.min(2 ** 24 - 1, Math.round((heightM + OFFSET_M) * 256));
  return [Math.floor(q / 65536), Math.floor(q / 256) % 256, q % 256];
}

/**
 * A truecolour 8-bit PNG (no filter, one IDAT) from RGB bytes, row-major
 * from the top-left.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array | number[]} rgb  `width * height * 3` bytes
 * @returns {Buffer}
 */
export function encodeRgbPng(width, height, rgb) {
  if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
    throw new RangeError(`PNG size must be positive integers, got ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new RangeError(`expected ${width * height * 3} RGB bytes, got ${rgb.length}`);
  }
  // Raw scanlines: one filter byte (0 = none) then the row's RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3);
    raw[start] = 0;
    for (let i = 0; i < width * 3; i++) raw[start + 1 + i] = rgb[y * width * 3 + i];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A Terrarium tile whose pixel (col, row) holds `heightAt(col, row)` metres.
 *
 * @param {number} width
 * @param {number} height
 * @param {(col: number, row: number) => number} heightAt
 * @returns {Buffer}
 */
export function terrariumPng(width, height, heightAt) {
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      rgb.set(terrariumRgb(heightAt(col, row)), (row * width + col) * 3);
    }
  }
  return encodeRgbPng(width, height, rgb);
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** CRC-32, as PNG specifies it. */
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc;
}
