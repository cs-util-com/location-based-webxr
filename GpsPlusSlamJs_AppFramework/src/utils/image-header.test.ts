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

/**
 * A minimal WebP: the RIFF header, then one chunk of the given kind with
 * the header fields its size and alpha live in.
 */
function webp(
  kind: 'VP8 ' | 'VP8L' | 'VP8X',
  width: number,
  height: number,
  alpha = false
): Uint8Array {
  const b = new Uint8Array(30);
  const view = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, 22, true);
  b.set(new TextEncoder().encode('WEBP'), 8);
  b.set(new TextEncoder().encode(kind), 12);
  view.setUint32(16, 10, true);
  if (kind === 'VP8X') {
    b[20] = alpha ? 0x10 : 0;
    const w = width - 1;
    const h = height - 1;
    b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
    b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  } else if (kind === 'VP8L') {
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

/** A WebP whose first chunk is VP8X (the extended format). */
const webpVp8x = (width: number, height: number): Uint8Array =>
  webp('VP8X', width, height);

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
      alpha: false,
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

// Why: the Globe's fetch script refuses an imagery tile whose header
// says it has no alpha, because the tiles carry their water mask in it;
// a tile without it would read as all land on the globe.
describe('imageInfo for WebP', () => {
  it('reads the size and alpha of an extended (VP8X) WebP', () => {
    expect(imageInfo(webp('VP8X', 256, 256, true))).toEqual({
      type: 'webp',
      width: 256,
      height: 256,
      alpha: true,
    });
    expect(imageInfo(webp('VP8X', 2048, 1024))).toEqual({
      type: 'webp',
      width: 2048,
      height: 1024,
      alpha: false,
    });
  });

  it('reads a lossless (VP8L) and a simple lossy (VP8) WebP', () => {
    expect(imageInfo(webp('VP8L', 300, 17, true))).toEqual({
      type: 'webp',
      width: 300,
      height: 17,
      alpha: true,
    });
    expect(imageInfo(webp('VP8L', 300, 17))).toMatchObject({ alpha: false });
    expect(imageInfo(webp('VP8 ', 256, 256))).toEqual({
      type: 'webp',
      width: 256,
      height: 256,
      alpha: false,
    });
  });

  it('refuses a RIFF that is not WebP, a truncated one, an unknown chunk and a zero size', () => {
    const wave = webp('VP8X', 256, 256, true);
    wave.set(new TextEncoder().encode('WAVE'), 8);
    expect(imageInfo(wave)).toBeNull();
    expect(imageInfo(webp('VP8X', 256, 256, true).slice(0, 24))).toBeNull();
    const odd = webp('VP8X', 256, 256, true);
    odd.set(new TextEncoder().encode('ABCD'), 12);
    expect(imageInfo(odd)).toBeNull();
    expect(imageInfo(webp('VP8 ', 0, 256))).toBeNull();
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
