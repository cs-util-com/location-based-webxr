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

- `TourCode` (module-private until M4 wires the book) `{ levelId, saved,
hosted, measurement, reference, finished }`:
  - `saved` - the level text visitors get after the next Finish;
  - `hosted` - the hosted zip's text (`TourSession.levelTexts`, kept at
    open). Null means one of: the zip has no file for the code, the levels
    have not arrived yet (a draft restored early), or the file could not be
    read - in every case the safe direction is to write;
  - `measurement` - this page's measurement (visit, pose, printed size);
  - `reference` - this page took the code as a reference (measured, kept
    as a stored pose, or restored): what the placement gate and the hints
    read;
  - `finished` - the text this page's last Finish wrote.
- `type CodeBook = ReadonlyMap<levelId, TourCode>`; `LevelText { id, json }`.
- `openCodeBook({ hosted, draft? })` - the hosted levels saved as they are,
  then `withDraft`.
- `withDraft(book, draft)` - a restored draft's codes, saved and taken as
  references - except a code this page already changed live (a
  measurement, or a saved pose differing from the zip's): that is newer
  and wins. Restoring is a tap on an offer that comes after the open.
- `withHosted(book, hosted)` - hosted texts that arrive after a restore.
- `withMeasurement(book, level, measurement)` - a code measured here.
- `withoutMeasurement(book, levelId)` - a code to be measured again (a new
  printed size): measurement and reference dropped, the saved pose back to
  what the zip holds.
- `withReference(book, levelId)` - a stored code taken as reference.
- `withSaved(book, level)` - a settle's re-mint or improvement.
- `codesNotHosted(book)` - what the on-device draft keeps (M4c-1): a
  saved pose the HOSTED zip does not hold yet, a Finish's among them - a
  Finish's zip reaches the world only when the creator uploads it.
- `codesToWrite(book)` - what a Finish writes (and what the save guard
  calls unsaved): a saved pose that differs from the BASELINE, the text
  the zip the next Finish rebuilds from holds - `finished ?? hosted`
  (after a Finish the next one builds on that Finish's file, not on the
  hosted one; M1 review #1).
- `afterFinish(book, written)` - those texts are in the zip now.
- `referenceCodes(book)` - ids taken as references.

## Invariants & assumptions

- Checked against an independent model of the zip (the hosted files with
  every Finish's writes applied): a Finish brings the zip to every saved
  pose, and never rewrites a file with the text it already holds. The
  model's hosted texts are reachable by the generated ones, or no sequence
  would ever revert a code to its hosted text (the property then missed
  the baseline bug - checked by mutation).
- Every measured code is a reference.
- Text identity, not parsed equality: a level re-serialized differently is
  written again (harmless: the Finish replaces the file in place).
- What M4 must map from today's slot: `measurementRole` and
  `hostedCandidate` read "the level in hand"; with the book, the code's own
  entry is that input.
- Not wired yet in M1; M4 replaces the slot with it.

## Examples

```ts
let book = openCodeBook({ hosted: ctx.currentLevelTexts ?? new Map() });
book = withMeasurement(book, { id, json }, measurement);
const entries = codesToWrite(book); // every changed code
book = afterFinish(book, entries);
```

## Tests

`code-book.test.ts`: opening (hosted, draft, draft identical to hosted), a
restore before the levels arrive, measuring one and two codes, references,
the settle's update, the Finish, a code reverting to its hosted text after
a Finish, a draft restored after live work, a measurement dropped, and
three properties against the model of the zip.
