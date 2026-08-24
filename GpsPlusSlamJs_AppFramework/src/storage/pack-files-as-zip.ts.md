# pack-files-as-zip.ts

## Purpose

Bundle a JSON manifest plus a set of Blobs into an uncompressed ZIP, entries
keyed by caller-supplied paths. The generic counterpart to `zip-export.ts`'s
OPFS-session export: this module knows nothing about what the manifest or
files mean, only that the archive it produces is well-formed.

## Public API

- `packFilesAsZip(manifest: ZipManifest, entries: readonly ZipManifestEntry[]): Promise<Blob>`
  - Returns an `application/zip` Blob containing `manifest.json` written at
    `manifest.path`, plus every `entries[i].file` written at `entries[i].path`.
  - Every entry is STORE mode (`level: 0`) — no DEFLATE — so a range-reading
    consumer can slice an entry out as plain bytes.
  - Throws `ZipPackagingError` if any entry path collides with `manifest.path`,
    duplicates another entry path, or is otherwise unsafe (see
    [zip-entry-path.ts](zip-entry-path.ts.md)). Checked before any bytes are
    written, so a rejected call never produces a partial archive.
- `type ZipManifest` — `{ path: string; json: unknown }`.
- `type ZipManifestEntry` — `{ path: string; file: Blob }`.
- `class ZipPackagingError extends Error`.

## Invariants & assumptions

- Built on `@zip.js/zip.js` (`BlobWriter`/`ZipWriter`/`TextReader`/`BlobReader`),
  matching the library already used for both writing (`zip-export.ts`) and
  reading (`zip-reader.ts`) ZIPs elsewhere in this package.
- Does not validate `manifest.json`'s shape — callers own their own schema.
- Path safety is delegated entirely to `assertSafeZipEntryPaths`; this module
  adds no path rules of its own.

## Examples

```ts
const blob = await packFilesAsZip({ path: 'tour.json', json: tour }, [
  { path: 'assets/a.png', file: pngFile },
]);
```

## Tests

`pack-files-as-zip.test.ts` — manifest + entries round-trip through a real
ZIP read, STORE-mode verified against a hand-rolled central-directory parser
(deliberately independent of `@zip.js/zip.js`, so a shared misreading of the
format can't cancel out), and the manifest-collision / duplicate-path error
paths.
