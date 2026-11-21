/**
 * Why these properties matter (tour kit K4 review R2): the pixel cap is
 * only as good as the header reader - it must read back every size a tour
 * could carry, and must never throw on, or read a size out of, bytes that
 * do not start like an image (a crafted entry is exactly that).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { imageInfo } from './image-header';

const dim16 = fc.integer({ min: 1, max: 0xffff });

describe('imageInfo for any size and any bytes', () => {
  it('reads back every JPEG, GIF and PNG size it is given', () => {
    fc.assert(
      fc.property(dim16, dim16, (width, height) => {
        const jpeg = new Uint8Array([
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
        expect(imageInfo(jpeg)).toEqual({ type: 'jpeg', width, height });
        const gif = new Uint8Array(13);
        gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
        gif.set([width & 0xff, width >> 8, height & 0xff, height >> 8], 6);
        expect(imageInfo(gif)).toEqual({ type: 'gif', width, height });
        const png = new Uint8Array(24);
        png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        new DataView(png.buffer).setUint32(16, width * 3);
        new DataView(png.buffer).setUint32(20, height * 5);
        expect(imageInfo(png)).toEqual({
          type: 'png',
          width: width * 3,
          height: height * 5,
        });
      })
    );
  });

  // The extended WebP header holds 24-bit sizes (width - 1) and the
  // lossless one 14-bit sizes and an alpha bit: every size, with or
  // without alpha, must read back (the Globe's imagery tiles carry their
  // water mask in their alpha). The other VP8X flags (ICC, EXIF, XMP,
  // animation) are drawn too: a tile written with metadata sets them, and
  // only the alpha bit may read as alpha.
  it('reads back every extended and lossless WebP size and its alpha', () => {
    const size24 = fc.integer({ min: 1, max: 2 ** 24 });
    const size14 = fc.integer({ min: 1, max: 2 ** 14 });
    const riff = (kind: string): Uint8Array => {
      const b = new Uint8Array(30);
      b.set(new TextEncoder().encode('RIFF'), 0);
      b.set(new TextEncoder().encode(`WEBP${kind}`), 8);
      return b;
    };
    fc.assert(
      fc.property(
        size24,
        size24,
        fc.boolean(),
        fc.integer({ min: 0, max: 0xff }),
        (width, height, alpha, otherFlags) => {
          const b = riff('VP8X');
          b[20] = (otherFlags & ~0x10) | (alpha ? 0x10 : 0);
          const w = width - 1;
          const h = height - 1;
          b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
          b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
          expect(imageInfo(b)).toEqual({ type: 'webp', width, height, alpha });
        }
      )
    );
    fc.assert(
      fc.property(size14, size14, fc.boolean(), (width, height, alpha) => {
        const b = riff('VP8L');
        b[20] = 0x2f;
        const bits =
          (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28);
        new DataView(b.buffer).setUint32(21, bits >>> 0, true);
        expect(imageInfo(b)).toEqual({ type: 'webp', width, height, alpha });
      })
    );
  });

  it('never throws, and reads no size from bytes that do not start like an image', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 96 }), (bytes) => {
        const info = imageInfo(bytes);
        const text = String.fromCharCode(...bytes.subarray(0, 12));
        const looksLikeImage =
          (bytes[0] === 0xff && bytes[1] === 0xd8) ||
          bytes[0] === 0x89 ||
          text.startsWith('RIFF') ||
          text.startsWith('GIF') ||
          text.slice(4, 8) === 'ftyp';
        expect(info === null || looksLikeImage).toBe(true);
        expect(info === null || (info.width > 0 && info.height > 0)).toBe(true);
      }),
      { numRuns: 2000 }
    );
  });
});
