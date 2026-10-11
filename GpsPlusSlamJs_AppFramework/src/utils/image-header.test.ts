/**
 * Why these tests matter (tour kit K4 review R2): the tour kit refuses or
 * scales a picture by the size its HEADER states, before any decode, so a
 * crafted file cannot make a phone allocate gigabytes. A reader that
 * misreads a size, accepts a truncated header, or throws on garbage would
 * let such a file through or break every tour. Crafted buffers, not
 * fixtures; the JPEG and PNG builders follow the Globe's reader tests.
 */

import { describe, expect, it } from 'vitest';

import { imageInfo, imageInfoOfBlob } from './image-header';

/** A minimal JPEG: SOI, an APP0 segment, then a SOF marker with a size. */
function jpeg(
  width: number,
  height: number,
  sof = 0xc0
): Uint8Array<ArrayBuffer> {
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
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** A WebP whose first chunk is VP8X (the extended format). */
function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0
  );
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8
  );
  b.set(
    [...'VP8X'].map((c) => c.charCodeAt(0)),
    12
  );
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return b;
}

/** A GIF header with its logical screen size. */
function gif(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(13);
  b.set(
    [...'GIF89a'].map((c) => c.charCodeAt(0)),
    0
  );
  b.set([width & 0xff, width >> 8, height & 0xff, height >> 8], 6);
  return b;
}

/** An ISO-BMFF box. */
function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4
  );
  out.set(body, 8);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** An `ispe` FullBox: version and flags, then width and height. */
function ispe(width: number, height: number): Uint8Array {
  const body = new Uint8Array(12);
  new DataView(body.buffer).setUint32(4, width);
  new DataView(body.buffer).setUint32(8, height);
  return box('ispe', body);
}

/** A minimal AVIF: ftyp, then meta > iprp > ipco with the given sizes. */
function avif(
  sizes: readonly (readonly [number, number])[],
  brand = 'avif'
): Uint8Array {
  const ftyp = box(
    'ftyp',
    new Uint8Array([...`${brand}\0\0\0\0mif1`].map((c) => c.charCodeAt(0)))
  );
  const ipco = box('ipco', concat(...sizes.map(([w, h]) => ispe(w, h))));
  const meta = box('meta', concat(new Uint8Array(4), box('iprp', ipco)));
  return concat(ftyp, meta);
}

describe('imageInfo', () => {
  it('reads a JPEG frame size, baseline or progressive', () => {
    expect(imageInfo(jpeg(4032, 3024))).toEqual({
      type: 'jpeg',
      width: 4032,
      height: 3024,
    });
    expect(imageInfo(jpeg(2048, 1024, 0xc2))).toEqual({
      type: 'jpeg',
      width: 2048,
      height: 1024,
    });
  });

  it('reads a PNG, a WebP, a GIF and an AVIF size', () => {
    expect(imageInfo(png(300, 600))).toEqual({
      type: 'png',
      width: 300,
      height: 600,
    });
    expect(imageInfo(webpVp8x(8192, 6144))).toEqual({
      type: 'webp',
      width: 8192,
      height: 6144,
    });
    expect(imageInfo(gif(640, 480))).toEqual({
      type: 'gif',
      width: 640,
      height: 480,
    });
    expect(imageInfo(avif([[1920, 1080]]))).toEqual({
      type: 'avif',
      width: 1920,
      height: 1080,
    });
  });

  it("takes an AVIF grid's largest item, so its tiles cannot hide its size", () => {
    expect(
      imageInfo(
        avif([
          [512, 512],
          [8192, 8192],
          [512, 512],
        ])
      )
    ).toMatchObject({ width: 8192, height: 8192 });
    // An HEIF that is not AVIF is not read as one.
    expect(imageInfo(avif([[64, 64]], 'heic'))).toBeNull();
  });

  it('refuses a truncated header, a zero size and what is not an image', () => {
    expect(imageInfo(jpeg(256, 256).slice(0, 12))).toBeNull();
    expect(imageInfo(png(300, 600).slice(0, 20))).toBeNull();
    expect(imageInfo(gif(0, 10))).toBeNull();
    expect(imageInfo(avif([]))).toBeNull();
    expect(imageInfo(new TextEncoder().encode('<svg xmlns="x"/>'))).toBeNull();
    expect(imageInfo(new Uint8Array())).toBeNull();
  });
});

describe('imageInfoOfBlob', () => {
  // Why (R2): the header is read from the Blob a tour entry arrives as,
  // without reading a large image whole; a header past the probe is
  // "unknown", never guessed.
  it('reads the header from the first bytes of a Blob only', async () => {
    const big = new Blob([png(300, 600), new Uint8Array(4 * 1024 * 1024)]);
    expect(await imageInfoOfBlob(big)).toEqual({
      type: 'png',
      width: 300,
      height: 600,
    });
    const late = new Blob([
      new Uint8Array([0xff, 0xd8]),
      // An APP segment chain longer than the probe before the frame.
      ...Array.from({ length: 4 }, () => {
        const seg = new Uint8Array(65_535 + 2);
        seg.set([0xff, 0xe1, 0xff, 0xff]);
        return seg;
      }),
      jpeg(10, 10).subarray(2),
    ]);
    expect(await imageInfoOfBlob(late, 64 * 1024)).toBeNull();
    expect(await imageInfoOfBlob(late)).toEqual({
      type: 'jpeg',
      width: 10,
      height: 10,
    });
  });
});
