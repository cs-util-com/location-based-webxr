/**
 * Why this test matters: the rebuild is what turns "the creator measured
 * the code" into a hosted zip a visitor can open. It must add or replace
 * exactly the named entries, keep every other entry byte-identical (a
 * recorder zip's photos and action stream ride through it), keep STORE
 * mode (the range reader depends on it), and THROW on failure rather than
 * hand back the input - a creator who uploads the old zip believing it is
 * the new one has lost the measuring session with no error anywhere.
 */

import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { packFilesAsZip, ZipPackagingError } from './pack-files-as-zip';
import { readStoredCentralDirectory } from '../test-utils/zip-central-directory';
import { rebuildZipWithEntries } from './zip-rebuild';

async function entryBytes(zip: Blob): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const out = new Map<string, Uint8Array>();
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    return out;
  } finally {
    await reader.close();
  }
}

const PHOTO = new Uint8Array(512).map((_, i) => (i * 7) % 256);

async function recordingLikeZip(): Promise<Blob> {
  return packFilesAsZip([
    { path: 'session.json', data: '{"odomCoordVersion":2}' },
    { path: 'actions/000001.json', data: '[{"type":"x"}]' },
    { path: 'images/frame_000001.jpg', data: PHOTO },
  ]);
}

describe('rebuildZipWithEntries', () => {
  it('adds new entries and keeps every existing entry byte-identical', async () => {
    const input = await recordingLikeZip();
    const out = await rebuildZipWithEntries(input, [
      { path: 'qr/abc123.json', data: '{"version":1}' },
      { path: 'tour.json', data: '{"version":1,"objects":[]}' },
    ]);
    const before = await entryBytes(input);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual([
      'actions/000001.json',
      'images/frame_000001.jpg',
      'qr/abc123.json',
      'session.json',
      'tour.json',
    ]);
    for (const [name, bytes] of before) {
      expect(after.get(name)).toEqual(bytes);
    }
    expect(new TextDecoder().decode(after.get('tour.json'))).toBe(
      '{"version":1,"objects":[]}'
    );
  });

  it('replaces an entry that already exists at the same path, once', async () => {
    const input = await packFilesAsZip([
      { path: 'tour.json', data: '{"version":1,"objects":[]}' },
      { path: 'content/a.jpg', data: PHOTO },
    ]);
    const out = await rebuildZipWithEntries(input, [
      { path: 'tour.json', data: '{"version":1,"objects":[{"id":"a"}]}' },
    ]);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual(['content/a.jpg', 'tour.json']);
    expect(new TextDecoder().decode(after.get('tour.json'))).toContain(
      '"id":"a"'
    );
    const central = readStoredCentralDirectory(
      new Uint8Array(await out.arrayBuffer())
    );
    expect(central.filter((e) => e.name === 'tour.json')).toHaveLength(1);
  });

  it('keeps STORE mode for carried-over and new entries alike', async () => {
    const out = await rebuildZipWithEntries(await recordingLikeZip(), [
      { path: 'tour.json', data: '{}' },
    ]);
    const central = readStoredCentralDirectory(
      new Uint8Array(await out.arrayBuffer())
    );
    expect(central).toHaveLength(4);
    for (const entry of central) expect(entry.stored).toBe(true);
  });

  it('accepts a zero-entry input archive (the starter zip after a fresh pack)', async () => {
    const out = await rebuildZipWithEntries(await packFilesAsZip([]), [
      { path: 'tour.json', data: '{}' },
    ]);
    expect([...(await entryBytes(out)).keys()]).toEqual(['tour.json']);
  });

  it('reports progress per carried-over entry, then the total', async () => {
    const seen: [number, number][] = [];
    await rebuildZipWithEntries(
      await recordingLikeZip(),
      [{ path: 'tour.json', data: '{}' }],
      { onProgress: (done, total) => seen.push([done, total]) }
    );
    expect(seen.at(-1)).toEqual([4, 4]);
    expect(seen.every(([done, total]) => done <= total)).toBe(true);
  });

  it('THROWS on an unsafe new path and on a non-zip input - never returns the input', async () => {
    const input = await recordingLikeZip();
    await expect(
      rebuildZipWithEntries(input, [{ path: '../evil', data: 'x' }])
    ).rejects.toBeInstanceOf(ZipPackagingError);
    await expect(
      rebuildZipWithEntries(new Blob(['not a zip at all']), [
        { path: 'tour.json', data: '{}' },
      ])
    ).rejects.toBeInstanceOf(ZipPackagingError);
  });
});
