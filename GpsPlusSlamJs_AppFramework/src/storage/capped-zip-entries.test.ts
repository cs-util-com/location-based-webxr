import { describe, expect, it } from 'vitest';
import {
  BlobWriter,
  ERR_INVALID_UNCOMPRESSED_SIZE,
  ERR_OVERLAPPING_ENTRY,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';

import { ArchiveLimitError, DEFAULT_ARCHIVE_LIMITS } from './archive-limits.js';
import type { ByteSource } from './byte-source.js';
import {
  DecompressionBudget,
  listZipEntriesCapped,
  readZipEntryBlob,
  readZipEntryText,
} from './capped-zip-entries.js';
import { ByteSourceReader } from './zip-byte-source-reader.js';

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

/** Rename entries in place (local and central headers): every name in
 *  `from` becomes `to`, which must have the same length. zip.js refuses to
 *  WRITE a duplicate name, so a crafted archive is made by patching bytes. */
function withSameName(
  zip: Uint8Array,
  from: readonly string[],
  to: string
): Uint8Array {
  const out = zip.slice();
  const target = new TextEncoder().encode(to);
  for (const name of from) {
    const needle = new TextEncoder().encode(name);
    if (needle.length !== target.length) throw new Error('same length only');
    for (let i = 0; i + needle.length <= out.length; i += 1) {
      if (needle.every((b, j) => out[i + j] === b)) out.set(target, i);
    }
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

  it('stops an understated entry at the cap, before zip.js would stop it at the declared size', async () => {
    // K0 milestone review R11: the declared size says 4 MiB, the data
    // inflates to 8 MiB. zip.js's own check would let 4 MiB through before
    // refusing; the cap (1 MiB) counts the bytes actually produced and
    // stops first - so this test fails if the count is ever removed, which
    // a lie BELOW the cap (next test) cannot show.
    const zip = withDeclaredSize(
      await deflatedZip({ liar: new Uint8Array(8 * MiB) }),
      4 * MiB
    );
    const [entry] = await entriesOf(zip);
    expect(entry!.uncompressedSize).toBe(4 * MiB);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    const err = await readZipEntryBlob(entry!, budget, '').catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('entry-bytes');
    expect((err as ArchiveLimitError).limit).toBe(MiB);
    expect((err as ArchiveLimitError).observed).toBeLessThan(4 * MiB);
  });

  it('leaves a lie below the cap to zip.js, which refuses it at the declared size', async () => {
    // Declared 100 bytes, inflates to 8 MiB. zip.js checks its output
    // against the declared size and refuses at 100 bytes, long before the
    // cap could; measured 2026-10-04 (zip.js 2.11.2), its error wins every
    // time. Pinned so a zip.js upgrade that drops the check is noticed:
    // the cap above would then be the only guard.
    const zip = withDeclaredSize(
      await deflatedZip({ liar: new Uint8Array(8 * MiB) }),
      100
    );
    const [entry] = await entriesOf(zip);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    const err = await readZipEntryBlob(entry!, budget, '').catch(
      (e: unknown) => e
    );
    expect(err).not.toBeInstanceOf(ArchiveLimitError);
    expect((err as Error).message).toBe(ERR_INVALID_UNCOMPRESSED_SIZE);
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

  it('charges entries that share a NAME separately (the total keys on the entry, not its name)', async () => {
    // K0 milestone review R3: a crafted zip can list one name thousands of
    // times, each copy its own deflated data. Keyed on the name, every
    // copy after the first charged nothing, so the archive total never
    // bit. Four copies of 600 KiB against a 1 MiB total must be refused.
    const zip = withSameName(
      await deflatedZip({
        'a/1': new Uint8Array(600 * 1024),
        'a/2': new Uint8Array(600 * 1024),
        'a/3': new Uint8Array(600 * 1024),
        'a/4': new Uint8Array(600 * 1024),
      }),
      ['a/2', 'a/3', 'a/4'],
      'a/1'
    );
    const entries = await entriesOf(zip);
    expect(entries.map((e) => e.filename)).toEqual([
      'a/1',
      'a/1',
      'a/1',
      'a/1',
    ]);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: MiB,
    });
    const err = await (async () => {
      for (const entry of entries) await readZipEntryBlob(entry, budget, '');
    })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('total-bytes');
  });

  it('refuses a second record over data another record already read (one offset, two names)', async () => {
    // The flip side of keying on the offset: a re-read of ONE entry is
    // free, so a crafted directory listing thousands of records that all
    // point at one deflated payload must not pass as re-reads. zip.js's
    // overlap check refuses the second record before it inflates.
    const zip = await deflatedZip({
      a: new Uint8Array(600 * 1024),
      b: new Uint8Array(600 * 1024),
    });
    const crafted = zip.slice();
    const view = new DataView(crafted.buffer);
    const centralOffsets: number[] = [];
    for (let i = 0; i + 4 <= crafted.length; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) centralOffsets.push(i);
    }
    const [first, second] = centralOffsets;
    // Record b's local header offset (central +42) := record a's.
    view.setUint32(second! + 42, view.getUint32(first! + 42, true), true);
    const [a, b] = await entriesOf(crafted);
    expect(b!.offset).toBe(a!.offset);
    const budget = new DecompressionBudget({
      maxEntryBytes: MiB,
      maxTotalBytes: 100 * MiB,
    });
    expect((await readZipEntryBlob(a!, budget, '')).size).toBe(600 * 1024);
    const err = await readZipEntryBlob(b!, budget, '').catch((e: unknown) => e);
    expect((err as Error).message).toBe(ERR_OVERLAPPING_ENTRY);
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
describe('a crafted end record declaring a huge central directory (K0 milestone review R4)', () => {
  // A 64 MiB "file" that is all zeros except its end record, which declares
  // one entry and a 32 MiB directory right before it. zip.js reads a
  // declared directory in ONE read before yielding a single entry, so the
  // entry-count cap never gets a say; the reader's single-read cap must.
  const SIZE = 64 * MiB;
  const DECLARED = 32 * MiB;
  function craftedSource(): { source: ByteSource; largestRead: () => number } {
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, 1, true); // entries on this disk
    view.setUint16(10, 1, true); // entries in total
    view.setUint32(12, DECLARED, true); // directory size
    view.setUint32(16, SIZE - 22 - DECLARED, true); // directory offset
    let largest = 0;
    return {
      largestRead: () => largest,
      source: {
        size: SIZE,
        read: (offset, length) => {
          largest = Math.max(largest, length);
          const out = new Uint8Array(length);
          const tail = SIZE - 22;
          if (offset + length > tail) {
            const from = Math.max(offset, tail);
            out.set(
              eocd.subarray(from - tail, offset + length - tail),
              from - offset
            );
          }
          return Promise.resolve(out);
        },
      },
    };
  }

  it('refuses it before the directory is read', async () => {
    const crafted = craftedSource();
    const reader = new ZipReader(
      new ByteSourceReader(
        crafted.source,
        DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes
      )
    );
    const err = await listZipEntriesCapped(reader).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('directory-bytes');
    expect(crafted.largestRead()).toBeLessThanOrEqual(
      DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes
    );
  });

  it('is what zip.js would otherwise read in one piece (the uncapped reader)', async () => {
    const crafted = craftedSource();
    const reader = new ZipReader(new ByteSourceReader(crafted.source));
    await listZipEntriesCapped(reader).catch(() => undefined);
    expect(crafted.largestRead()).toBeGreaterThanOrEqual(DECLARED);
  });
});
