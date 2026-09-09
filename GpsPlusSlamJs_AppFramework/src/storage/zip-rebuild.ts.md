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
  order), then the new entries. A duplicate name in the input collapses to
  its LAST occurrence (what readers resolve).
- Directory entries of the input are dropped, as every writer here does.
- A zero-entry input is valid (a freshly packed empty archive).
- Memory: carried entries are read into Blobs (off the JS heap in a
  browser), so the peak is the output archive, not the input twice over.
  The output Blob is still whole; a large recorder zip is a whole-file pass
  on a phone - callers show the progress (`done` = entries read so far,
  `total` = the output's entry count).
- **The archive's convention decides where a file lands.** In a zip whose
  entries carry a leading `./`, a new entry naming that file either way -
  with the prefix or without - replaces it IN PLACE, at the archive's own
  name. Asking that question three different ways is what let `./x` and `x`
  both be written into one archive, which every reader resolves to one file
  and none agree which (PR #439 review).
- Only the names this call INVENTS are name-checked. An entry whose path
  the input archive already carries is re-emitted verbatim
  (`assertSafeNewZipPaths` is given the others only), because refusing a
  name that was just read back out of the archive applies the module's own
  rule backwards - the live case was the coverage backfill silently
  skipping a recording whose entry is `./session.json` (PR #438 review).
- Every new entry is still checked for a **writable payload**
  (`assertWritableZipData`) and for **duplication among the new entries**
  (a local check, since the shared path checker no longer sees them all).
  A name the archive happens to carry says nothing about the bytes behind
  it.
- Existing entry names are written as they are: an archive that opened is
  accepted.
- **Validation now happens AFTER the archive is opened**, because the
  exemption above is keyed on the archive's own entry names and they are
  not known before the read. The error contract changed with it: an
  unwritable payload handed in together with an unopenable input surfaces
  as `reading the archive failed`, not as the packaging error it would have
  been when the checks ran first. Both are `ZipPackagingError`; only the
  message differs.

## Examples

```ts
const rebuilt = await rebuildZipWithEntries(hostedZip, [
  { path: qrLevelEntryName(id), data: levelJson },
  { path: TOUR_MANIFEST_ENTRY, data: serializeTourManifest(manifest) },
  { path: tourContentEntryName(photoId, 'jpg'), data: photoBlob },
]);
```

## Tests

`zip-rebuild.test.ts` - adds entries and keeps existing ones byte-identical
(including a multi-chunk entry); replaces an existing path exactly once;
STORE mode for carried and new entries (hand-rolled central-directory
reader); zero-entry input; an input with a `./` name and a duplicate name
is re-emitted; progress as entries read over the output count; throws on
an unsafe path, an unwritable payload and a non-zip input.
`zip-coverage-embed-failure.test.ts` pins the wrapper's return-the-input
contract when this module throws.
