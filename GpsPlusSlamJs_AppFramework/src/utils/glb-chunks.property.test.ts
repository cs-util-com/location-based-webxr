/**
 * Why these properties matter: `readGlbChunks` reads untrusted tour files,
 * so it must never throw whatever the bytes, it must hand back exactly the
 * chunks a well-formed file was built from, and it must refuse any
 * truncation of one (a cut file would otherwise read as a shorter model).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GLB_CHUNK_BIN,
  GLB_CHUNK_JSON,
  GLB_MAGIC,
  readGlbChunks,
} from './glb-chunks.js';

/** A well-formed GLB of a generated JSON object, its JSON chunk padded
 *  to `pad` bytes, and an optional binary chunk. */
const wellFormed = fc
  .record({
    json: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 6 }),
      fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.boolean())
    ),
    pad: fc.constantFrom(1, 2, 4),
    bin: fc.option(fc.uint8Array({ maxLength: 40 }), { nil: null }),
  })
  .map(({ json, pad, bin }) => {
    const raw = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(raw.length / pad) * pad;
    const size = 20 + jsonLength + (bin === null ? 0 : 8 + bin.length);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, size, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, GLB_CHUNK_JSON, true);
    out.fill(0x20, 20, 20 + jsonLength);
    out.set(raw, 20);
    if (bin !== null) {
      view.setUint32(20 + jsonLength, bin.length, true);
      view.setUint32(24 + jsonLength, GLB_CHUNK_BIN, true);
      out.set(bin, 28 + jsonLength);
    }
    return { bytes: out, json, bin };
  });

describe('readGlbChunks (properties)', () => {
  it('never throws on random bytes, nor on random bytes behind a GLB header', () => {
    const headed = fc.uint8Array({ maxLength: 80 }).map((tail) => {
      const out = new Uint8Array(12 + tail.length);
      out.set(tail, 12);
      const view = new DataView(out.buffer);
      view.setUint32(0, GLB_MAGIC, true);
      view.setUint32(4, 2, true);
      view.setUint32(8, out.length, true);
      return out;
    });
    fc.assert(
      fc.property(fc.oneof(fc.uint8Array({ maxLength: 96 }), headed), (b) => {
        const read = readGlbChunks(b);
        expect(typeof read.ok).toBe('boolean');
      })
    );
  });

  it('hands back exactly the chunks a well-formed GLB was built from', () => {
    fc.assert(
      fc.property(wellFormed, ({ bytes, json, bin }) => {
        const read = readGlbChunks(bytes);
        expect(read).toEqual({ ok: true, json, bin });
      })
    );
  });

  it('refuses every truncation of a well-formed GLB', () => {
    fc.assert(
      fc.property(wellFormed, fc.nat(), ({ bytes }, cut) => {
        const length = cut % bytes.length;
        expect(readGlbChunks(bytes.slice(0, length)).ok).toBe(false);
      })
    );
  });
});
