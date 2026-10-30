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
- `LecternPlace` `{ sentence, start }` - where the page is: the sentence
  it highlights and, once a turn moved the window on inside a sentence
  longer than the page, the window's first line (`null`: the window the
  sentence opens). `LECTERN_FIRST_PLACE` is `{ sentence: 0, start: null }`.
- `lecternPlaceStart(lines, from, start)` - the first line shown: `start`
  kept inside the paragraph (at most nine lines from its end, at least
  0), or `lecternWindowStart` for `null` or a start that is no integer.
- `lecternTurn(text, place, measure, maxW = 900)` -> `LecternPlace` -
  seven lines on from the line the page reads at (the sentence's line, or
  two below a moved window's first): a later sentence starting there is
  turned to (`start: null`); the same sentence still there moves the
  window on to start two lines above that line, the sentence kept; past
  the paragraph's last line, or when the window could not move on (the
  page already shows the paragraph's last lines), the next paragraph's
  first sentence, else `LECTERN_FIRST_PLACE`. A sentence out of range (or
  not an integer) turns to `LECTERN_FIRST_PLACE`. Every tap changes the
  page (the property test found a tap that did not: one sentence of eight
  lines, all on the page, whose window was clamped back to where it was).

## Invariants & assumptions

- Pure; widths come from `measure` (the page's `measureText` with the
  body font, a stub under test), so the same wrap is used to draw and to
  turn.
- Every sentence lies inside its paragraph; together they cover every
  non-space character of it.
- A turn always moves forward (a later sentence, or the same one's window
  further on) or wraps to the first, and visits every paragraph; over one
  cycle every line of every paragraph is shown at least once.
  **Departure from the prototype:** its turn stuck on a sentence longer
  than seven lines (the line seven on still belonged to it); here the
  window moves on by lines through that sentence, which stays
  highlighted. (A first fix turned to the next sentence and skipped the
  long one's middle lines; the r984 review showed a 14-line sentence
  losing lines 9-11, and the every-line property now holds it.)

## Examples

```ts
const measure = (w: string) => ctx.measureText(w).width;
const t = analyzeLecternText("One. Two.\n\nThree.");
const lines = wrapLecternParagraph(t, 0, measure);
const next = lecternTurn(t, LECTERN_FIRST_PLACE, measure);
// { sentence: 2, start: null }: the next paragraph
```

## Tests

`lectern-page.test.ts` (the exact splits, wraps, windows and turns) and
`lectern-page.property.test.ts` (the invariants above for any text, line
width and character width).
