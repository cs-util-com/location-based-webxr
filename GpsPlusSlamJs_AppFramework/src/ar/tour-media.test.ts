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

  // Why this test matters: the check hands the shared chunk reader's
  // refusal on as its own, so the creator reads why the file is no model;
  // a check that swapped in a generic reason would still pass the tests
  // above, which only look at `ok`.
  it("passes the chunk reader's refusal reason through", () => {
    expect(checkGlbInert(glb({ asset: { version: '2.0' } }, 1))).toEqual({
      ok: false,
      reason: 'only glTF 2.0 is supported',
    });
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

  // Why: the tour's check and the Tour Viewer's glTF import read data: URIs
  // with one decoder, so a URI the import refuses as garbled can never pass
  // here as an image measured from a leniently decoded payload.
  it('reads an image data: URI as strict base64 only', () => {
    // One trailing byte when needed, so the base64 carries padding to drop.
    const png = pngHeader(4, 4);
    const bytes = new Uint8Array(png.length + (png.length % 3 === 0 ? 1 : 0));
    bytes.set(png);
    const uri = dataUri(bytes);
    expect(
      checkGlbInert(glb({ asset: { version: '2.0' }, images: [{ uri }] }))
    ).toEqual({ ok: true });
    const comma = uri.indexOf(',') + 1;
    const spaced = uri.slice(0, comma + 8) + ' ' + uri.slice(comma + 8);
    const unpadded = uri.replace(/=+$/, '');
    expect(unpadded).not.toBe(uri);
    for (const garbled of [spaced, unpadded]) {
      const check = checkGlbInert(
        glb({ asset: { version: '2.0' }, images: [{ uri: garbled }] })
      );
      expect(check, garbled).toEqual({
        ok: false,
        reason: expect.stringMatching(/image 0 cannot be found/),
      });
    }
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

const bufferUri = (bytes: Uint8Array): string =>
  `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;

/** A model whose one image sits at `bufferViews[0]` = buffer `buffer`,
 *  bytes 0-24, with `buffers` as given and `bin` as its binary chunk. */
function viewImageGlb(
  buffers: readonly Record<string, unknown>[],
  buffer: number,
  bin: Uint8Array | null,
  image: Record<string, unknown> = { bufferView: 0, mimeType: 'image/png' }
): Uint8Array {
  const model = glb({
    asset: { version: '2.0' },
    buffers,
    bufferViews: [{ buffer, byteOffset: 0, byteLength: 24 }],
    images: [image],
  });
  return bin === null
    ? model
    : withChunks(model, [{ type: BIN_CHUNK, data: bin }]);
}

/**
 * Why these tests matter: three.js's GLTFLoader (`loadBuffer`) reads
 * buffer 0 from the binary chunk ONLY when it has no `uri`; any buffer
 * with a `uri` is loaded from that URI, and an image with a `bufferView`
 * is loaded from the view even when it also names a `uri`. A check that
 * measured anything else measured a picture the phone never decodes: a
 * 4 x 4 header in the binary chunk passed while a few kilobytes of
 * `data:` buffer made the phone decode a 16384 x 16384 picture (1 GiB).
 */
describe('the pixel cap measures what three.js loads', () => {
  it('measures buffer 0 from its data: URI, not from the binary chunk', () => {
    const decoy = new Uint8Array(24);
    decoy.set(pngHeader(4, 4));
    const check = checkGlbInert(
      viewImageGlb(
        [{ byteLength: 24, uri: bufferUri(pngHeader(16384, 16384)) }],
        0,
        decoy
      )
    );
    expect(check).toEqual({
      ok: false,
      reason: expect.stringMatching(/16384 x 16384/),
    });
  });

  it('measures an image in a later data: buffer, and accepts a small one', () => {
    const buffers = (w: number) => [
      { byteLength: 4 },
      { byteLength: 24, uri: bufferUri(pngHeader(w, w)) },
    ];
    const bin = new Uint8Array(4);
    expect(checkGlbInert(viewImageGlb(buffers(64), 1, bin))).toEqual({
      ok: true,
    });
    expect(checkGlbInert(viewImageGlb(buffers(16384), 1, bin))).toEqual({
      ok: false,
      reason: expect.stringMatching(/16384 x 16384/),
    });
  });

  // The binary chunk holds a readable 4 x 4 header at the same range, so
  // a check that fell back to the chunk for an unreadable URI would pass.
  it('refuses an image in a data: buffer that does not decode strictly', () => {
    const uri = bufferUri(pngHeader(4, 4));
    const comma = uri.indexOf(',') + 1;
    const spaced = uri.slice(0, comma + 8) + ' ' + uri.slice(comma + 8);
    const decoy = new Uint8Array(24);
    decoy.set(pngHeader(4, 4));
    expect(
      checkGlbInert(viewImageGlb([{ byteLength: 24, uri: spaced }], 0, decoy))
    ).toEqual({
      ok: false,
      reason: expect.stringMatching(/image 0 cannot be found/),
    });
  });

  it('measures an image from its bufferView even when it also names a uri', () => {
    const bin = new Uint8Array(24);
    bin.set(pngHeader(16384, 16384));
    const check = checkGlbInert(
      viewImageGlb([{ byteLength: 24 }], 0, bin, {
        bufferView: 0,
        mimeType: 'image/png',
        uri: dataUri(pngHeader(4, 4)),
      })
    );
    expect(check).toEqual({
      ok: false,
      reason: expect.stringMatching(/16384 x 16384/),
    });
  });

  // Why: three.js resolves a later buffer without a `uri` to the empty
  // URL and fetches the page itself; only buffer 0 may be the binary chunk.
  it('refuses a buffer after the first that has no uri', () => {
    const check = checkGlbInert(
      glb({
        asset: { version: '2.0' },
        buffers: [{ byteLength: 4 }, { byteLength: 4 }],
      })
    );
    expect(check).toEqual({
      ok: false,
      reason: 'a buffer points outside the file',
    });
  });
});

/** A model whose one mesh draws from buffer view 0, with `fields` laid
 *  over its JSON. */
function meshGlb(fields: Record<string, unknown>): Uint8Array {
  return withChunks(
    glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 12 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      ...fields,
    }),
    [{ type: BIN_CHUNK, data: new Uint8Array(12) }]
  );
}

/**
 * Why these tests matter: three.js's GLTFLoader reads `json.buffers[i]`,
 * `json.bufferViews[i]` and the like by key, whatever their type, and
 * loads a buffer for any key a view names. An object in place of a list,
 * or a view naming its buffer by a string, so reached a buffer the check
 * never looked at: a `buffers` object holding an http URI made every open
 * of the tour fetch it, and `buffer: "0"` (which is not buffer 0 to
 * three's `=== 0`) made it fetch the page.
 */
describe('checkGlbInert - lists and references as three.js reads them', () => {
  it('accepts the plain model these tests vary', () => {
    expect(checkGlbInert(meshGlb({}))).toEqual({ ok: true });
  });

  it('refuses a buffer, view, accessor or image list that is not a list', () => {
    const beacon = {
      0: { uri: 'https://beacon.example/x', byteLength: 12 },
    };
    expect(checkGlbInert(meshGlb({ buffers: beacon }))).toEqual({
      ok: false,
      reason: '"buffers" is not a list',
    });
    for (const key of ['bufferViews', 'accessors', 'images']) {
      expect(checkGlbInert(meshGlb({ [key]: { 0: {} } })), key).toEqual({
        ok: false,
        reason: `"${key}" is not a list`,
      });
    }
  });

  it('refuses a view whose buffer is not a whole number', () => {
    for (const buffer of ['0', 'length', 'constructor', 0.5, -1, null]) {
      const check = checkGlbInert(
        meshGlb({ bufferViews: [{ buffer, byteOffset: 0, byteLength: 12 }] })
      );
      expect(check, String(buffer)).toEqual({
        ok: false,
        reason: 'a buffer view names no buffer of the file',
      });
    }
  });

  // three.js's meshopt plugin loads the buffer its extension names before
  // it looks for a decoder, and whether or not the extension is declared.
  it('refuses a view extension naming a buffer by anything but a whole number', () => {
    const viewWith = (buffer: unknown) =>
      meshGlb({
        bufferViews: [
          {
            buffer: 0,
            byteOffset: 0,
            byteLength: 12,
            extensions: { KHR_meshopt_compression: { buffer } },
          },
        ],
      });
    expect(checkGlbInert(viewWith(0))).toEqual({ ok: true });
    for (const buffer of ['0', 'length', null]) {
      expect(checkGlbInert(viewWith(buffer)), String(buffer)).toEqual({
        ok: false,
        reason: 'a buffer view names no buffer of the file',
      });
    }
  });

  // three.js takes a URI as data only when it matches /^data:.*,.*$/; any
  // other is resolved against the loader's path and fetched.
  it('refuses a data: URI three.js would not read as data', () => {
    for (const uri of ['data:x', 'data:\n,AAAA', 'data:;base64,AA\nAA']) {
      expect(
        checkGlbInert(glb({ asset: { version: '2.0' }, buffers: [{ uri }] })),
        JSON.stringify(uri)
      ).toEqual({ ok: false, reason: 'a buffer points outside the file' });
      expect(
        checkGlbInert(glb({ asset: { version: '2.0' }, images: [{ uri }] })),
        JSON.stringify(uri)
      ).toEqual({
        ok: false,
        reason: expect.stringMatching(/image points outside the file/),
      });
    }
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

/** A model of one accessor without a buffer view (three.js allocates it
 *  as zeros) and `binBytes` bytes of binary chunk to set the file length. */
function zerosGlb(accessor: Record<string, unknown>, binBytes = 0): Uint8Array {
  const model = glb({
    asset: { version: '2.0' },
    ...(binBytes > 0 ? { buffers: [{ byteLength: binBytes }] } : {}),
    accessors: [accessor],
  });
  return binBytes > 0
    ? withChunks(model, [{ type: BIN_CHUNK, data: new Uint8Array(binBytes) }])
    : model;
}

/** A one-byte-per-element accessor asking for `bytes(fileLength)` bytes, in
 *  a file of about `binBytes` bytes; the count's digits change the file's
 *  length, so it is rebuilt until the two agree. */
function scalarGlbAsking(
  bytes: (fileLength: number) => number,
  binBytes: number
): Uint8Array {
  let model = zerosGlb(
    { componentType: 5121, count: 1, type: 'SCALAR' },
    binBytes
  );
  for (let i = 0; i < 4; i += 1) {
    model = zerosGlb(
      { componentType: 5121, count: bytes(model.length), type: 'SCALAR' },
      binBytes
    );
  }
  return model;
}

const MiB = 2 ** 20;

/**
 * Why these tests matter: three.js's GLTFLoader allocates every accessor
 * without a buffer view, and every sparse one, as a new array of `count`
 * elements (`loadAccessor`), and uploads every accessor to the GPU, so a
 * few bytes of JSON (`count: 100000000`, `VEC4`, float) made a phone
 * allocate 1.6 GB. The accessors of a model together may ask for 64 MiB,
 * or 8 times the file's length when that is more. Measured on 48 real
 * models (this repo's and others on the development machine): the most
 * any asked for was 3.7 MB, and the highest ratio to its file's length
 * 3.69 (a 44 KB model, far under the floor); the repo's own LOD
 * prototypes reach 2.28, from accessors left without a buffer view.
 */
describe('checkGlbInert - the memory its accessors ask for', () => {
  it('refuses an accessor that asks for 1.6 GB of zeros', () => {
    const check = checkGlbInert(
      zerosGlb({ componentType: 5126, count: 100_000_000, type: 'VEC4' })
    );
    expect(check).toEqual({
      ok: false,
      reason: expect.stringMatching(/accessors ask for 1526 MiB/),
    });
  });

  it('admits 64 MiB in a small file, and not a byte more', () => {
    const vec4 = { componentType: 5126, type: 'VEC4' };
    expect(
      checkGlbInert(zerosGlb({ ...vec4, count: (64 * MiB) / 16 }))
    ).toEqual({ ok: true });
    expect(
      checkGlbInert(
        zerosGlb({ componentType: 5121, count: 64 * MiB + 1, type: 'SCALAR' })
      ).ok
    ).toBe(false);
  });

  it('admits 8 times the file length above the floor, and not a byte more', () => {
    const binBytes = 9 * MiB;
    expect(checkGlbInert(scalarGlbAsking((n) => 8 * n, binBytes))).toEqual({
      ok: true,
    });
    expect(checkGlbInert(scalarGlbAsking((n) => 8 * n + 1, binBytes)).ok).toBe(
      false
    );
  });

  it('sums every accessor, sparse ones included', () => {
    const half = { componentType: 5126, count: (40 * MiB) / 4, type: 'SCALAR' };
    const model = glb({
      asset: { version: '2.0' },
      accessors: [half, { ...half, sparse: { count: 1 } }],
    });
    expect(checkGlbInert(model).ok).toBe(false);
    expect(
      checkGlbInert(glb({ asset: { version: '2.0' }, accessors: [half] }))
    ).toEqual({ ok: true });
  });

  it('refuses an accessor whose count, type or component type it cannot read', () => {
    for (const accessor of [
      { componentType: 5126, count: '4', type: 'VEC3' },
      { componentType: 5126, count: -1, type: 'VEC3' },
      { componentType: 5126, count: 1.5, type: 'VEC3' },
      { componentType: 5126, type: 'VEC3' },
      { componentType: 5126, count: 1, type: 'constructor' },
      { componentType: 5124, count: 1, type: 'VEC3' },
      null,
    ]) {
      expect(
        checkGlbInert(
          glb({ asset: { version: '2.0' }, accessors: [accessor] })
        ),
        JSON.stringify(accessor)
      ).toEqual({
        ok: false,
        reason: 'its accessor 0 cannot be read',
      });
    }
  });
});
