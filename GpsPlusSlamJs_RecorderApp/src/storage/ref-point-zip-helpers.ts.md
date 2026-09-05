# `ref-point-zip-helpers.ts`

## Purpose

Shared helpers for reading reference-point JSON entries out of session
ZIPs. Centralises the parse / validate / error-collection loop for its two
callers, `ref-point-recovery.ts` and `ref-point-loader.ts`. (A third,
`ref-point-importer.ts`, was deleted 2026-09-04 - no production caller.)

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

- No direct test; `ref-point-recovery.test.ts`,
  `ref-point-recovery.property.test.ts` and `ref-point-loader.test.ts`
  exercise it through its callers (round-trip ZIP → parse → validate →
  transform, plus malformed-JSON / invalid-schema / IO-error paths).
