import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  checkGlbInert,
  checkImageWithinCap,
  TOUR_MAX_IMAGE_PIXELS,
  TOUR_MEDIA_EXTENSIONS,
  tourMediaTypeOf,
  tourMediaTypeOfEntry,
} from './tour-media.js';

/**
 * Why these tests matter (tour kit plan K0, review finding D12): a tour
 * opens from any link on the origin that will hold a creator's signing
 * key, so its content must stay inert. The allowlist is the one place that
 * decides what a tour may carry; these tests pin that it never admits a
 * type the browser could run as code (SVG, HTML, XML, script), that the
 * raster image set matches the viewer's gallery, and that a `.glb` cannot
 * reach outside itself or pull in a decoder.
 */

describe('the media allowlist', () => {
  it('admits raster images, .glb models, and browser-decoded audio and video', () => {
    expect(tourMediaTypeOf('jpg')).toEqual({
      kind: 'image',
      mime: 'image/jpeg',
    });
    expect(tourMediaTypeOf('avif')?.kind).toBe('image');
    expect(tourMediaTypeOf('glb')).toEqual({
      kind: 'model',
      mime: 'model/gltf-binary',
    });
    expect(tourMediaTypeOf('mp3')?.kind).toBe('audio');
    expect(tourMediaTypeOf('mp4')?.kind).toBe('video');
  });

  it('never admits a type that can carry script or markup', () => {
    for (const ext of [
      'svg',
      'svgz',
      'html',
      'htm',
      'xhtml',
      'xml',
      'js',
      'mjs',
      'gltf',
      'pdf',
      'exe',
    ]) {
      expect(tourMediaTypeOf(ext), ext).toBeNull();
    }
    for (const ext of TOUR_MEDIA_EXTENSIONS) {
      const mime = tourMediaTypeOf(ext)!.mime;
      expect(mime, ext).toMatch(/^(image|audio|video|model)\//);
      expect(mime, ext).not.toMatch(/svg|html|xml|script/);
    }
  });

  it('matches exact lower-case extensions only (no guessing)', () => {
    expect(tourMediaTypeOf('JPG')).toBeNull();
    expect(tourMediaTypeOf('.jpg')).toBeNull();
    expect(tourMediaTypeOf('constructor')).toBeNull();
    expect(tourMediaTypeOf('__proto__')).toBeNull();
    expect(tourMediaTypeOf(undefined as unknown as string)).toBeNull();
  });

  it('reads an entry name by its last extension, case folded', () => {
    expect(tourMediaTypeOfEntry('frames/frame-000001.JPG')?.mime).toBe(
      'image/jpeg'
    );
    expect(tourMediaTypeOfEntry('content/a.svg')).toBeNull();
    expect(tourMediaTypeOfEntry('a.jpg/readme')).toBeNull();
    expect(tourMediaTypeOfEntry('noextension')).toBeNull();
  });

  it('never throws and only ever returns an allowlisted type (property)', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const type = tourMediaTypeOfEntry(name);
        expect(
          type === null ||
            TOUR_MEDIA_EXTENSIONS.some((e) => tourMediaTypeOf(e) === type)
        ).toBe(true);
      })
    );
  });
});

/** A minimal glTF 2.0 binary around `json` (padded JSON chunk only). */
function glb(json: unknown, version = 2): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, version, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

describe('checkGlbInert', () => {
  it('accepts a self-contained model (binary chunk or data: URIs)', () => {
    expect(
      checkGlbInert(
        glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] })
      )
    ).toEqual({ ok: true });
    expect(
      checkGlbInert(
        glb({
          asset: { version: '2.0' },
          // A data: URI image is measured too (K4 review R2): a real header.
          images: [{ uri: dataUri(pngHeader(4, 4)) }],
        })
      )
    ).toEqual({ ok: true });
  });

  it('refuses a buffer or image that points outside the file', () => {
    for (const uri of [
      'https://cdn.example/model.bin',
      'model.bin',
      '//x/y.png',
    ]) {
      expect(
        checkGlbInert(glb({ asset: { version: '2.0' }, buffers: [{ uri }] }))
          .ok,
        uri
      ).toBe(false);
      expect(
        checkGlbInert(glb({ asset: { version: '2.0' }, images: [{ uri }] })).ok,
        uri
      ).toBe(false);
    }
  });

  it('refuses a model that needs a decoder from outside', () => {
    const check = checkGlbInert(
      glb({
        asset: { version: '2.0' },
        extensionsUsed: ['KHR_draco_mesh_compression'],
      })
    );
    expect(check).toEqual({
      ok: false,
      reason: 'it needs a decoder (KHR_draco_mesh_compression)',
    });
  });

  it('refuses what is not a glTF 2.0 binary', () => {
    expect(checkGlbInert(new Uint8Array(4)).ok).toBe(false);
    expect(checkGlbInert(glb({ asset: {} }, 1)).ok).toBe(false);
    const truncated = glb({ asset: { version: '2.0' } }).slice(0, 24);
    expect(checkGlbInert(truncated).ok).toBe(false);
    expect(checkGlbInert(glb([1, 2])).ok).toBe(false);
  });

  it('never throws on arbitrary bytes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(typeof checkGlbInert(bytes).ok).toBe('boolean');
      })
    );
  });
});

/** `base` with `chunks` appended (type, payload), the header length
 *  updated to the new size unless `headerLength` overrides it. */
function withChunks(
  base: Uint8Array,
  chunks: readonly { type: number; data: Uint8Array }[],
  headerLength?: number
): Uint8Array {
  const total =
    base.length + chunks.reduce((sum, c) => sum + 8 + c.data.length, 0);
  const out = new Uint8Array(total);
  out.set(base, 0);
  const view = new DataView(out.buffer);
  let at = base.length;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.data.length, true);
    view.setUint32(at + 4, chunk.type, true);
    out.set(chunk.data, at + 8);
    at += 8 + chunk.data.length;
  }
  view.setUint32(8, headerLength ?? total, true);
  return out;
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const SAFE = { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] };

/**
 * Why these tests matter (K0 milestone review R8): three.js's glTF loader
 * walks EVERY chunk of a .glb and takes a later JSON chunk over the first.
 * A check that read only the first chunk passed a model whose second JSON
 * chunk points at an http URL - the page would then fetch it. The check
 * now requires exactly the shape the format allows: one JSON chunk, an
 * optional binary chunk, then the end, with the header's length equal to
 * the data's.
 */
describe('checkGlbInert - the chunk structure', () => {
  it('accepts a JSON chunk followed by one binary chunk', () => {
    const model = withChunks(glb(SAFE), [
      { type: BIN_CHUNK, data: new Uint8Array(4) },
    ]);
    expect(checkGlbInert(model)).toEqual({ ok: true });
  });

  it('refuses a second JSON chunk that points outside the file', () => {
    const evil = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'http://evil.example/x.bin' }],
      }).padEnd(64, ' ')
    );
    const model = withChunks(glb(SAFE), [{ type: JSON_CHUNK, data: evil }]);
    expect(checkGlbInert(model).ok).toBe(false);
  });

  it('refuses any chunk after the binary chunk', () => {
    const model = withChunks(glb(SAFE), [
      { type: BIN_CHUNK, data: new Uint8Array(4) },
      { type: BIN_CHUNK, data: new Uint8Array(4) },
    ]);
    expect(checkGlbInert(model).ok).toBe(false);
  });

  it('refuses a header length that is not the data length', () => {
    const model = glb(SAFE);
    expect(checkGlbInert(withChunks(model, [], model.length - 4)).ok).toBe(
      false
    );
    const trailing = new Uint8Array(model.length + 8);
    trailing.set(model, 0);
    expect(checkGlbInert(trailing).ok).toBe(false);
  });

  it('refuses a binary chunk that runs past the end', () => {
    const model = withChunks(glb(SAFE), [
      { type: BIN_CHUNK, data: new Uint8Array(4) },
    ]);
    new DataView(model.buffer).setUint32(model.length - 12, 400, true);
    expect(checkGlbInert(model).ok).toBe(false);
  });
});

/** A PNG signature plus IHDR stating `width` x `height` (no pixels). */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** A model whose one image lives in its binary chunk. */
function texturedGlb(image: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(image.length / 4) * 4);
  padded.set(image);
  return withChunks(
    glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: padded.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
    }),
    [{ type: BIN_CHUNK, data: padded }]
  );
}

const dataUri = (bytes: Uint8Array): string =>
  `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;

/**
 * Why these tests matter (tour kit K4 review R2): a picture, a figure or a
 * model's texture is decoded at the size its file states, so a few
 * kilobytes of crafted header can make a phone allocate gigabytes. Every
 * raster image a tour carries is measured from its header before any
 * decode, against one pixel cap, and a model's embedded images too.
 */
describe('the pixel cap (R2)', () => {
  it('is 4096 x 4096: a 12 MP phone photo and a 4096 px texture pass, a 48 MP photo and an 8192 px texture do not', () => {
    expect(TOUR_MAX_IMAGE_PIXELS).toBe(4096 * 4096);
    expect(checkImageWithinCap(pngHeader(4032, 3024))).toEqual({ ok: true });
    expect(checkImageWithinCap(pngHeader(4096, 4096))).toEqual({ ok: true });
    const big = checkImageWithinCap(pngHeader(8064, 6048));
    expect(big.ok).toBe(false);
    expect(big.ok ? '' : big.reason).toMatch(/8064 x 6048/);
    expect(checkImageWithinCap(pngHeader(8192, 8192)).ok).toBe(false);
  });

  it('refuses an image whose size cannot be read, and takes another cap when given one', () => {
    const unreadable = checkImageWithinCap(new Uint8Array([1, 2, 3, 4]));
    expect(unreadable.ok).toBe(false);
    expect(unreadable.ok ? '' : unreadable.reason).toMatch(/size/);
    expect(checkImageWithinCap(pngHeader(300, 300), 300 * 300)).toEqual({
      ok: true,
    });
    expect(checkImageWithinCap(pngHeader(301, 300), 300 * 300).ok).toBe(false);
  });

  it("checks a model's images, in its binary chunk or as data: URIs", () => {
    expect(checkGlbInert(texturedGlb(pngHeader(2048, 2048)))).toEqual({
      ok: true,
    });
    const huge = checkGlbInert(texturedGlb(pngHeader(16384, 16384)));
    expect(huge.ok).toBe(false);
    expect(huge.ok ? '' : huge.reason).toMatch(/16384 x 16384/);
    expect(
      checkGlbInert(
        glb({
          asset: { version: '2.0' },
          images: [{ uri: dataUri(pngHeader(9000, 9000)) }],
        })
      ).ok
    ).toBe(false);
    // An image the header reader cannot measure is not decoded either.
    expect(checkGlbInert(texturedGlb(new Uint8Array([7, 7, 7, 7]))).ok).toBe(
      false
    );
    // A buffer view that runs past the binary chunk measures nothing.
    const outside = withChunks(
      glb({
        asset: { version: '2.0' },
        buffers: [{ byteLength: 4 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4096 }],
        images: [{ bufferView: 0 }],
      }),
      [{ type: BIN_CHUNK, data: new Uint8Array(4) }]
    );
    expect(checkGlbInert(outside).ok).toBe(false);
    // The cap can be set.
    expect(
      checkGlbInert(texturedGlb(pngHeader(2048, 2048)), {
        maxImagePixels: 1024 * 1024,
      }).ok
    ).toBe(false);
  });
});

/**
 * The cap sweep (R2): what each candidate cap admits of the images a tour
 * meets, and what one decode then costs (RGBA, 4 bytes a pixel). The
 * shipped 16.8 MP admits ordinary phone photos and 4096 px textures at
 * 64 MiB a decode at most; 4.2 MP refuses a 12 MP photo; 33.6 MP lets one
 * decode take 128 MiB; no cap here admits a 48 MP photo (186 MiB).
 */
describe('the pixel cap sweep (R2)', () => {
  const SOURCES = {
    phone12: [4032, 3024],
    phone48: [8064, 6048],
    figure: [2048, 4096],
    texture4k: [4096, 4096],
    texture8k: [8192, 8192],
  } as const;
  const CAPS = [2048 * 2048, 2900 * 2900, 4096 * 4096, 5793 * 5793];
  const admits = (cap: number) =>
    Object.entries(SOURCES)
      .filter(([, [w, h]]) => checkImageWithinCap(pngHeader(w, h), cap).ok)
      .map(([name]) => name);

  it('admits what a tour needs and refuses what would not fit a phone, at the shipped cap only', () => {
    expect(admits(CAPS[0]!)).toEqual([]);
    expect(admits(CAPS[1]!)).toEqual(['figure']);
    expect(admits(TOUR_MAX_IMAGE_PIXELS)).toEqual([
      'phone12',
      'figure',
      'texture4k',
    ]);
    expect(admits(CAPS[3]!)).toEqual(['phone12', 'figure', 'texture4k']);
    // The largest decode each cap allows, in MiB.
    expect(CAPS.map((c) => Math.round((c * 4) / 2 ** 20))).toEqual([
      16, 32, 64, 128,
    ]);
  });
});
