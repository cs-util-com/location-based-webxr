# `ref-point-zip-helpers.ts`

## Purpose

Shared helpers for reading reference-point JSON entries out of session
ZIPs. Centralises the parse / validate / error-collection loop that
`ref-point-importer.ts` and `ref-point-recovery.ts` previously each
open-coded.

## Public API

- `isZipFileName(name): boolean` — case-insensitive `.zip` extension test.
- `isRefPointEntry(entryPath): boolean` — true for `refPoints/{id}.json`.
- `isRefPointDefinitionShape(value): value is RefPointDefinition` — base
  shape check (`id`/`name`/`createdAt`/`observations[]`). Stricter callers
  layer additional per-observation predicates on top.
- `extractRefPointEntriesFromZip<T>(zipBlob, zipFileName, validate, toItem)
: Promise<{ items: T[]; errors: string[] }>` — walk the ZIP, validate via
  the supplied predicate, transform via `toItem`. `toItem` may return
  `null` to silently drop a record. Errors are collected as
  `"<zipFileName>/<entry>: <reason>"` strings; the underlying `ZipReader`
  is always closed.

## Invariants & assumptions

- Directory entries are always skipped (no `getData`).
- `toItem(null)` is treated as a silent drop, not an error.
- The ZIP reader is closed even when the loop throws.

## Examples

```ts
const { items, errors } = await extractRefPointEntriesFromZip(
  zipBlob,
  zipFileName,
  isValidRefPointDefinition, // local stricter predicate
  (def) => toImportedRefPoint(def, zipFileName) // may return null
);
```

## Tests

- `ref-point-importer.test.ts` and `ref-point-recovery.test.ts` exercise
  this module end-to-end (round-trip ZIP → parse → validate → transform,
  plus malformed-JSON / invalid-schema / IO-error paths).
