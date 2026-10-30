# `long-text-sentences.ts` - the sentences of a rendered long text

## Purpose

Finds where each sentence of a long text's rendered body
(`long-text-render.ts`) starts and ends in the DOM, as `Range`s over its
text nodes. The reading sheet (`long-text-sheet.ts`) draws its reading
mark over one of these ranges with the CSS Custom Highlight API and turns
a tap (a caret position) into the sentence under it. No sentence is
wrapped in an element of its own: the renderer's fixed element list has
no element for it, and the ranges need none.

## Public API

- `sentenceSpans(text, lang = "en")` - the sentences of a string as
  `{ from, to }` spans, in order, each trimmed of white space; a sentence
  of white space only is left out. Uses `Intl.Segmenter` (sentence
  granularity) with `lang`, falling back to `"en"` for a malformed tag;
  where the browser has no segmenter, a run of `.`, `!` or `?` and any
  closing quotes or brackets ends a sentence. Never throws; a non-string
  or empty text gives `[]`.
- `indexSentences(root, skip, lang = "en")` - the sentences of the body
  under `root`: `{ sentences: { range, paragraph }[], paragraphs,
paragraphStarts }`. A "paragraph" is a block of text: every `p`, `h3`,
  `h4` and `h5` under `root` (list items and quotes hold paragraphs of
  their own) that is not in `skip` (a picture's holder) and holds at least
  one sentence. A block's text is all its text nodes, so a sentence may
  run across an emphasis or a link (whose shown host is part of it).
- `sentenceAt(index, node, offset)` - the sentence at a DOM point: the one
  containing it; between two, the one before; the first before them all,
  the last after them all; null for no sentences or a point the ranges
  cannot be compared with (another document).

## Invariants & assumptions

- Ranges are built once per open text; the sheet does not change the
  body's text nodes afterwards (a picture replaces only its holder's
  content, and holders are skipped).
- A sentence start that falls exactly at the end of one text node is
  moved to the start of the next, so a highlight does not begin with an
  empty piece of the previous node.
- Sentence rules are the browser's; the fallback is cruder (an
  abbreviation such as "Mr." ends a sentence).

## Example

```ts
const index = indexSentences(article, new Set(pictureHolders), "en");
CSS.highlights.set("long-text-place", new Highlight(index.sentences[0].range));
const i = sentenceAt(index, caret.offsetNode, caret.offset);
```

## Tests

- `long-text-sentences.test.ts` - splitting and trimming, the fallback
  without a segmenter, reading order across headings, emphasis, links and
  lists, picture holders left out, the start node, `sentenceAt` at a
  sentence, in a gap, before and after all, and its null cases.
- `long-text-sentences.property.test.ts` - for generated texts in three
  languages: spans ordered, non-overlapping, non-empty, trimmed, inside
  the text, and covering every letter.
