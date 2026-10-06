# code-book.ts

## Purpose

One model of every code of the open tour that authoring reads AND writes
(code book refactor plan
`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
M1). It replaces the single "code in hand" slot (`ctx.mintedLevel`,
`ctx.codeMeasurement`, `ctx.visitCodeSighting`), which let a Finish write
one code and routed every authoring decision through one code. Keyed by
level id, like every other code map in the stack (`qr-level-archive.ts`).
Pure and immutable.

## Public API

- `TourCode` (module-private until M4 wires the book) `{ levelId, saved, hosted, measurement, reference,
finished }`:
  - `saved` - the level text visitors get after the next Finish;
  - `hosted` - the hosted zip's text (null: not in the zip, or the levels
    have not arrived);
  - `measurement` - this page's measurement (visit, pose, printed size);
  - `reference` - this page took the code as a reference (measured, kept
    as a stored pose, or restored): what the placement gate and the hints
    read;
  - `finished` - the text this page's last Finish wrote: saved, although
    the hosted zip only changes once the creator uploads the file.
- `type CodeBook = ReadonlyMap<levelId, TourCode>`; `LevelText { id, json }`.
- `openCodeBook({ hosted, draft? })` - the hosted levels saved as they are;
  a restored draft's codes on top, saved and taken as references.
- `withHosted(book, hosted)` - hosted texts that arrive after a restore.
- `withMeasurement(book, level, measurement)` - a code measured here.
- `withReference(book, levelId)` - a stored code taken as reference.
- `withSaved(book, level)` - a settle's re-mint or improvement.
- `codesToWrite(book)` - what a Finish writes (and what the save guard
  calls unsaved): `saved` differing from both `hosted` and `finished`.
- `afterFinish(book, written)` - those texts are now saved.
- `referenceCodes(book)` - ids taken as references.

## Invariants & assumptions

- Never writes a code whose saved text equals the hosted file or the last
  Finish's (property test); a Finish always leaves nothing to write.
- Every measured code is a reference.
- Text identity, not parsed equality: a level re-serialized differently is
  written again (harmless: the Finish replaces the file in place).
- Not wired yet in M1; M4 replaces the slot with it.

## Examples

```ts
let book = openCodeBook({ hosted: levelTexts });
book = withMeasurement(book, { id, json }, measurement);
const entries = codesToWrite(book); // every changed code
book = afterFinish(book, entries);
```

## Tests

`code-book.test.ts`: opening (hosted, draft, draft identical to hosted), a
restore before the levels arrive, measuring one and two codes, references,
the settle's update, the Finish, and two properties over random sequences
of measure / save / reference / finish.
