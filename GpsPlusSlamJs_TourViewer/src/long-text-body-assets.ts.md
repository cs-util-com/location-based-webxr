# long-text-body-assets.ts

## Purpose

The assets a long text's body shows: the picture blocks of its parsed
Markdown (`![alt](asset:<id>)` on a line of its own), at any depth. One
walk for the two readers that need it: the view switch (a lectern "shows
no pictures", `visitor-prefs.ts` `bodyHasPictures`) and a write's asset
rule (`tour-content.ts` `blockAssetIds`, which must not drop the file of
a picture a body shows).

## Public API

- `bodyPictureAssets(body: string): readonly string[]` - the asset ids of
  the pictures `body` shows, in document order, each once. Never throws
  (the parser takes any string).
- `blockBodyAssets(block: { body: string }): readonly string[]` - the same
  answer for `block.body`, remembered by the block object (a `WeakMap`).
  The write's asset rule (`tour-content.ts` `blockAssetIds`) asks through
  it.

## Invariants & assumptions

- Only a picture BLOCK names an asset: one inside a paragraph (inline)
  and one past the parser's cap (`TOUR_MARKDOWN_MAX_PICTURES`, 20) show
  their alt text only, so a write does not keep their asset. A creator
  who moves such a picture to a line of its own after a Finish finds its
  file gone; the parsed tree is the rule because it is what a visitor
  sees.
- Each body is parsed once: the answers are kept by body string, up to 64,
  and the memo is emptied whole when full. The size is PROVISIONAL (a
  tour's long texts are expected to be a few dozen at most); past it a
  write empties the memo, which costs parse time, never a wrong answer. A
  32 000-character body takes about 2 ms to parse on desktop Node.
- A write asks about every long text of every undo and redo step (up to
  200, `historyAssetIds`), on every document change: far more bodies than
  the string memo holds, so by string every write re-parsed every past
  body. `blockBodyAssets` keeps each answer by the block object instead.
  This is sound because a block is never changed in place: the document's
  state is immutable and an edit makes a new block. The map lets go of an
  answer with its block. Measured, one `manifestToWrite` (median of 7,
  after one warm-up write) with one long text edited N times, desktop Node
  under a loaded machine (two runs, the range):
  - 4 000-character bodies: N = 65: 26-58 ms before, 0.15 ms after;
    N = 100: 61-119 ms before, 0.18 ms after; N = 200: 141-255 ms before,
    0.26 ms after.
  - 30 000-character bodies: N = 65: 305-414 ms before, 0.08 ms after;
    N = 100: 532-631 ms before, 0.20 ms after; N = 200: 1 192-1 298 ms
    before, 0.21 ms after.
  - The first write after an edit still parses each body it has not seen
    (one, the new body); a cold document parses them all once.
- The returned array is shared between callers asking for the same body:
  read it, never change it.

## Examples

```ts
bodyPictureAssets("Intro.\n\n![The mill](asset:mill)\n\n> ![x](asset:bell)");
// ["mill", "bell"]
bodyPictureAssets("Look ![x](asset:a) here."); // [] (inline)
```

## Tests

- `long-text-body-assets.test.ts`: pictures at the top, in a list item and
  in a quote, in order and once; an inline picture not listed.
- `visitor-prefs.memo.test.ts` (through `bodyHasPictures`, the switch's
  per-frame question): each body parsed once with two asked in turn;
  parsed again after 65 others filled the memo (the real parser, spied).
- `tour-document.body-memo.test.ts`: a second `manifestToWrite` with 65,
  100 and 200 past bodies parses none of them again (at most the current
  body; the real parser, spied).
- `long-text-body-assets.property.test.ts`: any mix of nesting and repeats
  lists each shown picture once, in the body's order.
- Through `tour-content.test.ts` (`withReferencedAssets` keeps a body's
  pictures) and `finish-rebuild.test.ts` (a Finish keeps their files, read
  from the zip's bytes).
