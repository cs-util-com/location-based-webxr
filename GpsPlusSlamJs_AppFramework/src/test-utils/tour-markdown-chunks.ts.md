# tour-markdown-chunks.ts

**Purpose:** the one alphabet of marks the tour Markdown long-body tests repeat into bodies, shared by `ar/tour-markdown.property.test.ts` and `ar/tour-markdown.linearity.test.ts` so the two cannot drift apart.

## Public API

- `TOUR_MARKDOWN_CHUNK_ALPHABET`: `#*_-+>[]()!\` plus a space, a newline, `.`, `1`, `a` and `z`; the block and inline marks of the accepted subset (the code span's backtick, the table's pipe, `<`, `&`, `~`, `^` and a setext `=` are not in it, so the long-body properties do not search those scanners), with enough plain text between them to open and close blocks.

## Invariants

- Test-only: imported by tests, never by production code.
- A change to it changes what both suites search; re-measure the linearity properties' run time when adding marks.

## Tests

- None of its own: it is a constant, exercised by the two suites above.
