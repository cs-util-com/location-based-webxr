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

- **The bytes zip.js actually produces are counted** in a pass-through
  stream (`byte-counting-stream.ts`) that zip.js writes into; the declared
  `uncompressedSize` is never consulted. zip.js 2.11 checks output against the declared size,
  which stops a small lie (declared 100 B, inflates to 8 MiB); a huge lie
  (declared 3 GB) passes that check, and only this count stops it.
- The read stops at the first output chunk that passes the cap (the
  chunk size is the inflater's own, not zip.js's 64 KiB input chunk; the
  test shows an 8 MiB bomb stopping well before full inflation); nothing
  past the cap is delivered to the caller.
- **The total counts DISTINCT data**: a re-read of an entry (the gallery,
  the image planes, a retry) charges only bytes beyond its largest earlier
  read, so showing a photo twice never exhausts the budget.
- **An entry is known by its local header OFFSET, never its name** (K0
  milestone review R3): a crafted directory can list one name thousands of
  times, each copy its own data, and keyed by name every copy after the
  first was free. One budget therefore serves ONE archive (several
  readers of the same bytes agree on offsets; two archives collide).
- **Two records over one payload are refused**, not charged as a re-read:
  every read passes zip.js's `checkOverlappingEntry`, so one offset under
  two names, or the shared-kernel bomb, fails with zip.js's
  `ERR_OVERLAPPING_ENTRY` before inflating. Without it, keying on the
  offset would have made thousands of records at ONE offset free.
- The cap error is rethrown as itself even when zip.js reports the
  aborted stream with an error of its own.
- **Nothing is collected in page memory** (K0 milestone review R5): zip.js
  writes into the counter's writable (`getData` accepts a
  `WritableStream`), and the counter's readable feeds
  `Response.blob()` (a browser assembles it outside the JS heap) or
  `Response.text()`. A stream was possible, so no Blob-from-parts writer
  was needed. Text still lands on the heap whatever reads it; the caller's
  tighter cap (`maxTextEntryBytes`) is what bounds it.

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
stopped at the per-entry cap long before full inflation, the declared-size
lies (understated above the cap: the cap fires before zip.js's own check
would; understated below it: zip.js's check fires first, pinned so an
upgrade that drops it is noticed; huge), a tighter per-call cap, many small bombs stopped at
the total, duplicate NAMES charged separately, two records at one offset
refused, re-reads not double-charged, `forArchive`, cap validation, and
the uncapped zip.js read it replaces inflating the whole bomb.
`zip-reader.test.ts` covers `loadActionsFromZip` under a budget.
