# `lectern-page.ts` - the reading stand's page, as numbers

## Purpose

The rules of a long text's `lectern` view (`tour.json` minor 3) that do
not need a canvas: the text's paragraphs and sentences, one paragraph
wrapped into lines, the nine-line window around the current sentence and
the sentence a tap turns the page to. The rules are the narrated-text
prototype's (`public/prototypes/station-blocks-1-narrated-text/`, the
lectern); the drawing is `lectern-view.ts`'s.

## Public API

- `LECTERN_PAGE` - the page in canvas pixels: 1024 x 768, nine `rows`, the
  window `leadLines` (2) above the sentence, a turn of `turnLines` (7),
  a 62 px margin, the first baseline at 206 px, lines 54 px apart, 900 px
  wide.
- `analyzeLecternText(text)` -> `LecternText` (`text`, `paragraphs`
  `{from, to, s0, s1}`, `sentences` `{from, to, p}`, all offsets into
  `text`). Paragraphs are a blank line apart; a sentence ends at `.`, `!`,
  `?` or `…` (closing quotes and brackets included) before a capital, a
  digit or an opening quote, or at the paragraph's end. A non-string is
  read as empty.
- `sentenceAt(text, offset)` - the last sentence starting at or before
  `offset`, 0 when none.
- `wrapLecternParagraph(text, p, measure, maxW = 900)` -> lines of
  `LecternToken` `{from, to, text, x, w}`: words a space apart, a break
  before the word that would cross `maxW`; a word wider than the line has
  a line of its own; a paragraph that does not exist has no lines.
- `lecternWindowStart(lines, from)` - the first line shown for the
  sentence starting at `from`: two lines above its line, clamped so nine
  lines show when the paragraph has them.
- `lecternTurn(text, s, measure, maxW = 900)` - the sentence seven lines
  on in the same paragraph, else the next paragraph's first, else 0. A
  sentence out of range (or not an integer) turns to 0.

## Invariants & assumptions

- Pure; widths come from `measure` (the page's `measureText` with the
  body font, a stub under test), so the same wrap is used to draw and to
  turn.
- Every sentence lies inside its paragraph; together they cover every
  non-space character of it.
- A turn always moves forward or wraps to 0, and visits every paragraph.
  **Departure from the prototype:** its turn stuck on a sentence longer
  than seven lines (the line seven on still belonged to it); here the
  turn moves to the next sentence instead. The property test found it.

## Examples

```ts
const measure = (w: string) => ctx.measureText(w).width;
const t = analyzeLecternText("One. Two.\n\nThree.");
const lines = wrapLecternParagraph(t, 0, measure);
const next = lecternTurn(t, 0, measure); // 2: the next paragraph
```

## Tests

`lectern-page.test.ts` (the exact splits, wraps, windows and turns) and
`lectern-page.property.test.ts` (the invariants above for any text, line
width and character width).
