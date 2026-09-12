# zip-central-directory.ts (test utility)

## Purpose

A hand-rolled ZIP central-directory reader for tests, deliberately
independent of `@zip.js/zip.js`: the store-mode contract the range readers
depend on is verified from the bytes, so a shared misreading of the format
between the library's writer and reader cannot cancel out. Kept from
community PR #321's packer test.

## Public API

- `readStoredCentralDirectory(bytes: Uint8Array): StoredCentralEntry[]` -
  walks the end-of-central-directory record and every central header;
  cross-checks each local header's signature and method. Throws on a
  missing EOCD, a corrupt central header or a missing local header.
- `interface StoredCentralEntry { name; stored; compressedSize; uncompressedSize }`
  - `stored` is true only when BOTH the central and the local header say
    method 0.
- `readStoredEntryBytes(bytes: Uint8Array, name: string): Uint8Array | undefined`
  - one entry's CONTENT by name, or `undefined` when the archive has no
    such entry. STORE MODE ONLY: it throws on a deflated entry rather
    than returning compressed bytes that a test would then assert
    against. Checks the local header's RANGE and then its signature
    before reading anything at that offset, so a ZIP64 archive (whose
    central record holds `0xFFFFFFFF` there) gets a sentence rather than
    a bounds error. Range first is load-bearing and not belt-and-braces:
    a signature read at `0xFFFFFFFF` throws `RangeError` before it can be
    compared, so until 2026-09-12 this guard could not fire for the one
    case it names. Both readers share the check.
  - Added so a test can assert what an archive CARRIES rather than what
    was handed to the writer.

## Invariants & assumptions

- Little-endian offsets per the ZIP specification (APPNOTE 4.3.7 and
  4.3.12); no ZIP64, no encryption, no data descriptors beyond what
  zip.js emits in store mode - it reads what this package writes.
- Test-only: not exported from any barrel. It IS a tsdown entry, per
  file, because the `./test-utils/*` wildcard export only resolves what
  the build emits - this file was advertised and unbuilt until
  2026-09-11, so no sibling package could import it.

## Tests

`zip-central-directory.test.ts` covers the offset guards directly: a
central record carrying the ZIP64 sentinel must report the layout rather
than a `RangeError`, and an in-range offset that is simply not a local
header must still report itself.

Used by `storage/pack-files-as-zip.test.ts` and `storage/zip-rebuild.test.ts`
in this package, and across the workspace by the Tour Viewer's
`creator-finish.test.ts`, which asserts the entry PATHS and the manifest
CONTENT of a rebuilt tour archive.
