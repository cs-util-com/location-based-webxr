# zip-entry-path.ts

## Purpose

Shared safety validation for any code that writes a ZIP archive entry at a
caller- or author-supplied path: rejects path shapes that either escape the
archive or silently collide with another entry.

## Public API

- `assertSafeZipEntryPaths(paths: readonly string[], reserved?: readonly string[]): void`
  - Throws an `Error` listing every problem found (not just the first) if any
    `path` is empty, absolute, drive-lettered, contains a backslash, escapes
    via a `..` segment, collides with a `reserved` name, or duplicates another
    path in `paths`.
  - No-op (returns) when every path is safe and unique.

## Invariants & assumptions

- Pure — no filesystem or ZIP-library dependency, so any writer can call it
  before touching bytes.
- `reserved` is for paths the caller already writes for another purpose (e.g.
  a manifest at the archive root) that a declared entry must not shadow.
- Duplicate detection is on the raw `path` string; case-sensitivity and
  normalization are the caller's responsibility.

## Examples

```ts
assertSafeZipEntryPaths(
  entries.map((e) => e.path),
  ['tour.json'] // the manifest path this archive also writes
);
```

## Tests

`zip-entry-path.test.ts` — one behavior per case: empty path, reserved-name
collision, traversal/absolute/drive-letter/backslash paths, duplicate paths,
and that multiple problems are named in one error.
