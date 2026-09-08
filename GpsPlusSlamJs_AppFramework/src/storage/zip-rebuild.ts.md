# zip-rebuild.ts

## Purpose

Produce a new uncompressed zip from an existing one plus entries added or
replaced by path, keeping every other entry byte-identical. The Tour
Viewer's finish step writes `qr/<id>.json`, `tour.json` and captured photos
into the zip the creator hosted; `zip-coverage-embed.ts` is a wrapper over
this for its `session.json` rewrite (one re-emit loop in the package,
DEC-H3).

## Public API

- `rebuildZipWithEntries(zip: Blob, entries: readonly ZipEntryInput[], options?: RebuildZipOptions): Promise<Blob>`
  - Reads every file entry of `zip`, drops those whose path is in
    `entries`, and writes the rest plus `entries` through
    `packFilesAsZip` (STORE mode).
  - Throws `ZipPackagingError` when `zip` is not a readable archive, when a
    new path is unsafe or duplicated, or when writing fails. It NEVER
    returns the input: a caller about to upload the result must not be
    handed the old archive as if it were new.
- `interface RebuildZipOptions { onProgress?(done, total) }` - called after
  each carried-over entry is read and once more at `total/total` after the
  write.

## Invariants & assumptions

- Untouched entries are re-emitted from their uncompressed bytes, so their
  content is byte-identical; entry ORDER is carried entries first (input
  order), then the new entries.
- Directory entries of the input are dropped, as every writer here does.
- A zero-entry input is valid (a freshly packed empty archive).
- The output Blob is whole in memory; entries stream in one at a time. A
  large recorder zip is a whole-file pass on a phone - callers show the
  progress.
- Path rules come from `zip-entry-path.ts`; existing entry names are NOT
  re-validated (an archive that opened is accepted as it is).

## Examples

```ts
const rebuilt = await rebuildZipWithEntries(hostedZip, [
  { path: qrLevelEntryName(id), data: levelJson },
  { path: TOUR_MANIFEST_ENTRY, data: serializeTourManifest(manifest) },
  { path: tourContentEntryName(photoId, 'jpg'), data: photoBlob },
]);
```

## Tests

`zip-rebuild.test.ts` - adds entries and keeps existing ones byte-identical;
replaces an existing path exactly once; STORE mode for carried and new
entries (hand-rolled central-directory reader); zero-entry input; progress
reporting; throws on an unsafe path and on a non-zip input.
