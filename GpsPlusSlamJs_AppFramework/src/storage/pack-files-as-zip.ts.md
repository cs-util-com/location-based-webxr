# pack-files-as-zip.ts

## Purpose

Write a set of in-memory entries (text, bytes or Blobs at caller-supplied
paths) into an uncompressed (STORE-mode) zip Blob. The one store-mode writer
for archives built from bytes the caller already holds; `zip-rebuild.ts`
and `zip-coverage-embed.ts` write through it, and the Tour Viewer's starter
zip is a one-entry call. Absorbed from community PR #321 and hardened per
its private review (2026-08-26).

## Public API

- `packFilesAsZip(entries: readonly ZipEntryInput[]): Promise<Blob>`
  - Returns an `application/zip` Blob with every entry written at its
    path, method STORE (`level: 0`). An empty list yields a valid empty
    archive.
  - Throws `ZipPackagingError` when any path is unsafe, colliding or
    duplicated (see [zip-entry-path.ts](zip-entry-path.ts.md); checked
    BEFORE any bytes are written) or when the underlying writer fails
    (the partial archive is abandoned, never returned).
- `interface ZipEntryInput { path: string; data: Blob | Uint8Array | string }`
- `class ZipPackagingError extends Error` - `cause` carries the original.
- `assertWritableZipEntries(entries, caller)` - the pre-write checks, and
  a composition of the two below. Use it unless a caller needs only one
  half.
- `assertSafeNewZipPaths(entries, caller)` - the NAME half: paths through
  `assertSafeZipEntryPaths`, i.e. shape, traversal and duplication.
- `assertWritableZipData(entries, caller)` - the PAYLOAD half: every
  payload a string, `Uint8Array` or `Blob` - an `undefined` from
  `JSON.stringify` of an unserialisable value is caught here, before any
  write.
- The split exists because `zip-rebuild.ts` must relax the name rules for
  a name it read out of the input archive, while keeping every payload
  rule. Filtering those entries out of the composed assertion skipped both
  halves, which is the hole this shape removes (PR #438 review).
- `writeStoreZip(entries, caller)` - the writer WITHOUT validation, for a
  caller that validated its own inputs (`zip-rebuild.ts` validates only
  its new entries).

## Invariants & assumptions

- Built on `@zip.js/zip.js` (`ZipWriter` + `BlobWriter`), the library
  every other zip module here uses.
- Path safety is delegated entirely to `assertSafeZipEntryPaths`; this
  module adds only the payload-type check. There are no reserved names (a
  manifest is an ordinary entry, which is what lets the rebuild replace it
  by path).
- Entries are written in list order; the central directory preserves it.
- No compression ever: a range reader depends on `compressedSize ===
uncompressedSize` per entry.

## Examples

```ts
const starter = await packFilesAsZip([
  { path: 'tour.json', data: serializeTourManifest(createEmptyTourManifest()) },
]);
```

## Tests

`pack-files-as-zip.test.ts` - text/binary entries round-trip through a real
zip read; STORE mode verified from the bytes by the hand-rolled
central-directory reader in `test-utils/zip-central-directory.ts`
(independent of zip.js); the empty list; unsafe and duplicate paths
rejected before writing, and so is an `undefined` payload; a mid-write
failure surfaced as `ZipPackagingError`.
