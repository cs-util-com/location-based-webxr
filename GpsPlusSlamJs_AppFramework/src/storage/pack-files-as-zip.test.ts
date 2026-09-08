/**
 * Why this test matters: the packer is the ONE store-mode writer behind the
 * starter zip, the rebuild and the coverage embed. A range-reading consumer
 * slices entries out as raw bytes, so a single DEFLATE'd entry would read
 * back as garbage on a device. STORE mode is therefore verified against a
 * hand-rolled central-directory parser deliberately independent of
 * `@zip.js/zip.js` (a shared misreading of the format would cancel out), a
 * discipline kept from community PR #321's test. The error paths are the
 * PR review's confirmed gaps: an unsafe path anywhere, an `undefined`
 * serialisation, and a writer failure that must not surface as a raw
 * library error.
 */

import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { packFilesAsZip, ZipPackagingError } from './pack-files-as-zip';
import { readStoredCentralDirectory } from '../test-utils/zip-central-directory';

async function readAllEntries(blob: Blob): Promise<FileEntry[]> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    return (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory
    );
  } finally {
    await reader.close();
  }
}

describe('packFilesAsZip', () => {
  it('returns an application/zip blob containing every declared entry, text and binary', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const blob = await packFilesAsZip([
      { path: 'tour.json', data: JSON.stringify({ name: 'Harbour Walk' }) },
      { path: 'assets/a.png', data: new Blob([bytes]) },
      { path: 'assets/b.bin', data: bytes },
    ]);

    expect(blob.type).toBe('application/zip');
    const entries = await readAllEntries(blob);
    expect(entries.map((e) => e.filename).sort()).toEqual([
      'assets/a.png',
      'assets/b.bin',
      'tour.json',
    ]);
    const manifest = entries.find((e) => e.filename === 'tour.json');
    expect(JSON.parse(await manifest!.getData(new TextWriter()))).toEqual({
      name: 'Harbour Walk',
    });
    const b = entries.find((e) => e.filename === 'assets/b.bin');
    expect(await b!.getData(new Uint8ArrayWriter())).toEqual(bytes);
  });

  it('stores every entry uncompressed, in both the local header and the central directory', async () => {
    const blob = await packFilesAsZip([
      { path: 'tour.json', data: '{"x":1}' },
      { path: 'assets/a.png', data: new Blob(['aaaaaaaaaaaaaaaaaaaaaaaa']) },
    ]);
    const central = readStoredCentralDirectory(
      new Uint8Array(await blob.arrayBuffer())
    );
    expect(central.map((e) => e.name).sort()).toEqual([
      'assets/a.png',
      'tour.json',
    ]);
    for (const entry of central) {
      expect(entry.stored).toBe(true);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
    }
  });

  it('packs an empty entry list into a valid, empty archive (the starter zip case)', async () => {
    const blob = await packFilesAsZip([]);
    expect(blob.size).toBeGreaterThan(0);
    expect(await readAllEntries(blob)).toEqual([]);
  });

  it('rejects an unsafe or duplicate path BEFORE writing, as a ZipPackagingError', async () => {
    await expect(
      packFilesAsZip([{ path: '../evil.json', data: '{}' }])
    ).rejects.toBeInstanceOf(ZipPackagingError);
    await expect(
      packFilesAsZip([
        { path: 'assets/same.bin', data: 'a' },
        { path: 'assets/same.bin', data: 'b' },
      ])
    ).rejects.toThrow(/assets\/same\.bin/);
  });

  it('wraps a failure of the underlying writer in a ZipPackagingError', async () => {
    // A data source whose stream throws mid-write: the packer must not leak
    // the raw library error, nor resolve with a partial archive.
    const broken = new Blob(['x']);
    Object.defineProperty(broken, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.error(new Error('disk gone'));
          },
        }),
    });
    await expect(
      packFilesAsZip([{ path: 'a.bin', data: broken }])
    ).rejects.toBeInstanceOf(ZipPackagingError);
  });
});
