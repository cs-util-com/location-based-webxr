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

## Invariants & assumptions

- Little-endian offsets per the ZIP specification (APPNOTE 4.3.7 and
  4.3.12); no ZIP64, no encryption, no data descriptors beyond what
  zip.js emits in store mode - it reads what this package writes.
- Test-only: not exported from any barrel and not a tsdown entry.

## Tests

Used by `storage/pack-files-as-zip.test.ts` and `storage/zip-rebuild.test.ts`.
