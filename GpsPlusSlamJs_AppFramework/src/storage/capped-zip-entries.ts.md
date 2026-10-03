# capped-zip-entries.ts

## Purpose

Read an untrusted zip under the entry-count and inflated-bytes caps of
`archive-limits.ts` (tour kit plan K0, cold-review finding F1). The Tour
Viewer reads every tour entry through it; `zip-reader.ts`'s action and
session readers count through it too.

## Public API

- `listZipEntriesCapped(reader, maxEntries?)`: the central directory's
  entries, walked with zip.js's `getEntriesGenerator` and refused with
  `ArchiveLimitError('entry-count')` one entry past the cap (default
  `DEFAULT_ARCHIVE_LIMITS.maxEntries`).
- `class DecompressionBudget`
  - `new DecompressionBudget({ maxEntryBytes, maxTotalBytes })` -
    `RangeError` for a cap that is not a positive safe integer.
  - `DecompressionBudget.forArchive(archiveSize, limits?)` - the per-entry
    cap and the total allowance (`totalBytesAllowance`) for one archive.
  - `totalBytes` - distinct inflated bytes charged so far.
  - `charge(key, written, entryCap)` - called by the readers below as
    bytes arrive; throws `ArchiveLimitError('entry-bytes' | 'total-bytes')`.
- `readZipEntryBlob(entry, budget, mimeType, maxEntryBytes?)` - one entry
  inflated to a Blob of the given type.
- `readZipEntryText(entry, budget, maxEntryBytes?)` - one entry inflated and
  decoded as UTF-8 (pass `maxTextEntryBytes` for JSON).

## Invariants

- **The bytes zip.js actually produces are counted** in a writer of this
  module's own (`CountingChunkWriter`); the declared `uncompressedSize` is
  never consulted. zip.js 2.11 checks output against the declared size,
  which stops a small lie (declared 100 B, inflates to 8 MiB); a huge lie
  (declared 3 GB) passes that check, and only this count stops it.
- The read stops at the first output chunk that passes the cap (the
  chunk size is the inflater's own, not zip.js's 64 KiB input chunk; the
  test shows an 8 MiB bomb stopping well before full inflation); nothing
  past the cap is delivered to the caller.
- **The total counts DISTINCT data**: a re-read of an entry (the gallery,
  the image planes, a retry) charges only bytes beyond its largest earlier
  read, so showing a photo twice never exhausts the budget.
- The cap error is rethrown as itself even when zip.js reports the
  aborted stream with an error of its own.

## Example

```ts
const reader = new ZipReader(new ByteSourceReader(opened.source));
const entries = await listZipEntriesCapped(reader);
const budget = DecompressionBudget.forArchive(opened.size);
const text = await readZipEntryText(
  manifestEntry,
  budget,
  DEFAULT_ARCHIVE_LIMITS.maxTextEntryBytes
);
```

## Tests

`capped-zip-entries.test.ts` builds real deflated zips (an 8 MiB zip bomb in
about 8 KB): the entry-count walk, ordinary text and Blob reads, the bomb
stopped at the per-entry cap long before full inflation, both declared-size
lies (small and huge), a tighter per-call cap, many small bombs stopped at
the total, re-reads not double-charged, `forArchive`, cap validation, and
the uncapped zip.js read it replaces inflating the whole bomb.
`zip-reader.test.ts` covers `loadActionsFromZip` under a budget.
