/**
 * The caps that keep a crafted archive (a "zip bomb": kilobytes that
 * inflate to gigabytes, or a directory listing millions of entries) from
 * crashing the page that opens it. Three SEPARATE caps, because each closes
 * a different door and none of them can stand in for another:
 *
 * - the TRANSPORT cap (`maxArchiveBytes`): the archive's own size, checked
 *   from `Content-Length` (or the range probe's total) before a body is
 *   fetched, and counted while a body streams when the header is missing
 *   or lies;
 * - the ENTRY-COUNT cap (`maxEntries`): entries listed in the central
 *   directory, counted while it is walked - after zip.js has read the
 *   directory its end record DECLARES in one piece, which the
 *   DIRECTORY cap (`maxDirectoryBytes`, the largest single read the zip
 *   reader may make) bounds first;
 * - the DECOMPRESSED cap (`maxEntryBytes`, `maxTextEntryBytes` and the
 *   per-archive total): bytes ACTUALLY produced by inflating, counted while
 *   they stream. The size an entry DECLARES is never trusted - a crafted
 *   zip can declare anything.
 *
 * The values rest on a measurement of every real recording on 2026-10-03
 * (see the sidecar for the numbers and the sweep). Pure: no I/O.
 */

import { formatFileSize } from '../utils/format-file-size.js';

export interface ArchiveLimits {
  /** The whole archive, in bytes (transport). */
  readonly maxArchiveBytes: number;
  /** Entries in the central directory (files and folders). */
  readonly maxEntries: number;
  /** The largest single read the zip reader may make. zip.js reads the
   *  central directory (and each zip64 record) in ONE read of the size the
   *  end record declares, before any entry is counted; entry data comes in
   *  64 KiB chunks. So this bounds the directory a crafted end record can
   *  make the page read (K0 milestone review R4). */
  readonly maxDirectoryBytes: number;
  /** Bytes one entry may inflate to, counted while streaming. */
  readonly maxEntryBytes: number;
  /** Tighter per-entry cap for entries parsed as text (`tour.json`,
   *  `qr/*.json`): a string lives on the JS heap, a Blob need not. */
  readonly maxTextEntryBytes: number;
  /** Total inflated bytes per archive: `totalRatio` times the archive's
   *  size, at least `totalFloorBytes`, never above `maxTotalBytes`. */
  readonly totalRatio: number;
  readonly totalFloorBytes: number;
  readonly maxTotalBytes: number;
}

const MiB = 1024 * 1024;

/**
 * Measured 2026-10-03 (219 recordings): the largest archive is 270 MB,
 * the most entries 3,465, the largest entry 7.9 MB, the largest JSON entry
 * 210 KB, and the whole-archive inflation ratio 1.0 as recorded (stored
 * entries) or 3.78 for the largest recording re-zipped with deflate.
 * Measured 2026-10-04 (254 zips, central directories only): the largest
 * directory is 382,065 bytes (3,465 entries, 110 bytes each).
 */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = Object.freeze({
  maxArchiveBytes: 1024 * MiB,
  maxEntries: 20_000,
  maxDirectoryBytes: 16 * MiB,
  maxEntryBytes: 256 * MiB,
  maxTextEntryBytes: 16 * MiB,
  totalRatio: 20,
  totalFloorBytes: 64 * MiB,
  maxTotalBytes: 2048 * MiB,
});

/** The defaults with `overrides` applied. Every override must be a
 *  positive safe integer (the ratio a positive finite number): a cap of 0,
 *  NaN or Infinity would refuse everything or nothing, which is a
 *  configuration mistake, not a policy. */
export function resolveArchiveLimits(
  overrides: Partial<ArchiveLimits> = {}
): ArchiveLimits {
  const resolved = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(resolved)) {
    const valid =
      key === 'totalRatio'
        ? Number.isFinite(value) && value > 0
        : Number.isSafeInteger(value) && value > 0;
    if (!valid) {
      throw new RangeError(
        `archive limit ${key} must be a positive ${
          key === 'totalRatio' ? 'number' : 'integer'
        }, got ${String(value)}`
      );
    }
  }
  return Object.freeze(resolved);
}

/** How many inflated bytes an archive of `archiveSize` bytes may produce
 *  in total. An unusable size (NaN, negative, fractional, infinite) gets
 *  the floor: the allowance is never NaN or unbounded. */
export function totalBytesAllowance(
  archiveSize: number,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
): number {
  const size =
    Number.isSafeInteger(archiveSize) && archiveSize >= 0 ? archiveSize : 0;
  return Math.min(
    limits.maxTotalBytes,
    Math.max(limits.totalFloorBytes, Math.floor(size * limits.totalRatio))
  );
}

export type ArchiveLimitKind =
  | 'archive-bytes'
  | 'entry-count'
  | 'directory-bytes'
  | 'entry-bytes'
  | 'total-bytes';

function describeLimit(kind: ArchiveLimitKind, limit: number): string {
  switch (kind) {
    case 'archive-bytes':
      return `The file is too large to open here (the limit is ${formatFileSize(limit)}).`;
    case 'entry-count':
      return `The file holds too many files to open here (the limit is ${String(limit)}).`;
    case 'directory-bytes':
      return `The zip's list of contents is too large to open here (the limit is ${formatFileSize(limit)}).`;
    case 'entry-bytes':
      return `A file inside the zip is too large once unpacked (the limit is ${formatFileSize(limit)}).`;
    case 'total-bytes':
      return `The zip unpacks to too much data to open here (the limit is ${formatFileSize(limit)}).`;
  }
}

/** A cap was hit. The message is plain words a visitor can read; `kind`,
 *  `limit` and `observed` (when known) are for code and logs. */
export class ArchiveLimitError extends Error {
  override readonly name = 'ArchiveLimitError';
  readonly kind: ArchiveLimitKind;
  readonly limit: number;
  readonly observed: number | undefined;

  constructor(kind: ArchiveLimitKind, limit: number, observed?: number) {
    super(describeLimit(kind, limit));
    this.kind = kind;
    this.limit = limit;
    this.observed = observed;
  }
}
