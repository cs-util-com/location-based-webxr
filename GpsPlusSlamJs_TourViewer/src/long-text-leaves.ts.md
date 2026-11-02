# long-text-leaves.ts

## Purpose

Lays a long text's plain text `P` (`plainTextOf(parseTourMarkdown(body))`, the text a narrator reads and every read-along offset counts in) over the rendered reading sheet: which leaf (paragraph or heading) holds an offset, and the DOM `Range` over a stretch of `P`, so a word or sentence can be marked where it is read without wrapping it in an element.

## Public API

- `PlacedLeaf` - a leaf's stretch of `P` (`from` inclusive, `to` exclusive) and the text nodes it is drawn in.
- `placeLeaves(plain, renderedLeaves)` - pairs `P`'s leaves with the renderer's (`long-text-render.ts`), in order. A rendered leaf whose text differs from its stretch of `P` is left out, so a mismatch marks nothing rather than the wrong words.
- `leafAt(leaves, at)` - the index of the one leaf holding offset `at`, or -1 (in the blank line between two leaves, before the first, after the last, or not a finite number). A binary search.
- `rangeOf(doc, leaves, from, to)` - the `Range` over `from..to` inside the one leaf holding `from`, clipped to that leaf; null when no leaf holds it or the span is empty.

## Invariants

- A range never crosses from one leaf into the next: the `"\n\n"` that `P` puts between leaves is in no element.
- A link's host shown beside the link is not in `P`; offsets step over it.
- Never throws on bad offsets; returns -1 or null.

## Example

```ts
const plain = plainTextOf(parseTourMarkdown(body));
const leaves = placeLeaves(plain, rendered.leaves);
const range = rangeOf(document, leaves, seg.from, seg.to);
```

## Tests

- `long-text-leaves.test.ts` - placement over paragraphs, headings, emphasis and links; offsets in the gap; mismatched leaves.
- `long-text-leaves.property.test.ts` - for any offset, the highlight's span is the one leaf range holding it, and the range's text is that stretch of `P`.
