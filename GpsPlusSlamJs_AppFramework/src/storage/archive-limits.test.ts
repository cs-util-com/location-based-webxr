import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ArchiveLimitError,
  DEFAULT_ARCHIVE_LIMITS,
  resolveArchiveLimits,
  totalBytesAllowance,
} from './archive-limits.js';

/**
 * Why these tests matter: the caps are the only thing between a crafted
 * tour zip (a "zip bomb": a few KB that inflate to gigabytes) and a
 * crashed phone tab, and they must never refuse a real recording. The
 * corpus numbers below were MEASURED on 2026-10-03 over the 219 recording
 * zips of the test corpus plus the example recordings (the measurement and
 * its sweep are in the sidecar). If a later recording exceeds one of them,
 * this suite is where the margin is re-argued - not by quietly raising a
 * cap.
 */
const CORPUS = {
  largestArchiveBytes: 270_274_051,
  mostEntries: 3_465,
  largestEntryBytes: 7_878_987,
  largestJsonEntryBytes: 210_420,
  /** Measured 2026-10-04 over 254 zips (central directories only). */
  largestDirectoryBytes: 382_065,
  /** Total decompressed / archive size: 1.0 as written (stored entries),
   *  3.78 for the largest recording re-zipped with deflate throughout. */
  worstWholeArchiveRatio: 3.78,
};

describe('DEFAULT_ARCHIVE_LIMITS against the measured corpus', () => {
  it('leaves at least a 3x margin over every real recording', () => {
    expect(DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes).toBeGreaterThanOrEqual(
      3 * CORPUS.largestArchiveBytes
    );
    expect(DEFAULT_ARCHIVE_LIMITS.maxEntries).toBeGreaterThanOrEqual(
      3 * CORPUS.mostEntries
    );
    expect(DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes).toBeGreaterThanOrEqual(
      3 * CORPUS.largestDirectoryBytes
    );
    expect(DEFAULT_ARCHIVE_LIMITS.maxEntryBytes).toBeGreaterThanOrEqual(
      3 * CORPUS.largestEntryBytes
    );
    expect(DEFAULT_ARCHIVE_LIMITS.maxTextEntryBytes).toBeGreaterThanOrEqual(
      3 * CORPUS.largestJsonEntryBytes
    );
    expect(DEFAULT_ARCHIVE_LIMITS.totalRatio).toBeGreaterThanOrEqual(
      2 * CORPUS.worstWholeArchiveRatio
    );
  });

  it('lets the largest recording decompress in full, even re-zipped with deflate', () => {
    // The total allowance is per archive; a stored recording decompresses
    // to about its own size, a deflated one to 3.78x its compressed size.
    const deflatedSize = Math.ceil(
      CORPUS.largestArchiveBytes / CORPUS.worstWholeArchiveRatio
    );
    expect(totalBytesAllowance(CORPUS.largestArchiveBytes)).toBeGreaterThan(
      CORPUS.largestArchiveBytes
    );
    expect(totalBytesAllowance(deflatedSize)).toBeGreaterThan(
      CORPUS.largestArchiveBytes
    );
  });
});

describe('totalBytesAllowance', () => {
  const limits = resolveArchiveLimits({
    totalFloorBytes: 100,
    totalRatio: 10,
    maxTotalBytes: 5_000,
  });

  it('gives a small archive the floor, so a tiny deflated tour.json still opens', () => {
    expect(totalBytesAllowance(3, limits)).toBe(100);
  });

  it('scales with the archive between floor and ceiling', () => {
    expect(totalBytesAllowance(200, limits)).toBe(2_000);
  });

  it('never exceeds the absolute ceiling, whatever the archive claims', () => {
    expect(totalBytesAllowance(1_000_000, limits)).toBe(5_000);
  });

  it('treats an unusable size as the floor (defensive: never NaN or Infinity)', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, 1.5]) {
      expect(totalBytesAllowance(bad, limits)).toBe(100);
    }
  });

  it('is monotone and bounded for any size (property)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.nat({ max: 10_000_000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const allowLo = totalBytesAllowance(lo, limits);
          const allowHi = totalBytesAllowance(hi, limits);
          expect(allowLo).toBeLessThanOrEqual(allowHi);
          expect(allowLo).toBeGreaterThanOrEqual(limits.totalFloorBytes);
          expect(allowHi).toBeLessThanOrEqual(limits.maxTotalBytes);
        }
      )
    );
  });
});

describe('resolveArchiveLimits', () => {
  it('fills omitted fields from the defaults', () => {
    const resolved = resolveArchiveLimits({ maxEntries: 7 });
    expect(resolved.maxEntries).toBe(7);
    expect(resolved.maxArchiveBytes).toBe(
      DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes
    );
  });

  it('refuses a non-positive or non-integer override instead of disabling a cap', () => {
    // A cap of 0, NaN or Infinity would either refuse everything or nothing;
    // both are configuration mistakes worth a loud failure.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 2.5]) {
      expect(() => resolveArchiveLimits({ maxEntries: bad })).toThrow(
        RangeError
      );
    }
  });
});

describe('ArchiveLimitError', () => {
  it('names the cap, its value and what was seen, in plain words', () => {
    const err = new ArchiveLimitError('archive-bytes', 1_073_741_824, 2e9);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ArchiveLimitError');
    expect(err.kind).toBe('archive-bytes');
    expect(err.limit).toBe(1_073_741_824);
    expect(err.observed).toBe(2e9);
    expect(err.message).toMatch(/too large/i);
    expect(err.message).toContain('1.0 GB');
  });

  it('words every kind without jargon', () => {
    const kinds = [
      'archive-bytes',
      'entry-count',
      'directory-bytes',
      'entry-bytes',
      'total-bytes',
    ] as const;
    for (const kind of kinds) {
      const message = new ArchiveLimitError(kind, 10).message;
      expect(message).not.toMatch(/undefined|NaN/);
      expect(message.length).toBeGreaterThan(20);
    }
  });
});
