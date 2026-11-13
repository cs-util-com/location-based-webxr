# `kinds/picture/plate.ts` - the words on a picture's plate and tag

## Purpose

Cuts a picture's caption for the plate under a framed print (at most
three lines, an ellipsis when cut) and makes the short tag line a
cut-out's tag carries. The plate and the tag are labels of the sheet,
which carries the whole text: what they show is always a prefix of it.

## Public API

- `PLATE_MAX_LINES = 3`, `ELLIPSIS` (the single ellipsis character).
- `plateLines(text, fits, maxLines = 3) -> { lines, truncated }`
  - greedy word wrap with `fits(line)` (the painter measures); a word
    that fits no line stands alone on its own;
  - on overflow keeps `maxLines` lines and drops words from the last
    until it fits with the ellipsis, stripping a trailing `, . ; :`;
  - RangeError for a `maxLines` that is not a positive integer.
- `tagLine(title, caption)` - the trimmed title, else the caption's first
  phrase (up to `. ; :`), cut to a word within 34 characters with the
  ellipsis.
- `plainWords(text)` - the words of a text, split on white space.

## Invariants and assumptions

- Pure: no canvas; `fits` is the only measure.
- Absent or blank text gives no lines.

## Tests

`plate.test.ts`, including the property "the plate always shows a prefix
of the sheet's text".
