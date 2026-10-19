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

## Invariants & assumptions

- Every read goes through the framework's caps: the central directory under
  `DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes` and `maxEntries`, the entry
  inflated under a `DecompressionBudget` sized from the blob. The blob is
  this page's own output, but the same caps keep one rule for all archives.
- Errors: bytes that are not a zip, or past a cap, reject; a name the zip
  lacks rejects with an error naming it (never an empty Blob).
- The reader is closed on every path.

## Examples

```ts
const names = await zipBlobEntryNames(lastSave);
const picture = await readZipBlobEntry(lastSave, "content/f.jpg");
```

## Tests

`zip-blob.test.ts`: names in archive order and one entry's bytes; a
missing name and non-zip bytes refused.
