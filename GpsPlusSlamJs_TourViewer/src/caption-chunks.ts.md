# caption-chunks.ts

## Purpose

The captions strip's lines: the sentences the voice is in, cut into chunks that fit about three lines, as the narrated-text prototype cuts them. Pure; offsets are of the plain text `P`.

## Public API

- `CaptionWord` - a word's stretch of `P`: letters and digits with inner apostrophes (`/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu`, the prototype's word); punctuation lies between words.
- `wordsOf(text, from, to)` - the words of a stretch.
- `CAPTION_MAX_CHARS` - `{ portrait: 96, landscape: 118, desktop: 120 }`; `CaptionLayout` is its key.
- `captionChunks(text, from, to, maxChars)` - `{ words, chunks }`: a chunk ends at the last word that keeps it under `maxChars`, moved back to a clause break (`,` `;` `:`) in its last 45 %, and takes the closing punctuation after its last word. At least one chunk; `maxChars` below 1 reads as 1.
- `wordHolding(words, at)` - the word holding or last before offset `at`, or -1.
- `chunkHolding(chunks, w)` - the chunk holding word `w` (0 for none).

## Invariants

- Every word is in exactly one chunk, in order; a chunk is within `maxChars` unless it is a single longer word.

## Tests

- `caption-chunks.test.ts` - the prototype's cuts, clause breaks, closing punctuation, a long single word, and a property test over any text (every word once, in order, within the limit).
