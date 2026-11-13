# `body-window.ts`

## Purpose

Bounded views of a tile body for the checks that need only its ends: the
inflated head of an operator's gzip answer (the fill), and the first and
last bytes of a whole stored body (the verify), never holding the decoded
tile in memory.

## Public API

- `hasGzipMagic(bytes)` - the body starts with `1f 8b`.
- `inflateHead(gzip, maxBytes)` - the first `maxBytes` decoded bytes,
  inflating at most the first 16 KB (`GZIP_HEAD_INPUT_BYTES`, module-private)
  of input.
  Rejects when those bytes are not a valid gzip start, or when a body
  given whole fails to inflate; a stream merely cut at the input bound is
  fine once anything came out.
- `readBodyEnds(stream, gzip, headBytes, tailBytes)` - reads the stream to
  its end (through `DecompressionStream` when `gzip`), keeping only the
  first `headBytes` and the last `tailBytes`. Rejects on a gzip error,
  a cut gzip stream included.

## Invariants & assumptions

- `inflateHead` costs a constant, not the tile: measured 0.3-0.4 ms at
  every tile size from 2.3 to 49.5 MB raw (Node 24). 16 KB of gzip JSON
  inflates to far more than the 2 KB head.
- `readBodyEnds` costs one pass over the decoded body; memory stays at
  `headBytes + tailBytes` plus one chunk.
- Readers are always released or cancelled, and a `cancel()` rejection is
  swallowed.

## Tests

Through `fill-tile.test.ts` (gzip heads: a large answer, an error page, a
false gzip label) and `verify-tile.test.ts` (gzip and raw bodies, a cut
gzip, a property over sizes).
