import {
  ZipReader,
  BlobReader,
  TextWriter,
  type FileEntry,
} from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { packFilesAsZip, ZipPackagingError } from './pack-files-as-zip.js';

const readAllEntries = async (blob: Blob) => {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    return await reader.getEntries();
  } finally {
    await reader.close();
  }
};

// ── ZIP byte readers ─────────────────────────────────────────────────────────
// Deliberately independent of @zip.js/zip.js: if the library's own reader were
// used to check the library's own writer, a shared misunderstanding of the
// format would cancel out.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const STORED = 0x0000;

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);

function findEocd(view: DataView): number {
  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new Error('not a ZIP: no EOCD record');
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = viewOf(bytes);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: CentralEntry[] = [];

  for (let i = 0; i < total; i++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`corrupt central directory at ${at}`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      name: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength)
      ),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readLocalMethod(bytes: Uint8Array, offset: number): number {
  const view = viewOf(bytes);
  if (view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`no local header at ${offset}`);
  }
  return view.getUint16(offset + 8, true);
}

const bytesOf = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer());

describe('packFilesAsZip', () => {
  it('returns a ZIP blob containing the manifest and every declared file', async () => {
    const blob = await packFilesAsZip(
      { path: 'tour.json', json: { name: 'Harbour Walk' } },
      [{ path: 'assets/a.png', file: new Blob(['a']) }]
    );

    expect(blob.type).toBe('application/zip');
    const entries = await readAllEntries(blob);
    expect(entries.map((e) => e.filename).sort()).toEqual([
      'assets/a.png',
      'tour.json',
    ]);

    const manifestEntry = entries.find(
      (e): e is FileEntry => !e.directory && e.filename === 'tour.json'
    )!;
    const text = await manifestEntry.getData(new TextWriter());
    expect(JSON.parse(text)).toEqual({ name: 'Harbour Walk' });
  });

  it('stores every entry uncompressed, in both the local header and the central directory', async () => {
    const blob = await packFilesAsZip(
      { path: 'tour.json', json: { name: 'Harbour Walk' } },
      [{ path: 'assets/a.png', file: new Blob(['a']) }]
    );
    const bytes = await bytesOf(blob);
    const entries = readCentralDirectory(bytes);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.method).toBe(STORED);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
      expect(readLocalMethod(bytes, entry.localHeaderOffset)).toBe(STORED);
    }
  });

  it('rejects an entry path colliding with the manifest path', async () => {
    await expect(
      packFilesAsZip({ path: 'tour.json', json: {} }, [
        { path: 'tour.json', file: new Blob(['a']) },
      ])
    ).rejects.toBeInstanceOf(ZipPackagingError);
  });

  it('rejects duplicate entry paths instead of silently overwriting one', async () => {
    await expect(
      packFilesAsZip({ path: 'tour.json', json: {} }, [
        { path: 'assets/same.bin', file: new Blob(['a']) },
        { path: 'assets/same.bin', file: new Blob(['b']) },
      ])
    ).rejects.toThrow(/assets\/same\.bin/);
  });
});
