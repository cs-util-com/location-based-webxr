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
  closing quotes or brackets, or a line break, ends a sentence. Never throws; a non-string
  or empty text gives `[]`.
- `plainSentences(plainText, leaves, lang = "en")` - the sentences of a
  plain text `P`, cut leaf by leaf (`plainTextOf(...).leaves`), as
  `{ from, to }` spans of `P`: the same cut `indexSentences` makes,
  without a DOM (the captions strip follows the voice by it).
- `indexSentences(doc, plainText, leaves, lang = "en")` - the sentences
  of a rendered body, cut from its plain text `P` leaf by leaf
  (`leaves` from `placeLeaves`, `long-text-leaves.ts`), so each
  sentence's `from`/`to` are the offsets a read-along timing counts in:
  `{ sentences: { from, to, range, paragraph }[], paragraphs,
paragraphStarts }`. A "paragraph" is a leaf (paragraph or heading) that
  holds at least one sentence. A sentence never runs from one leaf into
  the next; it may run across an emphasis or a link (its range then
  covers the host shown beside the link). A hard break is a line break in
  `P`, which ends a sentence. Pictures are in no leaf.
- `sentenceHolding(index, at)` - the sentence holding offset `at` of
  `P`, or between two the one before it; -1 before the first or with
  none. A binary search (`lastAtOrBefore`, `last-at-or-before.ts`; -1 for a non-finite offset), so a read-along may ask every frame.
- `sentenceAt(index, node, offset)` - the sentence at a DOM point: the one
  containing it; between two, the one before; the first before them all,
  the last after them all; null for no sentences or a point the ranges
  cannot be compared with (another document).

## Invariants & assumptions

- Ranges are built once per open text; the sheet does not change the
  body's text nodes afterwards (a picture replaces only its holder's
  content, and holders are skipped).
- A sentence's range is built by `rangeOf` inside its one leaf, so it
  starts and ends on the body's own text nodes.
- Sentence rules are the browser's; the fallback is cruder (an
  abbreviation such as "Mr." ends a sentence).

## Example

```ts
const plain = plainTextOf(parsed);
const leaves = placeLeaves(plain, rendered.leaves);
const index = indexSentences(document, plain.text, leaves, "en");
CSS.highlights.set("long-text-place", new Highlight(index.sentences[0].range));
const i = sentenceAt(index, caret.offsetNode, caret.offset);
```

## Tests

- `long-text-sentences.test.ts` - splitting and trimming, the fallback
  without a segmenter (a line break included), reading order across
  headings, emphasis, links and lists, a hard break ending a sentence,
  pictures left out, the same cut without a DOM (`plainSentences`),
  `sentenceHolding`, and `sentenceAt` at a sentence, in a gap, before
  and after all, and its null cases.
- `long-text-sentences.property.test.ts` - for generated texts in three
  languages: spans ordered, non-overlapping, non-empty, trimmed, inside
  the text, and covering every letter.
