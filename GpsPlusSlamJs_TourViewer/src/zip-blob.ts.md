# zip-blob.ts

## Purpose

Reads a zip held in memory (a Blob this page built, such as the desktop
editor's last save): its entry names, and one entry's bytes. Used by the
editor session for a deleted photo's picture when the opened file no longer
reads (M4a review #5), and for "move the walk out" (tour editor plan
2026-10-17-1816, W2, D19), which must know every entry the newest bytes
carry.

## Public API

- `zipBlobEntryNames(blob): Promise<string[]>` - the file entries' names
  in archive order; directory entries left out.
- `readZipBlobEntry(blob, name): Promise<Blob>` - one entry's bytes by its
  exact name (wrap prefix included).

- `withZipBlobDirectory(blob, use): Promise<T>` - one directory read
  handed to `use` as `{ names, sizeOf(name), read(name, maxEntryBytes?) }`
  (valid only inside `use`; the reader closes after it). `names` lists a
  name the zip carries twice twice, so a caller can refuse the ambiguity;
  `sizeOf` and `read` use the first entry of such a name. `maxEntryBytes`
  caps what one read inflates (the framework's `readZipEntryBlob` cap,
  an `ArchiveLimitError` of kind `"entry-bytes"` past it), below the
  archive's budget, for an entry a caller wants small. Every read of one
  directory is charged to ONE decompression budget (the framework's rule:
  one budget per archive), so many reads cannot each inflate the whole
  allowance. Reads only the directory's
  bytes plus what `use` reads, so it suits a large File too: the editor's
  file classifier (`editor/classify-editor-file.ts`) sorts a scan by it
  without reading the scan.

## Invariants & assumptions

- Every read goes through the framework's caps: the central directory
  opened by the framework's one capped open (`withCappedZipEntries` of
  `storage/zip-reader`) under `DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes`
  and `maxEntries`, the entry
  inflated under a `DecompressionBudget` sized from the blob. The blob is
  this page's own output, but the same caps keep one rule for all archives.
- Errors: bytes that are not a zip, or past a cap, reject; a name the zip
  lacks rejects with an error naming it (never an empty Blob).
- The reader is closed on every path (by `withCappedZipEntries`).

## Examples

```ts
const names = await zipBlobEntryNames(lastSave);
const picture = await readZipBlobEntry(lastSave, "content/f.jpg");
```

## Tests

`zip-blob.test.ts`: names in archive order and one entry's bytes; a
missing name and non-zip bytes refused; the directory's names, sizes and
one read, and a missing entry refused through it; a read capped by
`maxEntryBytes` stopped near the cap (an entry deflated from 8 MiB,
the bytes inflated measured); a name carried twice listed twice.
