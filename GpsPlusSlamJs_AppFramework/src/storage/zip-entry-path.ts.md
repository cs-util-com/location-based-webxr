# zip-entry-path.ts

## Purpose

The one rule set for ZIP entry paths that come from a caller or an author:
rejects shapes that escape the archive, name a directory instead of a file,
or silently collide with another entry. Absorbed from community PR #321 and
hardened per its private review (2026-08-26): `.` segments, empty segments
and trailing slashes are rejected too.

## Public API

- `assertSafeZipEntryPaths(paths: readonly string[]): void`
  - Throws an `Error` naming EVERY problem (not just the first) when any
    `path` is empty, absolute, drive-lettered, contains a backslash, ends
    with `/`, contains a `.`, `..` or empty segment, or duplicates
    another path in `paths`.
  - Returns (no-op) when every path is safe and unique.
  - The PR's `reserved` parameter is gone (M1 review #13): a manifest is
    an ordinary entry (DEC-N12) and nothing in production passed one.

## Invariants & assumptions

- Pure: no filesystem or zip-library dependency, so every writer can call
  it before touching bytes.
- Duplicate detection is on the raw string; case folding and Unicode
  normalisation are the caller's concern (zip.js writes the bytes it is
  given).
- Callers in this package: `zip-export.ts` (each contributor's COMPOSED
  `subdir/relativePath`), `pack-files-as-zip.ts` (the whole entry list)
  and `zip-rebuild.ts` (its new entries only; an opened archive's own
  names are not re-judged). A writer that keeps its own inline checks is
  the drift this module exists to end.

## Examples

```ts
assertSafeZipEntryPaths(entries.map((e) => e.path));
```

## Tests

- `zip-entry-path.test.ts` - one case per rejected shape, duplicates, and
  the every-problem-in-one-error contract.
- `zip-entry-path.property.test.ts` - generated safe paths (spaces,
  inner dots, non-ASCII letters, punctuation) always pass; any spliced
  forbidden shape always fails; a repeated path fails however the list is
  ordered.
