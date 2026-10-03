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
 * largest earlier read.
 */

import {
  Writer,
  type Entry,
  type FileEntry,
  type ZipReader,
} from '@zip.js/zip.js';

import {
  ArchiveLimitError,
  DEFAULT_ARCHIVE_LIMITS,
  resolveArchiveLimits,
  totalBytesAllowance,
  type ArchiveLimits,
} from './archive-limits.js';

/**
 * The central directory's entries, walked one at a time and refused once
 * there are more than `maxEntries` (a crafted directory can list millions;
 * the walk stops one past the cap instead of materialising all of them).
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
  /** Largest number of bytes any read of each entry produced so far. */
  readonly #charged = new Map<string, number>();
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

  /** A read of `key` has produced `written` bytes so far; throws once that
   *  passes `maxEntryBytes` (the smaller of it and the call's own cap) or
   *  the archive total. */
  charge(key: string, written: number, entryCap: number): void {
    if (written > entryCap) {
      throw new ArchiveLimitError('entry-bytes', entryCap, written);
    }
    const before = this.#charged.get(key) ?? 0;
    if (written <= before) return;
    const total = this.#total + (written - before);
    if (total > this.maxTotalBytes) {
      throw new ArchiveLimitError('total-bytes', this.maxTotalBytes, total);
    }
    this.#charged.set(key, written);
    this.#total = total;
  }
}

/** Collects the inflated chunks, charging the budget as each arrives. */
class CountingChunkWriter extends Writer<Uint8Array[]> {
  readonly #chunks: Uint8Array[] = [];
  readonly #onWrite: (written: number) => void;
  #written = 0;
  /** The cap error, kept in case zip.js wraps the stream's abort reason. */
  limitError: ArchiveLimitError | null = null;

  constructor(onWrite: (written: number) => void) {
    super();
    this.#onWrite = onWrite;
  }

  override writeUint8Array(array: Uint8Array): Promise<void> {
    this.#written += array.length;
    try {
      this.#onWrite(this.#written);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof ArchiveLimitError) this.limitError = error;
      return Promise.reject(error);
    }
    this.#chunks.push(array);
    return Promise.resolve();
  }

  override getData(): Promise<Uint8Array[]> {
    return Promise.resolve(this.#chunks);
  }
}

async function readChunks(
  entry: FileEntry,
  budget: DecompressionBudget,
  maxEntryBytes: number | undefined
): Promise<Uint8Array[]> {
  if (maxEntryBytes !== undefined) assertCap('maxEntryBytes', maxEntryBytes);
  const cap = Math.min(budget.maxEntryBytes, maxEntryBytes ?? Infinity);
  const writer = new CountingChunkWriter((written) => {
    budget.charge(entry.filename, written, cap);
  });
  try {
    return await entry.getData(writer);
  } catch (err) {
    // The cap's own error wins over however zip.js reports the abort.
    throw writer.limitError ?? err;
  }
}

/** One entry inflated to a Blob of `mimeType`, under the budget (and the
 *  optional tighter `maxEntryBytes`). */
export async function readZipEntryBlob(
  entry: FileEntry,
  budget: DecompressionBudget,
  mimeType: string,
  maxEntryBytes?: number
): Promise<Blob> {
  const chunks = await readChunks(entry, budget, maxEntryBytes);
  return new Blob(chunks as BlobPart[], { type: mimeType });
}

/** One entry inflated and decoded as UTF-8 text, under the budget (and the
 *  optional tighter `maxEntryBytes`, e.g. `maxTextEntryBytes`). */
export async function readZipEntryText(
  entry: FileEntry,
  budget: DecompressionBudget,
  maxEntryBytes?: number
): Promise<string> {
  const chunks = await readChunks(entry, budget, maxEntryBytes);
  const decoder = new TextDecoder();
  let text = '';
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}
