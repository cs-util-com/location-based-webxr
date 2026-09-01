import { describe, expect, it } from 'vitest';

import type { ByteSource } from './byte-source.js';
import { ByteSourceReader } from './zip-byte-source-reader.js';

/**
 * Why these tests matter: zip.js locates the end-of-central-directory record
 * by probing near (and past) the archive tail, so this adapter is the one
 * place EOF handling happens for every remote read. An unclamped or
 * zero-length request that leaks through becomes an invalid HTTP Range
 * header downstream (D2) — these tests pin the clamp *and* that zero-length
 * requests never reach the source at all.
 */

/** A ByteSource that records every read it receives. */
function recordingSource(bytes: Uint8Array): {
  source: ByteSource;
  reads: [number, number][];
} {
  const reads: [number, number][] = [];
  return {
    reads,
    source: {
      size: bytes.length,
      read: (offset, length) => {
        reads.push([offset, length]);
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    },
  };
}

const DATA = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);

describe('ByteSourceReader', () => {
  it('exposes the source size and delegates in-bounds reads unchanged', async () => {
    const { source, reads } = recordingSource(DATA);
    const reader = new ByteSourceReader(source);

    expect(reader.size).toBe(DATA.length);
    await expect(reader.readUint8Array(2, 3)).resolves.toEqual(
      new Uint8Array([12, 13, 14])
    );
    expect(reads).toEqual([[2, 3]]);
  });

  it('clamps a read overlapping EOF to the remaining bytes', async () => {
    const { source, reads } = recordingSource(DATA);
    const reader = new ByteSourceReader(source);

    await expect(reader.readUint8Array(6, 5)).resolves.toEqual(
      new Uint8Array([16, 17])
    );
    expect(reads).toEqual([[6, 2]]);
  });

  it('resolves a read at or past EOF empty without touching the source', async () => {
    const { source, reads } = recordingSource(DATA);
    const reader = new ByteSourceReader(source);

    await expect(reader.readUint8Array(8, 4)).resolves.toEqual(
      new Uint8Array(0)
    );
    await expect(reader.readUint8Array(20, 1)).resolves.toEqual(
      new Uint8Array(0)
    );
    expect(reads).toEqual([]);
  });

  it('resolves a zero-length read empty without touching the source', async () => {
    const { source, reads } = recordingSource(DATA);
    const reader = new ByteSourceReader(source);

    await expect(reader.readUint8Array(3, 0)).resolves.toEqual(
      new Uint8Array(0)
    );
    expect(reads).toEqual([]);
  });
});
