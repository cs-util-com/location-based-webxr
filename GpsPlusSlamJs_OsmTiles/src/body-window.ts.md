# `body-window.ts`

## Purpose

Bounded views of a tile body for the checks that need only its ends: the
inflated head of an operator's gzip answer (the fill), and the first and
last bytes of a whole stored body (the verify), never holding the decoded
tile in memory.

## Public API

- `hasGzipMagic(bytes)` - the body starts with `1f 8b`.
- `MAX_TILE_GZIP_BYTES` (20 MiB) and `MAX_TILE_DECODED_BYTES` (150 MiB) -
  the size bounds of a tile, gzip and decoded. The densest tiles measured
  were a few MB of gzip and a few tens of MB decoded. The decoded bound
  holds for a stream read through a window (`readBodyEnds`); a check on
  a body already buffered whole (the fill's raw answer) cannot fire
  before the isolate's 128 MB memory limit ends the invocation.
- `gzipDecodedSize(bytes)` - the trailer's ISIZE (last four bytes,
  little-endian): the decoded size modulo 2^32 as the stream claims it;
  undefined for fewer than 20 bytes. A crafted stream can understate it
  (nothing checks it before the stream is inflated), so it bounds honest
  answers for free and the decoded limit below is the backstop.
- `BodyTooLarge` - the error `readBodyEnds` throws past its bound.
- `SourceReadError` - the error `readBodyEnds` throws when reading the
  stored stream itself failed (the cause attached), raw or gzip, as
  opposed to bytes that do not decode. A failed read says nothing about
  the tile, so the verify must not judge it on one.
- `inflateHead(gzip, maxBytes)` - the first `maxBytes` decoded bytes,
  inflating at most the first 16 KB (`GZIP_HEAD_INPUT_BYTES`, module-private)
  of input.
  Rejects when those bytes are not a valid gzip start, or when a body
  given whole fails to inflate; a stream merely cut at the input bound is
  fine once anything came out.
- `readBodyEnds(stream, gzip, headBytes, tailBytes, maxDecodedBytes?)` -
  reads the stream to its end (through `DecompressionStream` when `gzip`),
  keeping only the first `headBytes` and the last `tailBytes`. Rejects on
  a gzip error, a cut gzip stream included, and with `BodyTooLarge` (the
  stream cancelled) once more than `maxDecodedBytes` (default
  `MAX_TILE_DECODED_BYTES`) came out, so a gzip bomb costs at most that
  much inflating.

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
false gzip label, the ISIZE and length bounds) and `verify-tile.test.ts` (gzip and raw bodies, a cut
gzip, a property over sizes, a gzip bomb stopped at the decoded bound).
`body-window.test.ts` tests it directly: a property that any chunking
yields the same head and tail, a gzip tail stitched from small chunks, a
bomb rejected with `BodyTooLarge`, the stream cancelled past the bound, a
body exactly at the bound passing, `inflateHead` returning the head past
its input bound, cut gzip rejected, and `gzipDecodedSize`.
