/**
 * Reading an untrusted zip under the entry-count and decompressed-bytes
 * caps of `archive-limits.ts`.
 *
 * The decompressed cap counts the bytes zip.js ACTUALLY produces, chunk by
 * chunk, in a writer of its own: an entry's declared size is never
 * trusted, because a crafted zip can declare anything (zip.js checks
 * output against the declared size, which stops a small lie but not a
 * huge one). The archive total counts DISTINCT data: re-reading an entry
 * (the gallery, the image planes, a retry) charges only bytes beyond its
 * largest earlier read. An entry is known by WHERE its data starts (its
 * local header offset), never by its name: a crafted directory can list one
 * name thousands of times (K0 milestone review R3). Two directory records
 * whose data overlap - one offset under two names, or a shared-kernel bomb -
 * are refused by zip.js's own overlap check, so one offset never stands for
 * more than one record's data.
 */

import { type Entry, type FileEntry, type ZipReader } from '@zip.js/zip.js';

import {
  ArchiveLimitError,
  DEFAULT_ARCHIVE_LIMITS,
  resolveArchiveLimits,
  totalBytesAllowance,
  type ArchiveLimits,
} from './archive-limits.js';
import { byteCountingStream } from './byte-counting-stream.js';

/**
 * The central directory's entries, walked one at a time and refused once
 * there are more than `maxEntries` (a crafted directory can list millions;
 * the walk stops one past the cap instead of building an object for each).
 * zip.js has read the directory's BYTES whole by then - the size its end
 * record declares, in one read - so this cap does not bound them: a reader
 * with a single-read cap does (`new ByteSourceReader(source,
 * limits.maxDirectoryBytes)`, K0 milestone review R4).
 */
export async function listZipEntriesCapped(
  reader: ZipReader<unknown>,
  maxEntries: number = DEFAULT_ARCHIVE_LIMITS.maxEntries
): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const entry of reader.getEntriesGenerator()) {
    if (entries.length >= maxEntries) {
      throw new ArchiveLimitError(
        'entry-count',
        maxEntries,
        entries.length + 1
      );
    }
    entries.push(entry);
  }
  return entries;
}

function assertCap(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `DecompressionBudget: ${name} must be a positive integer, got ${String(value)}`
    );
  }
}

/** One archive's allowance of inflated bytes: per entry and in total. */
export class DecompressionBudget {
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  /** Largest number of bytes any read of each entry produced so far, by
   *  the entry's local header offset. */
  readonly #charged = new Map<number, number>();
  #total = 0;

  constructor(caps: { maxEntryBytes: number; maxTotalBytes: number }) {
    assertCap('maxEntryBytes', caps.maxEntryBytes);
    assertCap('maxTotalBytes', caps.maxTotalBytes);
    this.maxEntryBytes = caps.maxEntryBytes;
    this.maxTotalBytes = caps.maxTotalBytes;
  }

  /** The budget for an archive of `archiveSize` bytes under `limits`
   *  (defaults, with any overrides applied). */
  static forArchive(
    archiveSize: number,
    limits: Partial<ArchiveLimits> = {}
  ): DecompressionBudget {
    const resolved = resolveArchiveLimits(limits);
    return new DecompressionBudget({
      maxEntryBytes: resolved.maxEntryBytes,
      maxTotalBytes: totalBytesAllowance(archiveSize, resolved),
    });
  }

  /** Distinct inflated bytes charged so far. */
  get totalBytes(): number {
    return this.#total;
  }

  /** A read of the entry whose data starts at `offset` has produced
   *  `written` bytes so far; throws once that passes `entryCap` (the
   *  smaller of `maxEntryBytes` and the call's own cap) or the archive
   *  total. One budget serves ONE archive: two archives' offsets collide. */
  charge(offset: number, written: number, entryCap: number): void {
    if (written > entryCap) {
      throw new ArchiveLimitError('entry-bytes', entryCap, written);
    }
    const before = this.#charged.get(offset) ?? 0;
    if (written <= before) return;
    const total = this.#total + (written - before);
    if (total > this.maxTotalBytes) {
      throw new ArchiveLimitError('total-bytes', this.maxTotalBytes, total);
    }
    this.#charged.set(offset, written);
    this.#total = total;
  }
}

/**
 * Inflate one entry through a byte counter that charges the budget as each
 * chunk arrives, handing the counted stream to `consume` as a Response
 * body. zip.js writes straight into the counter's writable, so nothing is
 * collected in page memory on the way (K0 milestone review R5): a Blob is
 * assembled by `Response.blob()` (outside the JS heap in a browser).
 */
async function readCounted<T>(
  entry: FileEntry,
  budget: DecompressionBudget,
  maxEntryBytes: number | undefined,
  consume: (body: Response) => Promise<T>
): Promise<T> {
  if (maxEntryBytes !== undefined) assertCap('maxEntryBytes', maxEntryBytes);
  const cap = Math.min(budget.maxEntryBytes, maxEntryBytes ?? Infinity);
  /** The cap error, kept in case zip.js wraps the stream's abort reason. */
  let limitError: ArchiveLimitError | null = null;
  const counter = byteCountingStream((written) => {
    try {
      budget.charge(entry.offset, written, cap);
    } catch (err) {
      if (err instanceof ArchiveLimitError) limitError = err;
      throw err;
    }
  });
  // Consumed WHILE zip.js writes: the counter holds no more than its
  // queue, so an unread readable would stall the inflate.
  const consumed = consume(new Response(counter.readable));
  consumed.catch(() => undefined); // its error is the read's, thrown below
  try {
    // The overlap check is what makes the offset a sound key: a second
    // record over data another record already read is refused, never
    // charged as a free re-read.
    await entry.getData(counter.writable, { checkOverlappingEntry: true });
  } catch (err) {
    // The cap's own error wins over however zip.js reports the abort.
    throw limitError ?? err;
  }
  return consumed;
}

/** One entry inflated to a Blob of `mimeType`, under the budget (and the
 *  optional tighter `maxEntryBytes`). */
export async function readZipEntryBlob(
  entry: FileEntry,
  budget: DecompressionBudget,
  mimeType: string,
  maxEntryBytes?: number
): Promise<Blob> {
  const blob = await readCounted(entry, budget, maxEntryBytes, (body) =>
    body.blob()
  );
  // A Blob over a Blob is a reference, not a copy.
  return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
}

/** One entry inflated and decoded as UTF-8 text, under the budget (and the
 *  optional tighter `maxEntryBytes`, e.g. `maxTextEntryBytes`). Text
 *  lives on the JS heap whatever reads it, so the caller's tighter cap is
 *  what bounds it. */
export async function readZipEntryText(
  entry: FileEntry,
  budget: DecompressionBudget,
  maxEntryBytes?: number
): Promise<string> {
  return readCounted(entry, budget, maxEntryBytes, (body) => body.text());
}
