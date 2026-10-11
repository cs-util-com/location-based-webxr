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
