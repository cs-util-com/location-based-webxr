/**
 * Why these tests matter: `readGlbChunks` is the one reader of a `.glb`'s
 * chunk layout. The tour's inertness check (`ar/tour-media`) refuses a
 * model on its verdict, and the Tour Viewer's model optimizer and its
 * check page read the JSON and binary chunk through it, so a file it
 * accepts is a file three.js will load as exactly these two chunks. The
 * reasons are plain words a creator reads in the editor, so they are
 * pinned here word for word.
 */
import { describe, expect, it } from 'vitest';
import {
  GLB_CHUNK_BIN,
  GLB_CHUNK_JSON,
  GLB_MAGIC,
  readGlbChunks,
} from './glb-chunks.js';

interface Chunk {
  readonly type: number;
  readonly data: Uint8Array;
  readonly length?: number;
}

function build(
  chunks: readonly Chunk[],
  header: { magic?: number; version?: number; total?: number } = {}
): Uint8Array {
  const size = chunks.reduce((sum, c) => sum + 8 + c.data.length, 12);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, header.magic ?? GLB_MAGIC, true);
  view.setUint32(4, header.version ?? 2, true);
  view.setUint32(8, header.total ?? size, true);
  let at = 12;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.length ?? chunk.data.length, true);
    view.setUint32(at + 4, chunk.type, true);
    out.set(chunk.data, at + 8);
    at += 8 + chunk.data.length;
  }
  return out;
}

function text(value: string, pad = 4): Uint8Array {
  const raw = new TextEncoder().encode(value);
  const out = new Uint8Array(Math.ceil(raw.length / pad) * pad).fill(0x20);
  out.set(raw, 0);
  return out;
}

const MODEL = { asset: { version: '2.0' } };
const json = (value: unknown = MODEL, pad = 4): Chunk => ({
  type: GLB_CHUNK_JSON,
  data: text(JSON.stringify(value), pad),
});
const bin = (data: Uint8Array = Uint8Array.of(1, 2, 3, 4)): Chunk => ({
  type: GLB_CHUNK_BIN,
  data,
});

const reasonOf = (bytes: Uint8Array): string | null => {
  const read = readGlbChunks(bytes);
  return read.ok ? null : read.reason;
};

describe('readGlbChunks', () => {
  it('reads the JSON chunk and the binary chunk', () => {
    const read = readGlbChunks(build([json(), bin()]));
    expect(read).toEqual({
      ok: true,
      json: MODEL,
      bin: Uint8Array.of(1, 2, 3, 4),
    });
  });

  it('gives no binary chunk for a JSON-only file, and an empty one for a zero-length chunk', () => {
    expect(readGlbChunks(build([json()]))).toEqual({
      ok: true,
      json: MODEL,
      bin: null,
    });
    const empty = readGlbChunks(build([json(), bin(new Uint8Array(0))]));
    expect(empty.ok && empty.bin?.length).toBe(0);
  });

  it('reads a JSON chunk that is not padded to 4 bytes (three.js does)', () => {
    const odd = json(MODEL, 1);
    expect(odd.data.length % 4).not.toBe(0);
    expect(readGlbChunks(build([odd, bin()])).ok).toBe(true);
  });

  it('reads through a view that does not start at its buffer start', () => {
    const model = build([json(), bin()]);
    const host = new Uint8Array(model.length + 7);
    host.set(model, 7);
    const read = readGlbChunks(host.subarray(7));
    expect(read.ok && read.bin).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it('refuses a file too short for the header and the first chunk header', () => {
    const model = build([json()]);
    for (const length of [0, 11, 12, 19]) {
      expect(reasonOf(model.slice(0, length))).toBe(
        'it is too short to be a .glb'
      );
    }
  });

  it('refuses a wrong magic and a version other than 2', () => {
    expect(reasonOf(build([json()], { magic: 0 }))).toBe(
      'it is not a .glb file'
    );
    expect(reasonOf(build([json()], { version: 1 }))).toBe(
      'only glTF 2.0 is supported'
    );
  });

  it('refuses a first chunk that is not JSON, or one longer than the file', () => {
    expect(reasonOf(build([{ ...json(), type: GLB_CHUNK_BIN }]))).toBe(
      'its JSON chunk is missing or truncated'
    );
    expect(reasonOf(build([{ ...json(), length: 1 << 20 }]))).toBe(
      'its JSON chunk is missing or truncated'
    );
  });

  it('refuses a header length that is not the data length', () => {
    expect(reasonOf(build([json()], { total: 4 }))).toBe(
      'its declared length does not match the file'
    );
  });

  it('refuses a second chunk that is not binary, and any chunk after the binary one', () => {
    expect(reasonOf(build([json(), json()]))).toBe(
      'it has a chunk other than one JSON and one binary chunk'
    );
    expect(reasonOf(build([json(), bin(), bin()]))).toBe(
      'it has data past its last chunk, or a chunk that runs past the end'
    );
  });

  it('refuses a binary chunk that runs past the end, and a stub of a chunk header', () => {
    expect(reasonOf(build([json(), { ...bin(), length: 400 }]))).toBe(
      'it has data past its last chunk, or a chunk that runs past the end'
    );
    const model = build([json()]);
    const stub = new Uint8Array(model.length + 4);
    stub.set(model, 0);
    new DataView(stub.buffer).setUint32(8, stub.length, true);
    expect(reasonOf(stub)).toBe(
      'it has data past its last chunk, or a chunk that runs past the end'
    );
  });

  it('refuses JSON that does not parse, and JSON that is no object', () => {
    expect(
      reasonOf(build([{ type: GLB_CHUNK_JSON, data: text('{ nope') }]))
    ).toBe('its JSON chunk does not parse');
    for (const value of [[1, 2], null, 7, 'x']) {
      expect(reasonOf(build([json(value)]))).toBe(
        'its JSON chunk is not an object'
      );
    }
  });

  it('refuses what is not bytes at all, without throwing', () => {
    const values: unknown[] = [undefined, null, 'glTF', [0x67, 0x6c], {}];
    for (const value of values) {
      expect(reasonOf(value as Uint8Array)).toBe('it is not a .glb file');
    }
  });

  // Why this test matters: a view over a buffer that was transferred away
  // (to a worker, or by structuredClone) makes the DataView constructor
  // throw, and the reader promises a refusal for any input, never a throw.
  it('refuses a view over a detached buffer, without throwing', () => {
    const bytes = new Uint8Array(32);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(bytes.byteLength).toBe(0); // the view now reads as detached
    expect(reasonOf(bytes)).toBe('it is not a .glb file');
  });
});
