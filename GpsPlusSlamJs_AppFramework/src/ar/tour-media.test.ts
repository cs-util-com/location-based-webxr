import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  checkGlbInert,
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
          images: [{ uri: 'data:image/png;base64,AAAA' }],
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
