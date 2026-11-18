# plain-words.ts

## Purpose

The words of a narrated text's plain text `P`, as the read-along counts
them. The narration box (`narration-box.ts`, through
`narration-box-timeline.ts`) lights them one by one, the check page cuts
its timing by them, and the editor's word diff
(`editor/narration/word-diff.ts`) matches a timing file against a body by
them. Pure; offsets are of `P`.

## Public API

- `PlainWord` - `{ from, to }`, a word's stretch of `P`.
- `wordsOf(text, from, to)` - the words of a stretch, in order: letters
  and digits with inner apostrophes
  (`/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu`); punctuation lies between
  words. A word cut by `to` ends there; a negative `from` reads as 0.

## Invariants

- Words are in order, never overlap, lie inside `[from, to)`, and are
  never empty.

## Tests

- `plain-words.test.ts` - punctuation between words, inner apostrophes,
  a stretch, and a property test over any text (in order, inside the
  stretch, never empty, never overlapping).
