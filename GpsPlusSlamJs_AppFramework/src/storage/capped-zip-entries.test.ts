import { describe, expect, it } from 'vitest';
import {
  BlobWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';

import { ArchiveLimitError } from './archive-limits.js';
import {
  DecompressionBudget,
  listZipEntriesCapped,
  readZipEntryBlob,
  readZipEntryText,
} from './capped-zip-entries.js';

/**
 * Why these tests matter (tour kit plan K0, review F1): a tour zip from
 * any link is untrusted. A few KB of deflated zeros inflate to gigabytes,
 * and an entry's DECLARED size is whatever the file says. These tests
 * build real deflated zips (zip bombs in miniature) and prove the reads
 * stop on the bytes actually produced - per entry, per archive in total -
 * and that the central directory walk stops at its entry cap.
 */

const MiB = 1024 * 1024;

async function deflatedZip(
  files: Record<string, Uint8Array | string>
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 9 });
  for (const [name, data] of Object.entries(files)) {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await writer.add(name, new Uint8ArrayReader(bytes));
  }
  return writer.close();
}

async function entriesOf(zip: Uint8Array): Promise<FileEntry[]> {
  const entries = await new ZipReader(new Uint8ArrayReader(zip)).getEntries();
  return entries.filter((e: Entry): e is FileEntry => !e.directory);
}

/** Rewrite every declared uncompressed size (local header offset 22,
 *  central directory offset 24) - the crafted-zip lie. */
function withDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i += 1) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, size, true);
    if (sig === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return out;
}

describe('listZipEntriesCapped', () => {
  it('lists every entry up to the cap', async () => {
    const zip = await deflatedZip({ a: 'a', b: 'b', c: 'c' });
    const reader = new ZipReader(new Uint8ArrayReader(zip));
    const names = (await listZipEntriesCapped(reader, 3)).map(
      (e) => e.filename
    );
    expect(names).toEqual(['a', 'b', 'c']);
  });

  it('stops walking the directory one entry past the cap', async () => {
    const zip = await deflatedZip({ a: 'a', b: 'b', c: 'c', d: 'd' });
    const reader = new ZipReader(new Uint8ArrayReader(zip));
    const err = await listZipEntriesCapped(reader, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('entry-count');
    expect((err as ArchiveLimitError).limit).toBe(2);
  });
});

describe('reading entries under a DecompressionBudget', () => {
  it('reads an ordinary entry as text and as a typed Blob', async () => {
    const [entry] = await entriesOf(await deflatedZip({ 't.json': '{"a":1}' }));
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: MiB,
    });
    expect(await readZipEntryText(entry!, budget)).toBe('{"a":1}');
    const blob = await readZipEntryBlob(entry!, budget, 'application/json');
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBe(7);
  });

  it('stops a zip bomb at the per-entry cap, long before it is fully inflated', async () => {
    // 8 MiB of zeros deflate to about 8 KB: the shape of a zip bomb.
    const zip = await deflatedZip({ bomb: new Uint8Array(8 * MiB) });
    expect(zip.length).toBeLessThan(64 * 1024);
    const [entry] = await entriesOf(zip);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    const err = await readZipEntryBlob(entry!, budget, '').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('entry-bytes');
    expect((err as ArchiveLimitError).observed).toBeGreaterThan(MiB);
    expect((err as ArchiveLimitError).observed).toBeLessThan(8 * MiB);
  });

  it('stops on the bytes produced, even when the entry declares a size within the cap', async () => {
    // The declared size says 100 bytes; the data inflates to 8 MiB. zip.js
    // has its own check against the declared size, and the cap is the one
    // that does not depend on the file being honest: either way the read
    // must fail and never deliver the inflated data.
    const zip = withDeclaredSize(
      await deflatedZip({ liar: new Uint8Array(8 * MiB) }),
      100
    );
    const [entry] = await entriesOf(zip);
    expect(entry!.uncompressedSize).toBe(100);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    await expect(readZipEntryBlob(entry!, budget, '')).rejects.toThrow();
  });

  it('stops on the bytes produced when the entry declares a huge size', async () => {
    // The opposite lie: a declared 3 GB lets zip.js's own size check pass
    // every chunk, so only the counting cap stops the read.
    const zip = withDeclaredSize(
      await deflatedZip({ big: new Uint8Array(8 * MiB) }),
      3_000_000_000
    );
    const [entry] = await entriesOf(zip);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    const err = await readZipEntryBlob(entry!, budget, '').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('entry-bytes');
  });

  it('applies a tighter per-call cap (text entries)', async () => {
    const [entry] = await entriesOf(
      await deflatedZip({ 'big.json': 'x'.repeat(5000) })
    );
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: MiB,
    });
    const err = await readZipEntryText(entry!, budget, 1000).catch(
      (e: unknown) => e
    );
    expect((err as ArchiveLimitError).kind).toBe('entry-bytes');
    expect((err as ArchiveLimitError).limit).toBe(1000);
  });

  it('stops many small bombs at the archive total', async () => {
    const zip = await deflatedZip({
      a: new Uint8Array(600 * 1024),
      b: new Uint8Array(600 * 1024),
    });
    const [a, b] = await entriesOf(zip);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: MiB,
    });
    await readZipEntryBlob(a!, budget, '');
    const err = await readZipEntryBlob(b!, budget, '').catch((e: unknown) => e);
    expect((err as ArchiveLimitError).kind).toBe('total-bytes');
  });

  it('does not charge a re-read of the same entry twice', async () => {
    // The gallery, the image planes and a retry all read the same photo;
    // the total is about distinct data, not about how often it is shown.
    const [a] = await entriesOf(
      await deflatedZip({ a: new Uint8Array(600 * 1024) })
    );
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: MiB,
    });
    for (let i = 0; i < 4; i += 1) {
      expect((await readZipEntryBlob(a!, budget, '')).size).toBe(600 * 1024);
    }
    expect(budget.totalBytes).toBe(600 * 1024);
  });

  it('builds its caps from an archive size through the shared limits', () => {
    const budget = DecompressionBudget.forArchive(1_000, {
      totalFloorBytes: 100,
      totalRatio: 2,
      maxTotalBytes: 10_000,
      maxEntryBytes: 50,
    });
    expect(budget.maxTotalBytes).toBe(2_000);
    expect(budget.maxEntryBytes).toBe(50);
  });

  it('refuses caps that would disable the guard', () => {
    expect(
      () => new DecompressionBudget({ maxEntryBytes: 0, maxTotalBytes: 1 })
    ).toThrow(RangeError);
    expect(
      () =>
        new DecompressionBudget({
          maxEntryBytes: 1,
          maxTotalBytes: Number.POSITIVE_INFINITY,
        })
    ).toThrow(RangeError);
  });
});

// Keeps `BlobWriter` honest as the comparison: an uncapped read of the
// same bomb inflates all of it - the behaviour this module replaces.
describe('the uncapped read this module replaces', () => {
  it('inflates the whole bomb', async () => {
    const [entry] = await entriesOf(
      await deflatedZip({ bomb: new Uint8Array(4 * MiB) })
    );
    expect((await entry!.getData(new BlobWriter())).size).toBe(4 * MiB);
  });
});
