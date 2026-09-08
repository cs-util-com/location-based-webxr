# zip-entry-path.ts

## Purpose

The one rule set for ZIP entry paths that come from a caller or an author:
rejects shapes that escape the archive, name a directory instead of a file,
or silently collide with another entry. Absorbed from community PR #321 and
hardened per its private review (2026-08-26): `.` segments, empty segments
and trailing slashes are rejected too, and the reserved names are validated
with the same rules instead of being trusted.

## Public API

- `assertSafeZipEntryPaths(paths: readonly string[], reserved?: readonly string[]): void`
  - Throws an `Error` naming EVERY problem (not just the first) when any
    `path` is empty, absolute, drive-lettered, contains a backslash, ends
    with `/`, contains a `.`, `..` or empty segment, collides with a
    `reserved` name, or duplicates another path in `paths`; or when a
    `reserved` name is itself unsafe.
  - Returns (no-op) when every path is safe and unique.

## Invariants & assumptions

- Pure: no filesystem or zip-library dependency, so every writer can call
  it before touching bytes.
- Duplicate detection is on the raw string; case folding and Unicode
  normalisation are the caller's concern (zip.js writes the bytes it is
  given).
- Callers in this package: `zip-export.ts` (each contributor path),
  `pack-files-as-zip.ts` (the whole entry list), and through it
  `zip-rebuild.ts`. A writer that keeps its own inline checks is the drift
  this module exists to end.

## Examples

```ts
assertSafeZipEntryPaths(
  entries.map((e) => e.path),
  ['tour.json'] // the manifest path this archive also writes
);
```

## Tests

- `zip-entry-path.test.ts` - one case per rejected shape, the reserved-name
  collision, the validated reserved name, duplicates, and the
  every-problem-in-one-error contract.
- `zip-entry-path.property.test.ts` - generated safe paths always pass;
  any spliced forbidden shape always fails; a repeated path fails however
  the list is ordered.
