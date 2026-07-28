# `rules/csv.ts`

## Purpose

A minimal RFC 4180 CSV reader. Written rather than depended on, because
production code here has exactly one runtime dependency (§4.2) — but explicitly
**not** as small as `split("\n").map(l => l.split(","))`.

## Public API

- `parseCsv(text): string[][]` — rows of raw fields. **Throws** `CsvParseError`
  on input ending inside an unterminated quote.
- `parseCsvObjects(text)` → `{ header, rows, malformed }` — header-keyed records
  plus a list of rows whose field count disagreed with the header.
- `CsvParseError`

## Invariants & assumptions

- **Quoted fields may contain newlines, and this is not hypothetical.** The
  published rule sheet's `Count` column holds values like `"6 109 792\n30.12%"`,
  so its 729 rows span **1456 physical lines**. A line-splitting reader produces
  ~1456 broken rows, and because the breakage lands mid-quote the damage looks
  like data rather than like a parse error.
- Handles escaped quotes (`""`), embedded commas, LF and CRLF.
- **Empty fields are preserved.** The real sheet's `w` column is entirely empty;
  collapsing it would shift every later column left by one.
- A trailing newline does not manufacture an empty final row; a final row
  without a newline is still emitted.
- **Unterminated quotes are rejected, not tolerated.** After one, every field
  boundary is a guess, so a lenient parser emits plausible wrong rows — and a
  rule table parsed wrongly scores every cell at the identity, which reads as
  "nothing is mapped here".
- **Short rows are reported, never padded.** Guessing which column is missing is
  how a rule ends up keyed on a `Description`.
- No trimming: trailing spaces can be meaningful, and a caller that wants them
  gone can say so.

## Tests

`csv.test.ts` — the embedded-newline case first, since it is the one that
matters; embedded commas; escaped quotes; CRLF; empty fields; trailing-newline
handling; unterminated-quote rejection; and `parseCsvObjects` header mapping plus
malformed-row reporting with line numbers.
